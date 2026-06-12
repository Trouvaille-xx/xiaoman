package com.niannote.app

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class MailWorker {

    companion object {
        const val TAG = "MailWorker"

        fun execute(
            context: Context,
            mailId: String,
            noteContent: String,
            penpalId: String,
            penpalName: String,
            systemPrompt: String
        ) {
            val settings = loadSettings(context)
            val apiUrl = settings.optString("apiUrl", "")
            val apiKey = settings.optString("apiKey", "")
            val model = settings.optString("model", "gpt-4o")

            if (apiUrl.isEmpty() || apiKey.isEmpty()) {
                saveReply(context, mailId, "念念还没配置 AI 呢~ 请先在设置中配置 API 地址和密钥。")
                return
            }

            try {
                val reply = callAI(apiUrl, apiKey, model, systemPrompt, noteContent)
                saveReply(context, mailId, reply)
            } catch (e: Exception) {
                Log.e(TAG, "AI reply failed for mail $mailId", e)
                saveReply(context, mailId, "抱歉，回信过程中遇到了问题，请稍后再试。")
            }
        }

        private fun callAI(
            apiUrl: String,
            apiKey: String,
            model: String,
            systemPrompt: String,
            noteContent: String
        ): String {
            var url = apiUrl.trimEnd('/')
            if (!url.endsWith("/chat/completions")) {
                url = "$url/chat/completions"
            }

            val connection = URL(url).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $apiKey")
            connection.doOutput = true
            connection.connectTimeout = 30000
            connection.readTimeout = 60000

            val body = JSONObject().apply {
                put("model", model)
                put("messages", JSONArray().apply {
                    put(JSONObject().apply {
                        put("role", "system")
                        put("content", systemPrompt)
                    })
                    put(JSONObject().apply {
                        put("role", "user")
                        put("content", noteContent)
                    })
                })
                put("temperature", 0.8)
                put("max_tokens", 500)
            }

            try {
                val writer = OutputStreamWriter(connection.outputStream)
                writer.write(body.toString())
                writer.flush()
                writer.close()

                val responseCode = connection.responseCode
                if (responseCode != 200) {
                    val errorReader = BufferedReader(InputStreamReader(connection.errorStream))
                    val errorMsg = errorReader.readText()
                    errorReader.close()
                    Log.e(TAG, "API error $responseCode: $errorMsg")
                    throw RuntimeException("API error $responseCode")
                }

                val reader = BufferedReader(InputStreamReader(connection.inputStream))
                val responseText = reader.readText()
                reader.close()

                val json = JSONObject(responseText)
                val choices = json.getJSONArray("choices")
                val message = choices.getJSONObject(0).getJSONObject("message")
                var reply = message.getString("content")

                reply = reply.replace(Regex("<think>[\\s\\S]*?</think>"), "").trim()
                reply = reply.replace(Regex("</?think>"), "").trim()

                return reply
            } finally {
                connection.disconnect()
            }
        }

        private fun loadSettings(context: Context): JSONObject {
            val prefs = context.getSharedPreferences("nian_settings", Context.MODE_PRIVATE)
            val raw = prefs.getString("settings", "") ?: ""
            return if (raw.isEmpty()) JSONObject() else JSONObject(raw)
        }

        private fun saveReply(context: Context, mailId: String, reply: String) {
            val prefs = context.getSharedPreferences("nian_mails", Context.MODE_PRIVATE)
            val raw = prefs.getString("mails", "[]") ?: "[]"
            val mails = JSONArray(raw)

            for (i in 0 until mails.length()) {
                val mail = mails.getJSONObject(i)
                if (mail.getString("id") == mailId) {
                    mail.put("reply", reply)
                    mail.put("replyAt", System.currentTimeMillis().toString())
                    mail.put("status", if (reply.startsWith("抱歉") || reply.contains("还没配置")) "failed" else "replied")
                    break
                }
            }

            prefs.edit().putString("mails", mails.toString()).apply()
            Log.d(TAG, "Reply saved for mail $mailId, status=${reply.take(30)}")
        }
    }
}
