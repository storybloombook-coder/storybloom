package com.storybloom.app.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

class PageImageStore(private val context: Context) {
    private val pagesDir = File(context.filesDir, "pages").apply { mkdirs() }
    private val cameraDir = File(context.filesDir, "camera").apply { mkdirs() }

    fun createCameraTarget(): Pair<File, Uri> {
        val file = File(cameraDir, "capture-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return file to uri
    }

    suspend fun import(uri: Uri): String = withContext(Dispatchers.IO) {
        val bitmap = decode(uri, MAX_IMAGE_EDGE)
            ?: error("The selected image could not be decoded.")
        val normalized = applyExifRotation(uri, bitmap)
        val destination = File(pagesDir, "page-${System.currentTimeMillis()}-${randomSuffix()}.jpg")
        FileOutputStream(destination).use { stream ->
            check(normalized.compress(Bitmap.CompressFormat.JPEG, 92, stream)) {
                "The selected image could not be saved."
            }
        }
        if (normalized !== bitmap) bitmap.recycle()
        normalized.recycle()
        Uri.fromFile(destination).toString()
    }

    suspend fun importAll(uris: List<Uri>): List<String> =
        uris.map { import(it) }

    suspend fun load(path: String, maxEdge: Int = MAX_IMAGE_EDGE): Bitmap? =
        withContext(Dispatchers.IO) { decode(path.toUriCompat(), maxEdge) }

    suspend fun saveEdited(
        sourcePath: String,
        rotationDegrees: Float,
        cropLeftFraction: Float,
        cropTopFraction: Float,
        cropRightFraction: Float,
        cropBottomFraction: Float,
    ): String = withContext(Dispatchers.IO) {
        val original = decode(sourcePath.toUriCompat(), MAX_IMAGE_EDGE)
            ?: error("The page image is no longer available.")
        val rotated = if (rotationDegrees % 360f != 0f) {
            Bitmap.createBitmap(
                original,
                0,
                0,
                original.width,
                original.height,
                Matrix().apply { postRotate(rotationDegrees) },
                true,
            )
        } else {
            original
        }
        val left = (rotated.width * cropLeftFraction.coerceIn(0f, .95f)).toInt()
        val top = (rotated.height * cropTopFraction.coerceIn(0f, .95f)).toInt()
        val right = (rotated.width * cropRightFraction.coerceIn(.05f, 1f)).toInt()
        val bottom = (rotated.height * cropBottomFraction.coerceIn(.05f, 1f)).toInt()
        val cropped = Bitmap.createBitmap(
            rotated,
            left.coerceAtMost(right - 1),
            top.coerceAtMost(bottom - 1),
            (right - left).coerceAtLeast(1),
            (bottom - top).coerceAtLeast(1),
        )
        val destination = File(pagesDir, "page-edit-${System.currentTimeMillis()}-${randomSuffix()}.jpg")
        FileOutputStream(destination).use { cropped.compress(Bitmap.CompressFormat.JPEG, 93, it) }
        if (cropped !== rotated) cropped.recycle()
        if (rotated !== original) rotated.recycle()
        original.recycle()
        Uri.fromFile(destination).toString()
    }

    suspend fun saveBitmap(bitmap: Bitmap, prefix: String = "page"): String =
        withContext(Dispatchers.IO) {
            val destination = File(
                pagesDir,
                "$prefix-${System.currentTimeMillis()}-${randomSuffix()}.jpg",
            )
            FileOutputStream(destination).use {
                bitmap.compress(Bitmap.CompressFormat.JPEG, 93, it)
            }
            Uri.fromFile(destination).toString()
        }

    suspend fun delete(path: String) = withContext(Dispatchers.IO) {
        val uri = path.toUriCompat()
        if (uri.scheme == "file") {
            runCatching { File(requireNotNull(uri.path)).delete() }
        }
    }

    fun cleanupCameraFile(file: File) {
        if (file.parentFile == cameraDir) runCatching { file.delete() }
    }

    private fun decode(uri: Uri, maxEdge: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        open(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth / sample, bounds.outHeight / sample) > maxEdge * 2) {
            sample *= 2
        }
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return open(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
    }

    private fun open(uri: Uri) = when (uri.scheme) {
        "content" -> context.contentResolver.openInputStream(uri)
        "file", null -> uri.path?.let(::File)?.inputStream()
        else -> context.contentResolver.openInputStream(uri)
    }

    private fun applyExifRotation(uri: Uri, bitmap: Bitmap): Bitmap {
        val orientation = runCatching {
            open(uri)?.use { ExifInterface(it).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            ) }
        }.getOrNull() ?: ExifInterface.ORIENTATION_NORMAL
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    private fun randomSuffix() = java.lang.Long.toString(
        java.lang.Double.doubleToLongBits(Math.random()),
        36,
    ).takeLast(6)

    companion object {
        const val MAX_IMAGE_EDGE = 2400
    }
}

fun String.toUriCompat(): Uri =
    if (startsWith("file:", ignoreCase = true) || contains("://")) {
        Uri.parse(this)
    } else {
        Uri.fromFile(File(this))
    }
