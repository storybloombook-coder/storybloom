package com.storybloom.app.vision

import android.content.Context
import android.graphics.Bitmap
import com.googlecode.tesseract.android.TessBaseAPI
import com.storybloom.app.data.BookLanguage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class OcrResult(
    val text: String,
    val meanConfidence: Int,
)

class TesseractEngine(private val context: Context) {
    private val mutex = Mutex()
    private var api: TessBaseAPI? = null
    private var loadedLanguage: BookLanguage? = null

    suspend fun recognize(bitmap: Bitmap, language: BookLanguage): OcrResult =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                ensureInitialized(language)
                val engine = requireNotNull(api)
                try {
                    engine.setPageSegMode(TessBaseAPI.PageSegMode.PSM_AUTO)
                    engine.setImage(bitmap)
                    OcrResult(
                        text = engine.getUTF8Text().orEmpty().trim(),
                        meanConfidence = runCatching { engine.meanConfidence() }.getOrDefault(-1),
                    )
                } finally {
                    engine.clear()
                }
            }
        }

    suspend fun close() = withContext(Dispatchers.IO) {
        mutex.withLock {
            api?.recycle()
            api = null
            loadedLanguage = null
        }
    }

    private fun ensureInitialized(language: BookLanguage) {
        if (api != null && loadedLanguage == language) return
        api?.recycle()
        api = null
        val root = File(context.filesDir, "tesseract").apply { mkdirs() }
        val tessdata = File(root, "tessdata").apply { mkdirs() }
        val model = File(tessdata, "${language.tesseractCode}.traineddata")
        if (!model.exists() || model.length() < MIN_MODEL_SIZE_BYTES) {
            downloadModel(language, model)
        }
        val candidate = TessBaseAPI()
        val ok = candidate.init(root.absolutePath + File.separator, language.tesseractCode)
        if (!ok) {
            candidate.recycle()
            error("The ${language.value.uppercase()} OCR model could not be initialized.")
        }
        api = candidate
        loadedLanguage = language
    }

    private fun downloadModel(language: BookLanguage, destination: File) {
        val temp = File(destination.parentFile, destination.name + ".download")
        runCatching { temp.delete() }
        val connection = URL(
            "$TESSDATA_BASE_URL/${language.tesseractCode}.traineddata",
        ).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 20_000
            connection.readTimeout = 120_000
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("User-Agent", "Storybloom-Android/2")
            check(connection.responseCode in 200..299) {
                "OCR model download failed (HTTP ${connection.responseCode})."
            }
            connection.inputStream.use { input ->
                temp.outputStream().buffered().use(input::copyTo)
            }
            check(temp.length() >= MIN_MODEL_SIZE_BYTES) {
                "The downloaded OCR model was incomplete."
            }
            check(temp.renameTo(destination)) {
                temp.copyTo(destination, overwrite = true)
                temp.delete()
            }
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        private const val TESSDATA_BASE_URL =
            "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main"
        private const val MIN_MODEL_SIZE_BYTES = 1_000_000L
    }
}
