# Bug #001 — AI 对话 "Network error" / "API 未配置"

**日期**: 2026-06-13  
**严重程度**: P0（聊天核心功能完全不可用）  
**影响范围**: 小满 Android App 云端版本（所有用户）

---

## 现象

小满对话页面发送消息后，显示：
- `[XHR] Network error` 或 `连接 AI 失败: Network error，请检查 API 地址和密钥设置`
- `API 未配置`
- `Cleartext HTTP traffic to 115.159.116.240 not permitted`

## 根因链条

这是一个**四层连环 bug**，每修复一层暴露下一层：

### 第 1 层：CORS — `AndroidApi.post()` 不存在

```
app.js buildNianSystemPrompt / extractMemoryFromNote / runDreaming
  → agent.js _callLLM
  → XMLHttpRequest POST (file:// origin + Authorization header)
  → CORS preflight blocked
  → "Network error"
```

**原因**：`agent.js:_callLLM` 使用 `XMLHttpRequest` 发 POST 到后端 `http://115.159.116.240:3456/v1/chat/completions`，附带 `Authorization: Bearer <token>` 头。WebView 在 `file:///android_asset/` 下发起带自定义头的跨域请求会触发 CORS 预检（OPTIONS），被浏览器拦截。

**尝试修复**：改用 `AndroidApi.post()`（Kotlin `ApiInterface.post`，原生 `HttpURLConnection`，不受 CORS 限制）。

**为什么失败**：base APK（2026-06-12 由 Gradle 构建）的 `classes.dex` 中**没有** `ApiInterface` 类——它是后来添加到 `MainActivity.kt` 源码中的，但从未被编译进 APK。rebuild 脚本只替换了 `assets/` 下的文件，不重新编译 Kotlin。

**Gradle 编译尝试**：在本机 `./gradlew assembleDebug` 失败——`java.io.IOException: Unable to establish loopback connection`（Windows 网络安全策略阻止 Gradle Daemon 的 loopback 连接）。

### 第 2 层：Bridge 适配 — 用已有的 `AndroidHttp.get()`

```
agent.js _callLLM
  → 改用 AndroidHttp.get()（auth.js 登录用的同一 bridge，已确认可用）
  → 后端需要支持 GET + token 在 query param 中
```

**后端改动**：
1. `auth.js`: `authMiddleware` 改为同时检查 header 和 query param `?token=xxx`
2. `server.js`: `/v1/chat/completions` 接受 GET 方法
3. `chat.js`: `handleOpenAIProxy` 对 GET 请求从 `?q=<url-encoded JSON>` 读取 payload
4. `.env`: 模型从 MiniMax-M3 切换为 `deepseek-v4-flash`，API URL 改为 `https://api.deepseek.com/v1`

**部署方式**：SSH (`ubuntu@115.159.116.240`, key: `D:\key.pem`) → scp 上传 → kill + 重启 Node 进程。

### 第 3 层：URL 超长

```
GET /v1/chat/completions?token=xxx&q=<10000+ 字符的 JSON payload>
→ 服务端拒收
→ "[HttpG] unexpected response"
```

**原因**：`agent.js` 构造的 `q` 参数包含：
- 完整 system prompt（~5000 字符：SOUL + AGENT-RULES + USER + MEMORY 全量）
- 完整 tools 定义（~5000 字符：8 个 function definitions）
- 对话历史 + 用户消息

HTTP GET URL 有长度限制（通常 8KB），10000+ 字符超出。

**修复**：
- `buildNianSystemPrompt()`: 截断各部分（soul≤800, rules≤400, user≤400, memory≤400，合计 ≤2000）
- `agent.js`: 移除 `payload.tools`（暂时不加 function calling，等有 `AndroidApi.post()` 后恢复）

**遗患**：AI 回复时没有 tool calling 能力（`update_archive`、`create_note` 等），等 Gradle 编译后可恢复。

### 第 4 层：UI 冻结

```
用户发送消息
  → appendChild(userMsg) 到 DOM          ← 已执行
  → sendViaAgent → agent.process → _callLLM
  → AndroidHttp.get() 同步阻塞             ← 问题！
  → 浏览器没机会 repaint → 用户消息不可见
  → HTTP 返回 → AI 回复渲染
  → 用户消息 + AI 回复同时出现
```

**原因**：`AndroidHttp.get()` 是 `@JavascriptInterface` 同步方法，调用时阻塞整个 JS 线程直至 HTTP 响应返回。期间浏览器无法执行 repaint。

**修复**：`agent.js:_callLLM` 中 `AndroidHttp.get()` 调用包裹在 `setTimeout(..., 50)` 中，让浏览器先渲染用户消息再发请求。

### 第 5 层（附带）：`usesCleartextTraffic`

```
Android 系统层面拦截 HTTP 明文请求
→ "Cleartext HTTP traffic to 115.159.116.240 not permitted"
```

**原因**：base APK 的 `AndroidManifest.xml` 不含 `android:usesCleartextTraffic="true"`（Gradle 源码有，但构建日期在添加该属性之前）。`patch_manifest.py` 生成的二进制 manifest 中资源 ID `0x0101021b` 可能不正确。

**修复**：从确认可用的旧 APK (`_v2/app-debug-patched.apk`) 中直接提取 manifest 并复用。

---

## 解决方案汇总

| 层 | 文件 | 改动 |
|---|---|---|
| 1-2 | `agent.js` | `_callLLM`: XHR → `AndroidHttp.get()` + `setTimeout(50)` 异步化 |
| 1-2 | `backend/auth.js` | `authMiddleware`: 支持 `?token=xxx` query param |
| 1-2 | `backend/server.js` | chat 路由: `method === 'POST'` → `method === 'POST' \|\| method === 'GET'` |
| 1-2 | `backend/chat.js` | `handleOpenAIProxy`: 新增 GET 分支，从 `?q=` 读 payload |
| 1-2 | `backend/.env` | `OPENAI_API_URL` → `https://api.deepseek.com/v1`, `OPENAI_MODEL` → `deepseek-v4-flash` |
| 3 | `app.js:buildNianSystemPrompt` | 截断 soul/rules/user/memory 到 800/400/400/400 字符 |
| 3 | `agent.js:process` | 移除 `payload.tools` |
| 4 | `agent.js:_callLLM` | `AndroidHttp.get()` 包裹 `setTimeout(fn, 50)` |
| 5 | `_v2/AndroidManifest.xml` | 从 `app-debug-patched.apk` 提取可用 manifest |

---

## 教训

1. **只要涉及后端/bridge 层的问题，第一时间要 SSH 密钥**。本次绕了 3 个小时排查 JS/CSS/CORS，最后发现根因在 `classes.dex` 和 `.env`。
2. **rebuild 脚本只 patch assets/，不碰 classes.dex**。任何 Kotlin 改动需要完整 Gradle 编译。
3. **`@JavascriptInterface` 同步方法会冻结 UI**。所有原生 bridge 调用都应该 `setTimeout` 包裹。
4. **GET URL 有长度限制**（~8KB），大 payload 必须用 POST。
