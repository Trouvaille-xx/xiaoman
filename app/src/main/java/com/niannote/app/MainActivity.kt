package com.niannote.app

import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.room.withTransaction
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

    private val fileChooserLauncher: ActivityResultLauncher<Intent> =
            registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
                if (result.resultCode == RESULT_OK && result.data != null) {
                    val data = result.data
                    val results = mutableListOf<Uri>()
                    val clipData = data?.clipData
                    if (clipData != null) {
                        for (i in 0 until clipData.itemCount) {
                            results.add(clipData.getItemAt(i).uri)
                        }
                    } else {
                        data?.data?.let { results.add(it) }
                    }
                    pendingFileCallback?.onReceiveValue(results.toTypedArray())
                } else {
                    pendingFileCallback?.onReceiveValue(null)
                }
                pendingFileCallback = null
            }

    companion object {
        private const val MAX_MAILS = 500

        private val UTC_FORMAT: java.text.SimpleDateFormat by lazy {
            java.text.SimpleDateFormat(
                    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                    java.util.Locale.US
            ).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
        }

        /** 时间戳 ID 防同毫秒碰撞的随机后缀。 */
        fun randomSuffix(): String {
            return java.util.UUID.randomUUID().toString().substring(0, 6)
        }

        /** JS new Date().toISOString() 产出 UTC，这里显式按 UTC 解析，避免本地时区偏移。 */
        fun parseUtc(ts: String): Long? {
            return try {
                UTC_FORMAT.parse(ts)?.time
            } catch (e: Exception) {
                // 兜底：毫秒缺失等变体
                try {
                    java.text.SimpleDateFormat(
                            "yyyy-MM-dd'T'HH:mm:ss'Z'",
                            java.util.Locale.US
                    ).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
                            .parse(ts)?.time
                } catch (e2: Exception) {
                    null
                }
            }
        }
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
        webView.addJavascriptInterface(UpdateInterface(this), "AndroidUpdate")
        webView.loadUrl("https://appassets.androidplatform.net/assets/app.html")
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
                // /assets/ 走热更新处理器(hotfix 目录优先，APK assets 兜底)
                .addPathHandler("/assets/", HotfixAssetHandler(this))
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

                    // 安全：禁止 WebView 内导航到远程页面（远程页面可访问全部 JS Bridge，
                    // 包括含 API Key 的设置）。http/https 一律转系统浏览器打开。
                    override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest
                    ): Boolean {
                        val url = request.url ?: return false
                        val scheme = url.scheme ?: return false
                        if (scheme == "http" || scheme == "https") {
                            // 本地资源域(appassets)放行，交给 shouldInterceptRequest；
                            // 远程 http(s) 页面仍然一律转系统浏览器，防止访问 JS Bridge
                            if (url.host == "appassets.androidplatform.net") return false
                            try {
                                startActivity(Intent(Intent.ACTION_VIEW, url))
                            } catch (e: Exception) {
                                // 无可用浏览器时放行，避免死链
                                return false
                            }
                            return true
                        }
                        return false
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
            fileChooserLauncher.launch(Intent.createChooser(intent, "选择文件"))
        } else {
            // ACTION_GET_CONTENT 无需任何存储权限
            val intent =
                    Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "image/*"
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
            fileChooserLauncher.launch(Intent.createChooser(intent, "选择图片"))
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
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

                    // 事务内整体替换，避免并发 sync 时 deleteAll/insertAll 交错导致镜像丢失
                    database.withTransaction {
                        database.noteDao().deleteAll()
                        database.noteDao().insertAll(notes)
                    }
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
                else parseUtc(ts) ?: System.currentTimeMillis()
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
        private val maxResponseBytes = 2 * 1024 * 1024
        private val httpExecutor = java.util.concurrent.Executors.newCachedThreadPool()

        private fun buildConnection(url: String, method: String, connectTimeout: Int, readTimeout: Int): java.net.HttpURLConnection {
            val parsed = java.net.URL(url)
            // 白名单：只允许 http/https，杜绝 file:/content: 等本地文件访问
            val scheme = parsed.protocol
            if (scheme != "http" && scheme != "https") {
                throw IllegalArgumentException("blocked scheme: $scheme")
            }
            val connection = parsed.openConnection() as java.net.HttpURLConnection
            connection.requestMethod = method
            connection.setRequestProperty("User-Agent", "xiaoman/1.0")
            connection.connectTimeout = connectTimeout
            connection.readTimeout = readTimeout
            return connection
        }

        private fun readLimited(stream: java.io.InputStream): String {
            val buffer = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(8192)
            var total = 0
            while (true) {
                val n = stream.read(chunk)
                if (n < 0) break
                total += n
                if (total > maxResponseBytes) {
                    throw RuntimeException("response too large (> ${maxResponseBytes / 1024}KB)")
                }
                buffer.write(chunk, 0, n)
            }
            return String(buffer.toByteArray(), Charsets.UTF_8)
        }

        private fun errorJson(e: Exception): String {
            // 用 JSONObject 转义，避免 message 中的引号/反斜杠破坏 JSON
            return JSONObject().put("error", e.message ?: "unknown error").toString()
        }

        private fun getImpl(url: String): JSONObject {
            val connection = buildConnection(url, "GET", 10000, 10000)
            try {
                val text = readLimited(connection.inputStream)
                return JSONObject().put("ok", true).put("data", text)
            } finally {
                connection.disconnect()
            }
        }

        private fun getImpl(url: String, headersJson: String): JSONObject {
            val connection = buildConnection(url, "GET", 15000, 30000)
            try {
                val headers = JSONObject(headersJson)
                val keys = headers.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    connection.setRequestProperty(key, headers.optString(key))
                }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val text = if (stream != null) readLimited(stream) else ""
                return JSONObject().put("ok", true).put("status", status).put("data", text)
            } finally {
                connection.disconnect()
            }
        }

        private fun postImpl(url: String, headersJson: String, body: String): JSONObject {
            val connection = buildConnection(url, "POST", 30000, 60000)
            try {
                connection.setRequestProperty("Content-Type", "application/json")
                val headers = JSONObject(headersJson)
                val keys = headers.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    connection.setRequestProperty(key, headers.optString(key))
                }
                connection.doOutput = true
                java.io.OutputStreamWriter(connection.outputStream, "UTF-8").use { it.write(body) }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val text = if (stream != null) readLimited(stream) else ""
                return JSONObject()
                        .put("ok", true)
                        .put("status", status)
                        .put("data", text)
            } finally {
                connection.disconnect()
            }
        }

        /** 在 UI 线程回调 JS：window.NativeHttp.__onResponse(callbackId, payload) */
        private fun postToJs(expr: String) {
            try {
                webView.post { webView.evaluateJavascript(expr, null) }
            } catch (e: Exception) {
                // Activity 已销毁等场景，静默丢弃
            }
        }

        @JavascriptInterface
        fun get(url: String): String {
            return try {
                getImpl(url).toString()
            } catch (e: Exception) {
                errorJson(e)
            }
        }

        @JavascriptInterface
        fun post(url: String, headersJson: String, body: String): String {
            return try {
                postImpl(url, headersJson, body).toString()
            } catch (e: Exception) {
                JSONObject()
                        .put("status", 0)
                        .put("body", "")
                        .put("error", e.message ?: "unknown error")
                        .toString()
            }
        }

        /** 带请求头的异步 GET：用于拉取服务商模型列表。 */
        @JavascriptInterface
        fun getAsyncWithHeaders(url: String, headersJson: String, callbackId: String) {
            httpExecutor.execute {
                val payload = try {
                    getImpl(url, headersJson)
                } catch (e: Exception) {
                    JSONObject().put("ok", false).put("error", e.message ?: "unknown error")
                }
                postToJs("window.NativeHttp && window.NativeHttp.__onResponse(${JSONObject.quote(callbackId)}, ${payload.toString()})")
            }
        }

        /** 异步 GET：后台线程执行，完成后回调 JS。避免同步桥阻塞 WebView JS 线程。 */
        @JavascriptInterface
        fun getAsync(url: String, callbackId: String) {
            httpExecutor.execute {
                val payload = try {
                    getImpl(url)
                } catch (e: Exception) {
                    JSONObject().put("ok", false).put("error", e.message ?: "unknown error")
                }
                postToJs("window.NativeHttp && window.NativeHttp.__onResponse(${JSONObject.quote(callbackId)}, ${payload.toString()})")
            }
        }

        /** 异步 POST：后台线程执行，完成后回调 JS。 */
        @JavascriptInterface
        fun postAsync(url: String, headersJson: String, body: String, callbackId: String) {
            httpExecutor.execute {
                val payload = try {
                    postImpl(url, headersJson, body)
                } catch (e: Exception) {
                    JSONObject().put("ok", false).put("error", e.message ?: "unknown error")
                }
                postToJs("window.NativeHttp && window.NativeHttp.__onResponse(${JSONObject.quote(callbackId)}, ${payload.toString()})")
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

        private val mailWorkerExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()

        @JavascriptInterface
        fun sendMail(
                noteContent: String,
                penpalId: String,
                penpalName: String,
                systemPrompt: String
        ) {
            val mailId = "mail_" + System.currentTimeMillis().toString() + "_" + randomSuffix()
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

            mailWorkerExecutor.execute {
                Thread.sleep(3000)
                MailWorker.execute(
                        context.applicationContext,
                        mailId,
                        noteContent,
                        penpalId,
                        penpalName,
                        systemPrompt
                )
            }
        }

        /** 按 id 插入或更新一封邮件。供 JS 端（主动消息/回信更新）写入，与 Worker 写入共用存储。 */
        @JavascriptInterface
        fun upsertMail(mailJson: String) {
            try {
                val prefs = context.getSharedPreferences(mailsKey, Context.MODE_PRIVATE)
                val raw = prefs.getString("mails", "[]") ?: "[]"
                val mails = JSONArray(raw)
                val incoming = JSONObject(mailJson)
                val id = incoming.optString("id", "")
                var found = false
                for (i in 0 until mails.length()) {
                    if (mails.getJSONObject(i).optString("id") == id) {
                        mails.put(i, incoming)
                        found = true
                        break
                    }
                }
                if (!found) mails.put(incoming)
                // 防止无限增长：只保留最近 500 封
                while (mails.length() > MAX_MAILS) {
                    mails.remove(0)
                }
                prefs.edit().putString("mails", mails.toString()).apply()
            } catch (e: Exception) {
                e.printStackTrace()
            }
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

        @JavascriptInterface
        fun deleteMail(mailId: String) {
            val prefs = context.getSharedPreferences(mailsKey, Context.MODE_PRIVATE)
            val raw = prefs.getString("mails", "[]") ?: "[]"
            val mails = JSONArray(raw)
            val remaining = JSONArray()
            for (i in 0 until mails.length()) {
                val mail = mails.getJSONObject(i)
                if (mail.optString("id") != mailId) remaining.put(mail)
            }
            prefs.edit().putString("mails", remaining.toString()).apply()
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
                                            "你是「小满」，一个温暖的 AI 生活伴侣。\n\n" +
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

    /** 热更新桥：JS 经推送服务器下载文件写入暂存区，全部成功后原子切换生效。 */
    inner class UpdateInterface(private val context: Context) {
        private val apkExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()

        /** 清空暂存区，开始一轮新更新 */
        @JavascriptInterface
        fun beginApply(): Boolean {
            return try {
                val staging = File(context.filesDir, HotfixAssetHandler.STAGING_DIR)
                staging.deleteRecursively()
                staging.mkdirs()
                true
            } catch (e: Exception) {
                false
            }
        }

        /** 写单个文件到暂存区(UTF-8 文本) */
        @JavascriptInterface
        fun saveHotfixFile(path: String, content: String): Boolean {
            if (!HotfixAssetHandler.isSafePath(path)) return false
            return try {
                val f = File(context.filesDir, HotfixAssetHandler.STAGING_DIR + "/" + path)
                f.parentFile?.mkdirs()
                f.writeText(content)
                true
            } catch (e: Exception) {
                false
            }
        }

        /** 暂存区整体切换为生效目录，并记录清单(含 version 与文件列表) */
        @JavascriptInterface
        fun commitApply(version: String, manifestJson: String): Boolean {
            return try {
                val staging = File(context.filesDir, HotfixAssetHandler.STAGING_DIR)
                val hotfix = File(context.filesDir, HotfixAssetHandler.HOTFIX_DIR)
                File(staging, "__manifest__.json").writeText(manifestJson)
                hotfix.deleteRecursively()
                staging.renameTo(hotfix)
            } catch (e: Exception) {
                false
            }
        }

        /** 当前热更信息 JSON：{version, files:[...]}；未热更时 version 为空串 */
        @JavascriptInterface
        fun getLocalInfo(): String {
            return try {
                val mf =
                        File(
                                context.filesDir,
                                HotfixAssetHandler.HOTFIX_DIR + "/__manifest__.json"
                        )
                if (mf.isFile) mf.readText() else "{\"version\":\"\",\"files\":[]}"
            } catch (e: Exception) {
                "{\"version\":\"\",\"files\":[]}"
            }
        }

        /** 清除热更，恢复 APK 内置版本 */
        @JavascriptInterface
        fun resetUpdate(): Boolean {
            return try {
                File(context.filesDir, HotfixAssetHandler.HOTFIX_DIR).deleteRecursively()
                true
            } catch (e: Exception) {
                false
            }
        }

        /** 已安装 APK 的版本信息 JSON：{versionCode, versionName, lastUpdateTime} */
        @JavascriptInterface
        fun getAppVersion(): String {
            return try {
                val pm = context.packageManager
                val info =
                        if (android.os.Build.VERSION.SDK_INT >= 33) {
                            pm.getPackageInfo(
                                    context.packageName,
                                    android.content.pm.PackageManager.PackageInfoFlags.of(0)
                            )
                        } else {
                            @Suppress("DEPRECATION")
                            pm.getPackageInfo(context.packageName, 0)
                        }
                val code =
                        if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode
                        else {
                            @Suppress("DEPRECATION") info.versionCode.toLong()
                        }
                JSONObject()
                        .put("versionCode", code)
                        .put("versionName", info.versionName ?: "")
                        .put("lastUpdateTime", info.lastUpdateTime)
                        .toString()
            } catch (e: Exception) {
                JSONObject()
                        .put("versionCode", 0)
                        .put("versionName", "")
                        .put("lastUpdateTime", 0)
                        .toString()
            }
        }

        /**
         * 下载 APK 到 cacheDir/apk/ 并拉起系统安装器（用户只需在系统弹窗点一次「安装」）。
         * 后台线程下载，完成后在 UI 线程启动安装器，并回调 JS：
         * window.Update.__onApkResult(callbackId, {ok:true}|{ok:false,error})
         */
        @JavascriptInterface
        fun downloadAndInstallApk(url: String, callbackId: String) {
            apkExecutor.execute {
                var payload: JSONObject
                try {
                    val parsed = java.net.URL(url)
                    val scheme = parsed.protocol
                    if (scheme != "http" && scheme != "https") {
                        throw IllegalArgumentException("blocked scheme: $scheme")
                    }
                    val dir = File(context.cacheDir, "apk")
                    dir.mkdirs()
                    dir.listFiles()?.forEach { it.delete() }
                    val dest = File(dir, "update.apk")

                    val connection = parsed.openConnection() as java.net.HttpURLConnection
                    connection.connectTimeout = 10000
                    connection.readTimeout = 60000
                    try {
                        connection.inputStream.use { input ->
                            dest.outputStream().use { output -> input.copyTo(output) }
                        }
                    } finally {
                        connection.disconnect()
                    }
                    // APK 至少几百 KB，太小说明拿到的是错误页
                    if (dest.length() < 100 * 1024) {
                        throw RuntimeException("下载内容异常(${dest.length()} 字节)")
                    }

                    val uri =
                            androidx.core.content.FileProvider.getUriForFile(
                                    context,
                                    context.packageName + ".fileprovider",
                                    dest
                            )
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        try {
                            val intent =
                                    Intent(Intent.ACTION_VIEW).apply {
                                        setDataAndType(
                                                uri,
                                                "application/vnd.android.package-archive"
                                        )
                                        addFlags(
                                                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                                        Intent.FLAG_ACTIVITY_NEW_TASK
                                        )
                                    }
                            context.startActivity(intent)
                        } catch (e: Exception) {
                            postToJs(
                                    "window.Update && window.Update.__onApkResult(${JSONObject.quote(callbackId)}, ${JSONObject().put("ok", false).put("error", "无法启动安装器: ${e.message ?: "unknown"}")})"
                            )
                        }
                    }
                    payload = JSONObject().put("ok", true).put("size", dest.length())
                } catch (e: Exception) {
                    payload =
                            JSONObject()
                                    .put("ok", false)
                                    .put("error", e.message ?: "unknown error")
                }
                postToJs("window.Update && window.Update.__onApkResult(${JSONObject.quote(callbackId)}, $payload)")
            }
        }

        /** 在 UI 线程回调 JS（与 HttpInterface.postToJs 一致） */
        private fun postToJs(expr: String) {
            try {
                webView.post { webView.evaluateJavascript(expr, null) }
            } catch (e: Exception) {
                // Activity 已销毁等场景，静默丢弃
            }
        }
    }
}
