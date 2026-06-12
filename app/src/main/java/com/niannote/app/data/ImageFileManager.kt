package com.niannote.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class ImageFileManager(private val context: Context) {

    private val imagesDir: File by lazy {
        File(context.filesDir, "images").apply { mkdirs() }
    }

    private val thumbsDir: File by lazy {
        File(context.filesDir, "thumbs").apply { mkdirs() }
    }

    fun saveBase64Image(base64Data: String): ImageResult {
        return try {
            val imageBytes = Base64.decode(base64Data, Base64.DEFAULT)
            val id = UUID.randomUUID().toString()
            val fileName = "$id.jpg"
            val file = File(imagesDir, fileName)

            FileOutputStream(file).use { fos ->
                fos.write(imageBytes)
            }

            val thumbResult = createThumbnail(file, id)

            ImageResult(
                id = id,
                filePath = file.absolutePath,
                thumbPath = thumbResult?.absolutePath
            )
        } catch (e: Exception) {
            ImageResult(error = e.message ?: "Failed to save image")
        }
    }

    fun saveBytesImage(imageBytes: ByteArray): ImageResult {
        return try {
            val id = UUID.randomUUID().toString()
            val fileName = "$id.jpg"
            val file = File(imagesDir, fileName)

            FileOutputStream(file).use { fos ->
                fos.write(imageBytes)
            }

            val thumbResult = createThumbnail(file, id)

            ImageResult(
                id = id,
                filePath = file.absolutePath,
                thumbPath = thumbResult?.absolutePath
            )
        } catch (e: Exception) {
            ImageResult(error = e.message ?: "Failed to save image")
        }
    }

    private fun createThumbnail(originalFile: File, id: String): File? {
        return try {
            val options = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            BitmapFactory.decodeFile(originalFile.absolutePath, options)

            val thumbWidth = 200
            val scaleFactor = maxOf(1, options.outWidth / thumbWidth)

            options.apply {
                inJustDecodeBounds = false
                inSampleSize = scaleFactor
            }

            val bitmap = BitmapFactory.decodeFile(originalFile.absolutePath, options)
            val thumbFile = File(thumbsDir, "${id}_thumb.jpg")

            FileOutputStream(thumbFile).use { fos ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 70, fos)
            }
            bitmap.recycle()

            thumbFile
        } catch (e: Exception) {
            null
        }
    }

    fun deleteImage(id: String) {
        File(imagesDir, "$id.jpg").delete()
        File(thumbsDir, "${id}_thumb.jpg").delete()
    }

    fun deleteImagesForNote(noteId: String) {
        val db = AppDatabase.getInstance(context)
        val images = runCatching {
            kotlinx.coroutines.runBlocking {
                db.imageDao().getByNoteId(noteId)
            }
        }.getOrDefault(emptyList())

        images.forEach { image ->
            File(image.filePath).delete()
            image.thumbPath?.let { File(it).delete() }
            runCatching {
                kotlinx.coroutines.runBlocking {
                    db.imageDao().deleteById(image.id)
                }
            }
        }
    }

    fun getImageFile(filePath: String): File? {
        val file = File(filePath)
        return if (file.exists()) file else null
    }

    fun getImageAsBase64(filePath: String): String? {
        return try {
            val file = File(filePath)
            if (file.exists()) {
                Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
            } else null
        } catch (e: Exception) {
            null
        }
    }

    data class ImageResult(
        val id: String? = null,
        val filePath: String? = null,
        val thumbPath: String? = null,
        val error: String? = null
    ) {
        val isSuccess: Boolean get() = id != null && error == null
    }
}
