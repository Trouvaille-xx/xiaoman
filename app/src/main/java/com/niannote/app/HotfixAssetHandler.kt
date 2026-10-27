package com.niannote.app

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.io.InputStream

/**
 * 热更新资源处理器：注册在 WebViewAssetLoader 的 /assets/ 前缀上。
 * 优先返回 filesDir/hotfix/ 下的热更文件，没有则回退到 APK assets，
 * 使 JS/HTML/CSS 改动可以免安装热推送。
 */
class HotfixAssetHandler(private val context: Context) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse? {
        if (!isSafePath(path)) return null
        val hotfix = File(context.filesDir, HOTFIX_DIR + "/" + path)
        if (hotfix.isFile) {
            return response(hotfix.inputStream(), path)
        }
        return try {
            response(context.assets.open(path), path)
        } catch (e: Exception) {
            null
        }
    }

    private fun response(stream: InputStream, path: String): WebResourceResponse {
        val mime = guessMime(path)
        val encoding =
                if (mime.startsWith("text/") ||
                                mime == "application/javascript" ||
                                mime == "application/json")
                        "utf-8"
                else null
        return WebResourceResponse(mime, encoding, stream)
    }

    companion object {
        const val HOTFIX_DIR = "hotfix"
        const val STAGING_DIR = "hotfix_staging"

        /** 防路径穿越：拒绝空路径、绝对路径、反斜杠、..、盘符 */
        fun isSafePath(path: String): Boolean {
            if (path.isEmpty() || path.startsWith("/") || path.contains("\\")) return false
            if (path.contains("..") || path.contains(":")) return false
            return true
        }

        fun guessMime(path: String): String {
            val ext = path.substringAfterLast('.', "").lowercase()
            return when (ext) {
                "html", "htm" -> "text/html"
                "js", "mjs" -> "application/javascript"
                "css" -> "text/css"
                "json" -> "application/json"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "gif" -> "image/gif"
                "svg" -> "image/svg+xml"
                "webp" -> "image/webp"
                "ico" -> "image/x-icon"
                "txt" -> "text/plain"
                "woff2" -> "font/woff2"
                else -> "application/octet-stream"
            }
        }
    }
}
