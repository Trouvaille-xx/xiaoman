package com.niannote.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import com.niannote.app.data.AppDatabase
import com.niannote.app.data.ImageEntity
import com.niannote.app.data.ImageFileManager
import com.niannote.app.data.NoteEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val storageKey = "nian_notes_data"
    private val settingsKey = "nian_settings"
    private val mailsKey = "nian_mails"

    private var lastTop = 0
    private var lastBottom = 0
    private var lastKeyboard = 0
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null

    private val database by lazy { AppDatabase.getInstance(this) }
    private val imageManager by lazy { ImageFileManager(this) }

    private val permissionLauncher: ActivityResultLauncher<String> =
            registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                if (granted && pendingFileCallback != null) {
                    launchFileChooser()
                } else {
                    pendingFileCallback?.onReceiveValue(null)
                    pendingFileCallback = null
                }
            }

    companion object {
        private const val FILE_CHOOSER_REQUEST = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)

        webView =
                WebView(this).apply {
                    layoutParams =
                            android.widget.FrameLayout.LayoutParams(
                                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT
                            )
                }
        setContentView(webView)

        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
            lastTop = systemBars.top
            lastBottom = systemBars.bottom
            lastKeyboard = imeInsets.bottom
            view.setPadding(systemBars.left, 0, systemBars.right, 0)
            applySafeInsets()
            insets
        }

        setupWebView()
        webView.addJavascriptInterface(StorageInterface(this), "AndroidStorage")
        webView.addJavascriptInterface(SettingsInterface(this), "AndroidSettings")
        webView.addJavascriptInterface(ShareInterface(this), "AndroidShare")
        webView.addJavascriptInterface(MailInterface(this), "AndroidMail")
        webView.addJavascriptInterface(MemoryInterface(this), "AndroidMemory")
        webView.addJavascriptInterface(FileInterface(this), "AndroidFile")
        webView.addJavascriptInterface(ImageInterface(this), "AndroidImage")
        webView.addJavascriptInterface(HttpInterface(), "AndroidHttp")
        webView.loadUrl("file:///android_asset/app.html")
    }

    private fun applySafeInsets() {
        webView.evaluateJavascript(
                "window.__applySafeInsets(${lastTop}, ${lastBottom}, ${lastKeyboard})",
                null
        )
    }

    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_NO_CACHE
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
        }
        // WebViewAssetLoader：把 filesDir/images/ 暴露为 https://appassets.androidplatform.net/images/
        // 这是 Android 官方推荐的本地文件给 WebView 的方式，比 content:// FileProvider 更可靠
        val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/images/", WebViewAssetLoader.InternalStoragePathHandler(
                        this, File(filesDir, "images")
                ))
                .build()
        webView.webViewClient =
                object : WebViewClient() {
                    override fun onPageFinished(view: WebView?, url: String?) {
                        super.onPageFinished(view, url)
                        applySafeInsets()
                    }

                    // 把 https://appassets.androidplatform.net/* 的请求交给 assetLoader
                    // 其他请求走默认（不拦截）
                    override fun shouldInterceptRequest(
                            view: WebView,
                            request: WebResourceRequest
                    ): WebResourceResponse? {
                        return assetLoader.shouldInterceptRequest(request.url)
                                ?: super.shouldInterceptRequest(view, request)
                    }
                }
        webView.webChromeClient =
                object : WebChromeClient() {
                    override fun onShowFileChooser(
                            view: WebView?,
                            callback: ValueCallback<Array<Uri>>?,
                            params: FileChooserParams?
                    ): Boolean {
                        pendingFileCallback = callback
                        val acceptTypes = params?.acceptTypes?.filter { it.isNotBlank() }?.toList() ?: emptyList()
                        launchFileChooser(acceptTypes)
                        return true
                    }
                }
    }

    private val importMimeTypes = listOf("text/html", "text/plain")

    private fun launchFileChooser(acceptTypes: List<String> = emptyList()) {
        val isImport = acceptTypes.any { it.contains("html") || it.contains("text") }
        if (isImport) {
            // HTML/text import — no permission needed
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/html", "text/plain"))
            }
            startActivityForResult(Intent.createChooser(intent, "选择文件"), FILE_CHOOSER_REQUEST)
        } else {
            checkAndRequestPermission()
        }
    }

    private fun checkAndRequestPermission() {
        val permission =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    Manifest.permission.READ_MEDIA_IMAGES
                } else {
                    Manifest.permission.READ_EXTERNAL_STORAGE
                }

        when {
            ContextCompat.checkSelfPermission(this, permission) ==
                    PackageManager.PERMISSION_GRANTED -> {
                launchImageChooser()
            }
            else -> {
                permissionLauncher.launch(permission)
            }
        }
    }

    private fun launchImageChooser() {
        val intent =
                Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "image/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
        startActivityForResult(Intent.createChooser(intent, "选择图片"), FILE_CHOOSER_REQUEST)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                val results = mutableListOf<Uri>()
                val clipData = data.clipData
                if (clipData != null) {
                    for (i in 0 until clipData.itemCount) {
                        results.add(clipData.getItemAt(i).uri)
                    }
                } else {
                    data.data?.let { results.add(it) }
                }
                pendingFileCallback?.onReceiveValue(results.toTypedArray())
            } else {
                pendingFileCallback?.onReceiveValue(null)
            }
            pendingFileCallback = null
        }
    }

    inner class StorageInterface(private val context: Context) {

        @JavascriptInterface
        fun saveNotes(json: String) {
            context.getSharedPreferences(storageKey, android.content.Context.MODE_PRIVATE)
                    .edit()
                    .putString("notes", json)
                    .apply()
        }

        @JavascriptInterface
        fun loadNotes(): String {
            return context.getSharedPreferences(storageKey, android.content.Context.MODE_PRIVATE)
                    .getString("notes", "")
                    ?: ""
        }

        @JavascriptInterface
        fun syncNotesToDb(json: String) {
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val notesArray = JSONArray(json)
                    val notes = mutableListOf<NoteEntity>()

                    for (i in 0 until notesArray.length()) {
                        val obj = notesArray.getJSONObject(i)
                        val content = obj.optString("content", "")
                        val tags = extractTags(content)

                        notes.add(
                                NoteEntity(
                                        id = obj.optString("id", ""),
                                        content = content,
                                        tags = tags,
                                        createdAt = parseTimestamp(obj.optString("createdAt", "")),
                                        updatedAt =
                                                parseTimestamp(
                                                        obj.optString(
                                                                "updatedAt",
                                                                obj.optString("createdAt", "")
                                                        )
                                                )
                                )
                        )
                    }

                    database.noteDao().deleteAll()
                    database.noteDao().insertAll(notes)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }

        @JavascriptInterface
        fun getNotesCount(): Int {
            return try {
                kotlinx.coroutines.runBlocking { database.noteDao().getAll().size }
            } catch (e: Exception) {
                0
            }
        }

        private fun extractTags(content: String): String {
            val regex = Regex("#([^\\s]+)")
            return regex.findAll(content).map { it.groupValues[1] }.joinToString(",")
        }

        private fun parseTimestamp(ts: String): Long {
            return try {
                if (ts.isEmpty()) System.currentTimeMillis()
                else
                        java.text.SimpleDateFormat(
                                        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                                        java.util.Locale.US
                                )
                                .parse(ts)
                                ?.time
                                ?: System.currentTimeMillis()
            } catch (e: Exception) {
                System.currentTimeMillis()
            }
        }
    }

    inner class FileInterface(private val context: Context) {
        private val imageManager by lazy { ImageFileManager(context) }

        @JavascriptInterface
        fun saveImageFromBase64(base64Data: String, noteId: String): String {
            val result = imageManager.saveBase64Image(base64Data)
            if (result.isSuccess) {
                // 同步写 DB，避免 JS 拿 id 渲染时 DB row 还没插入
                try {
                    kotlinx.coroutines.runBlocking(Dispatchers.IO) {
                        database.imageDao().insert(
                            ImageEntity(
                                id = result.id!!,
                                noteId = noteId,
                                filePath = result.filePath!!,
                                thumbPath = result.thumbPath,
                                createdAt = System.currentTimeMillis()
                            )
                        )
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                    return ""
                }
                return result.id!!
            }
            return ""
        }

        @JavascriptInterface
        fun getImageBase64(filePath: String): String {
            return imageManager.getImageAsBase64(filePath) ?: ""
        }

        @JavascriptInterface
        fun deleteImage(imageId: String) {
            imageManager.deleteImage(imageId)
            try {
                kotlinx.coroutines.runBlocking(Dispatchers.IO) {
                    database.imageDao().deleteById(imageId)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun deleteImagesForNote(noteId: String) {
            imageManager.deleteImagesForNote(noteId)
        }
    }

    inner class ImageInterface(private val context: Context) {
        private val imageManager by lazy { ImageFileManager(context) }

        @JavascriptInterface
        fun saveImagesSync(base64ListJson: String, noteId: String): String {
            val resultList = mutableListOf<Map<String, String>>()
            try {
                val jsonArray = JSONArray(base64ListJson)
                for (i in 0 until jsonArray.length()) {
                    val base64 = jsonArray.getString(i)
                    val result = imageManager.saveBase64Image(base64)
                    if (result.isSuccess) {
                        // 同步写 DB 后再返回 id，避免 loadNoteImages 取不到
                        try {
                            kotlinx.coroutines.runBlocking(Dispatchers.IO) {
                                database.imageDao().insert(
                                    ImageEntity(
                                        id = result.id!!,
                                        noteId = noteId,
                                        filePath = result.filePath!!,
                                        thumbPath = result.thumbPath,
                                        createdAt = System.currentTimeMillis()
                                    )
                                )
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                            continue
                        }
                        resultList.add(
                            mapOf("id" to (result.id ?: ""), "path" to (result.filePath ?: ""))
                        )
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            return JSONArray(resultList.map { JSONObject(it) }).toString()
        }

        @JavascriptInterface
        fun getImageData(imageId: String): String {
            return try {
                val result = kotlinx.coroutines.runBlocking { database.imageDao().getById(imageId) }
                result?.let { image ->
                    val base64 = imageManager.getImageAsBase64(image.filePath)
                    JSONObject()
                            .apply {
                                put("id", image.id)
                                put("path", image.filePath)
                                put("base64", base64 ?: "")
                            }
                            .toString()
                }
                        ?: "{}"
            } catch (e: Exception) {
                "{}"
            }
        }

        @JavascriptInterface
        fun ping(): String {
            return "pong"
        }

        @JavascriptInterface
        fun getFileProviderAuthority(): String {
            return context.packageName + ".fileprovider"
        }
    }

    inner class HttpInterface {
        @JavascriptInterface
        fun get(url: String): String {
            return try {
                val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                connection.requestMethod = "GET"
                connection.setRequestProperty("User-Agent", "curl/8.0")
                connection.connectTimeout = 10000
                connection.readTimeout = 10000
                val reader = java.io.BufferedReader(java.io.InputStreamReader(connection.inputStream, "UTF-8"))
                val text = reader.readText()
                reader.close()
                text
            } catch (e: Exception) {
                "{\"error\":\"${e.message}\"}"
            }
        }
    }

    @Suppress("unused")
    inner class SettingsInterface(private val context: Context) {

        @JavascriptInterface
        fun saveSettings(json: String) {
            context.getSharedPreferences(settingsKey, android.content.Context.MODE_PRIVATE)
                    .edit()
                    .putString("settings", json)
                    .apply()
        }

        @JavascriptInterface
        fun loadSettings(): String {
            return context.getSharedPreferences(settingsKey, android.content.Context.MODE_PRIVATE)
                    .getString("settings", "")
                    ?: ""
        }
    }

    inner class ShareInterface(private val context: Context) {

        @JavascriptInterface
        fun share(text: String) {
            val intent =
                    Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, text)
                    }
            context.startActivity(Intent.createChooser(intent, "分享笔记"))
        }
    }

    inner class MailInterface(private val context: Context) {

        @JavascriptInterface
        fun sendMail(
                noteContent: String,
                penpalId: String,
                penpalName: String,
                systemPrompt: String
        ) {
            val mailId = "mail_" + System.currentTimeMillis().toString()
            val prefs = context.getSharedPreferences(mailsKey, Context.MODE_PRIVATE)
            val raw = prefs.getString("mails", "[]") ?: "[]"
            val mails = JSONArray(raw)

            val mail =
                    JSONObject().apply {
                        put("id", mailId)
                        put("noteContent", noteContent)
                        put("penpalId", penpalId)
                        put("penpalName", penpalName)
                        put("sentAt", System.currentTimeMillis().toString())
                        put("status", "sending")
                        put("reply", JSONObject.NULL)
                        put("replyAt", JSONObject.NULL)
                        put("read", false)
                    }
            mails.put(mail)
            prefs.edit().putString("mails", mails.toString()).apply()

            Thread {
                        Thread.sleep(3000)
                        MailWorker.execute(
                                context,
                                mailId,
                                noteContent,
                                penpalId,
                                penpalName,
                                systemPrompt
                        )
                    }
                    .start()
        }

        @JavascriptInterface
        fun loadMails(): String {
            val prefs = context.getSharedPreferences(mailsKey, Context.MODE_PRIVATE)
            return prefs.getString("mails", "[]") ?: "[]"
        }

        @JavascriptInterface
        fun getUnreadCount(): Int {
            val prefs = context.getSharedPreferences(mailsKey, Context.MODE_PRIVATE)
            val raw = prefs.getString("mails", "[]") ?: "[]"
            val mails = JSONArray(raw)
            var count = 0
            for (i in 0 until mails.length()) {
                val mail = mails.getJSONObject(i)
                if (mail.optString("status") == "replied" && !mail.optBoolean("read", false)) {
                    count++
                }
            }
            return count
        }

        @JavascriptInterface
        fun markRead(mailId: String) {
            val prefs = context.getSharedPreferences(mailsKey, Context.MODE_PRIVATE)
            val raw = prefs.getString("mails", "[]") ?: "[]"
            val mails = JSONArray(raw)
            for (i in 0 until mails.length()) {
                val mail = mails.getJSONObject(i)
                if (mail.getString("id") == mailId) {
                    mail.put("read", true)
                    break
                }
            }
            prefs.edit().putString("mails", mails.toString()).apply()
        }

        @JavascriptInterface
        fun markAllRead() {
            val prefs = context.getSharedPreferences(mailsKey, Context.MODE_PRIVATE)
            val raw = prefs.getString("mails", "[]") ?: "[]"
            val mails = JSONArray(raw)
            for (i in 0 until mails.length()) {
                mails.getJSONObject(i).put("read", true)
            }
            prefs.edit().putString("mails", mails.toString()).apply()
        }
    }

    inner class MemoryInterface(private val context: Context) {
        private val key = "nian_memories"

        @JavascriptInterface
        fun loadAll(): String {
            val prefs = context.getSharedPreferences(key, Context.MODE_PRIVATE)
            val raw = prefs.getString("data", null)
            if (raw != null) return raw
            val init =
                    JSONObject().apply {
                        put("version", 2)
                        put(
                                "files",
                                JSONObject().apply {
                                    put(
                                            "soul",
                                            "你是「念念」，一个温暖的 AI 生活伴侣。\n\n" +
                                                    "性格：善解人意、温柔但有主见，像一位老朋友。说话自然不做作，偶尔带点幽默。\n\n" +
                                                    "原则：\n- 先共情，再回应\n- 不评判用户\n- 记住用户告诉你的重要信息\n- 回复简洁温暖，保持在 200 字以内"
                                    )
                                    put("user", "")
                                    put("facts", "")
                                }
                        )
                        put("facts", JSONArray())
                        put("sessions", JSONArray())
                    }
            prefs.edit().putString("data", init.toString()).apply()
            return init.toString()
        }

        @JavascriptInterface
        fun saveAll(json: String) {
            val prefs = context.getSharedPreferences(key, Context.MODE_PRIVATE)
            prefs.edit().putString("data", json).apply()
        }
    }
}
