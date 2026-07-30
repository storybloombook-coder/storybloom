package com.storybloom.app.speech

import android.content.Context
import com.storybloom.app.data.BookLanguage
import kotlinx.coroutines.suspendCancellableCoroutine
import org.vosk.Model
import org.vosk.android.StorageService
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Copies the APK's Vosk model directory into private app storage and opens the
 * native model. StorageService validates the copied tree with the model's
 * UUID/version metadata, so subsequent loads do not recopy 70–90 MB.
 */
class ModelManager(private val context: Context) {
    suspend fun load(language: BookLanguage): Model = suspendCancellableCoroutine { continuation ->
        val assetPath = "models/${language.modelFolder}"
        val target = "vosk-${language.value}"
        try {
            StorageService.unpack(
                context,
                assetPath,
                target,
                { model ->
                    if (model == null) {
                        continuation.resumeWithException(
                            IOException("The ${language.value.uppercase()} speech model is missing."),
                        )
                    } else if (continuation.isActive) {
                        continuation.resume(model)
                    } else {
                        model.close()
                    }
                },
                { error ->
                    if (continuation.isActive) {
                        continuation.resumeWithException(
                            IOException(
                                "The offline ${language.value.uppercase()} speech model could not be loaded.",
                                error,
                            ),
                        )
                    }
                },
            )
        } catch (error: Throwable) {
            continuation.resumeWithException(error)
        }
    }
}

private val BookLanguage.modelFolder: String
    get() = when (this) {
        BookLanguage.ENGLISH -> "vosk-model-small-en-us"
        BookLanguage.RUSSIAN -> "vosk-model-small-ru"
    }
