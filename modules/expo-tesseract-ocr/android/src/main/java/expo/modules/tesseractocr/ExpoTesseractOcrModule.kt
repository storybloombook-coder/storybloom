package expo.modules.tesseractocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.googlecode.tesseract.android.TessBaseAPI
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Defining our own subclass avoids any cross-version ambiguity in constructing
// CodedException directly, and gives all our errors a stable "ERR_TESSERACT" code.
private class TesseractException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

// On-device OCR via Tesseract4Android. One long-lived TessBaseAPI is held across
// pages of a book (init once, recognize per page, release when done) so the
// ~10-30 MB engine isn't rebuilt each page. Recognition runs on Expo's module
// queue (off the UI thread), so a slow page won't freeze the reader.
class ExpoTesseractOcrModule : Module() {
  private var tess: TessBaseAPI? = null

  override fun definition() = ModuleDefinition {
    Name("ExpoTesseractOcr")

    // Read in JS as `TesseractModule.isSupported`. Present only when the native
    // module is linked (a dev/prod build), so it's a reliable availability flag.
    Constants("isSupported" to true)

    // tessdataParentDir must contain a `tessdata/` folder with <lang>.traineddata.
    // langs is a Tesseract spec like "eng+rus". Re-callable to switch languages.
    AsyncFunction("init") { tessdataParentDir: String, langs: String ->
      releaseEngine()
      val dir = normalizeDir(tessdataParentDir)
      val api = TessBaseAPI()
      val ok = try {
        api.init(dir, langs)
      } catch (e: Exception) {
        api.recycle()
        throw TesseractException("Tesseract init threw for langs=$langs at $dir: ${e.message}", e)
      }
      if (!ok) {
        api.recycle()
        throw TesseractException(
          "Tesseract init failed for langs=$langs at $dir. " +
            "Ensure ${dir}tessdata/ contains ${langs.replace("+", ".traineddata, ")}.traineddata."
        )
      }
      tess = api
    }

    AsyncFunction("recognizeBase64") { imageBase64: String ->
      val api = tess
        ?: throw TesseractException("Tesseract not initialized. Call init() before recognizeBase64().")
      val bytes = Base64.decode(imageBase64, Base64.DEFAULT)
      val bitmap: Bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw TesseractException("Could not decode image bytes into a bitmap.")
      try {
        api.setImage(bitmap)
        val text = api.getUTF8Text() ?: ""
        val confidence = try { api.meanConfidence() } catch (e: Exception) { -1 }
        mapOf("text" to text, "meanConfidence" to confidence)
      } finally {
        // clear() drops the image but keeps the initialized engine for reuse.
        api.clear()
        bitmap.recycle()
      }
    }

    AsyncFunction("release") {
      releaseEngine()
    }

    OnDestroy {
      releaseEngine()
    }
  }

  private fun releaseEngine() {
    tess?.recycle()
    tess = null
  }

  // Tesseract wants the PARENT of the tessdata folder, as a plain filesystem
  // path ending in a separator. Strip a file:// scheme if the JS side passes a URI.
  private fun normalizeDir(input: String): String {
    val path = if (input.startsWith("file://")) input.removePrefix("file://") else input
    return if (path.endsWith("/")) path else "$path/"
  }
}
