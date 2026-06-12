package com.niannote.app.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "notes")
data class NoteEntity(
    @PrimaryKey
    val id: String,
    val content: String,
    val tags: String,
    val createdAt: Long,
    val updatedAt: Long
)

@Entity(tableName = "images")
data class ImageEntity(
    @PrimaryKey
    val id: String,
    val noteId: String,
    val filePath: String,
    val thumbPath: String?,
    val createdAt: Long
)
