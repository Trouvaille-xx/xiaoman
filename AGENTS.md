# AGENTS.md

小满 (xiaoman) — Android WebView hybrid app. UI is HTML/JS rendered inside a WebView; Kotlin is a thin native shell. **Most feature work happens in `app/src/main/assets/`, not in Kotlin.**

## Commands

- Windows-only repo: no `gradlew` script, only `gradlew.bat`. Use `.\gradlew.bat assembleDebug` (or `assembleRelease`), or build via Android Studio.
- No test/ or androidTest/ source sets exist — there is nothing to run for verification. Verify JS changes in a running app/emulator; Kotlin changes compile-check with `assembleDebug`.
- Not a git repo. No CI.

## Build chain

- Gradle 8.9 wrapper (do NOT downgrade to match AGP), AGP 8.7.0, Kotlin 2.0.21, KSP for Room 2.6.1.
- compileSdk/targetSdk 36, minSdk 24. AGP 8.7 + SDK 36 require a current JDK (17+); Kotlin targets JVM 1.8.
- Root `gradle.properties`: `android.overridePathCheck=true` (project dir name differs from rootProject.name "xiaoman" — expected).

## Architecture

- Three layers: JS in WebView ↔ 9 JavascriptInterface bridges (all inner classes in `MainActivity.kt`) ↔ Room + SharedPreferences + filesystem.
- Bridge map: `AndroidStorage` (notes: SharedPreferences JSON + Room sync), `AndroidSettings`, `AndroidShare`, `AndroidMail` (incl. `upsertMail`), `AndroidMemory`, `AndroidFile`, `AndroidImage`, `AndroidHttp` (`getAsync`/`postAsync` async callback bridges; `get`/`post` sync wrappers), `AndroidUpdate` (hot update: `beginApply`/`saveHotfixFile`/`commitApply`/`getLocalInfo`/`resetUpdate`; staging dir `hotfix_staging` atomically swapped into `hotfix`. App self-update: `getAppVersion`, `downloadAndInstallApk(url, callbackId)` → downloads to `cacheDir/apk/` and launches the system installer via FileProvider, then calls back `window.Update.__onApkResult(id, payload)`).
- Storage split matters: notes/settings/mails/memories are **single-key JSON blobs** in SharedPreferences (rewrite the whole JSON, never partial); Room `nian_database` only mirrors notes and images; images live as files under `/files/images/` + `/files/thumbs/`.
- **Security**: `WebViewClient.shouldOverrideUrlLoading` blocks http(s) navigation inside the WebView (opens external browser), except host `appassets.androidplatform.net` (the local WebViewAssetLoader origin that serves the app UI) — remote pages must never see the JS bridges. `AndroidHttp` only allows http/https schemes.
- **Network**: JS should call APIs via `native-http.js` (`NativeHttp.postJson/getAsync`) — on Android it routes through the native async bridges (no CORS, off the JS thread); in a plain browser it falls back to XHR. Never add a raw `fetch`/`XMLHttpRequest` to the API from page code — use `NativeHttp`. API 地址一律经 `NativeHttp.chatEndpoint/embeddingsEndpoint/imageEndpoint` 归一化（裸域名自动补 `/v1`、已带端点不会重复拼接、`?query` 原样保留），**不要自己拼 `+ '/chat/completions'`**；调用失败用 `NativeHttp.explainError(err, url)` 把 401/404/400/超时/连不上翻译成用户能照着改的话。
- **Memory system**: `memory-service.js` is the single read/write gateway (load/save/updateFile/appendMemory/buildSystemPrompt with per-section char caps + facts injection + v1→v4 migration). All memory writers (app.js extraction/dreaming, memory page, `update_archive` skill) go through it. Data shape: `{version:4, persona:'xiaoman', files:{identity,soul,user,tools,memory,heartbeat}, moments:[], facts:[], sessions:[], reminders:[]}`. `persona` 是品牌标记：旧数据无该字段时 `migrate()` 一次性把自称 念念 改成 小满（只换人设文件里的自称短语，用户自己写的 user/memory/heartbeat、时刻、事实不碰）。
- **品牌形象**: 品牌标 = 黑猫（矢量母版 `mascot/logo/cat-mark.png`，客户端 `assets/mascot/xiaoman-logo.png` 透明底 256）；顶栏品牌标由 `app.js` 克隆侧栏 `.drawer-lockup` 里的那份 `<img class="brand-mark">`（同一张图只维护一处），洞察模式退化为纯文字。小满头像 = `assets/mascot/xiaoman-avatar.png`（黑猫头特写，透明底 512）；聊天里助手头像由 `app.html` 的 `.nian-message.assistant::before` 纯 CSS 挂载（不动任何消息生成分支，历史消息也生效），回忆空间与信箱空状态用 `../mascot/` 相对路径（浏览器预览的根目录是 assets，App 里是 `/assets/`，相对路径两边都成立）；引导页开场图 + 第二个引导页的分享圆点也用形象图；信箱里小满这位笔友的头像同样用形象图（mail.js 笔友数据的 `avatarImg` 字段 + `penpalAvatarHtml()` 辅助函数，其余笔友仍走 emoji 与主题色底）。注意 `xiaoman-hero.png` / `xiaoman-sleepy.png` 仍是旧黄猫插画（只用在引导页大图与空状态，未跟随换标）。启动图标 = `res/mipmap-*` 位图 + `res/drawable-nodpi/ic_launcher_foreground.png`（自适应前景，只放黑猫）+ 奶白满底 `drawable/ic_launcher_background.xml`（纯色 `#FDFAF3`）。**不要把启动图标底色改回深色/渐变** —— 小米等桌面按自适应图标裁切后，图形外那圈深色底会变成一圈深色外边。
- **Context budget**: `agent.js` caps the chat input at `contextBudgetTokens` (default 3000) with CJK-aware token estimation. When over budget it **summarizes the oldest messages via a compacting LLM call** (`_ensureBudget` → `_summarize`, summary ≤ 600 chars merged into the system prompt) and keeps only the last `recentKeepCount` messages; if the summarize call fails it falls back to dropping the oldest. Summaries persist per conversation (`conv.summary` in `nian_conversations`) and restore on conversation switch/reload. Keep budget/caps sane when touching chat.
- `assets/agent.js` is the in-app AI agent core (function-calling loop); `assets/skills/*.js` are its tool definitions (e.g. `search_notes.js`, `web_search.js`) — new agent capabilities are added as skill files registered via `registerSkill`.
- `MailWorker.kt` does AI replies via OpenAI-compatible HTTP (serialized on a single executor). API settings live in the `nian_settings` JSON.

## Gotchas

- Images must be loaded via `https://appassets.androidplatform.net/images/...` (WebViewAssetLoader), never `file://`.
- Keyboard insets are handled purely in JS via `window.__applySafeInsets(top, bottom, keyboard)` (`adjustNothing` in the manifest); inset values are physical pixels — divide by `devicePixelRatio` in CSS.
- Avoid `content-visibility: auto` in scrollable containers in WebView CSS — it breaks menu/popup stacking.
- `saveImagesSync`/`saveImageFromBase64` intentionally use `runBlocking` so JS gets image IDs before rendering — preserve that sync contract.
- No storage permissions are requested at runtime (`ACTION_GET_CONTENT` needs none) — don't add permission requests for image picking.
- Native async bridges callback JS via `window.__onNativeHttpResponse(id, payload)` — payload is a JSON envelope `{ok, status?, data?, error?}`.

## Win 后台管理系统（admin）

- `node admin/server.js [port]`（默认 8787）→ http://127.0.0.1:8787 —— 零依赖 Node 服务：
  - 工具开关（13 个 skill 启用/禁用）、人设/任务/笔友默认提示词、洞察模式、默认模型、遥测地址管理
  - 配置存 `admin/config.json`；**导出**生成 `app/src/main/assets/app-config.js`（`window.NIAN_CONFIG`），客户端各页面最先加载它
  - 遥测日志：客户端每次 agent 调用完成后 POST 到 `NIAN_CONFIG.telemetry.url`（浏览器模式直接上报；Android 端走原生桥），`admin/logs.jsonl` 存储，UI 可查看
- 配置覆盖优先级：用户设置（settings）> NIAN_CONFIG > 客户端内置。改配置后必须点"保存并导出到 App"，刷新客户端生效。
- 新增工具（13 个）：search_notes / get_note / note_stats / daily_review / create_note / update_archive / remember_to / get_special_day / send_proactive_mail / web_search / get_weather / run_insight / list_insight_modes。`remember_to` 到期提醒由 app.js 心跳扫描（启动 + 每 30 分钟）触发主动发信。

## Tests

- `node js-tests/run-tests.js` — 234 个断言：agent 上下文预算/总结/执行事件(onStep)/日志(onLog)、MemoryService（配置覆盖/损坏恢复备份/时间衰减 facts/reminders）、NativeHttp 回调分发与 API 端点归一化、新工具逻辑（配图/周信/笔友记忆/笔友档案）、hotupdate 差量计算 / UTF-8 字节校验 / APK 版本比较（无依赖，vm 沙箱加载真实资产文件）。
- `node hotupdate/push.js` — 热更新打包：assets → `hotupdate/published/` + manifest.json（sha1）。改完代码后执行一次即"确认推送"。
- `node hotupdate/server.js [port]` — 热更新 LAN 服务（默认 8788）：GET `/manifest.json`、`/files/<path>`、`/apk`（最新 APK 下载）、`/`（发布页）。手机在 设置→AI设置→热更新服务器 填地址，启动自动检查、可手动检查；大更新时手机浏览器打开该地址直接下载 APK 安装。
- `.\dev-publish.ps1` — **一键发布（推荐）**：自动判断是否有原生层改动（Kotlin/Manifest/res 时间戳对比 APK）→ 大更新自动 `assembleDebug` 并复制 APK 到 `hotupdate/apk/`，然后推送热更新并打印手机端地址。参数：`-ForceApk` 强制重建 APK、`-SkipApk` 仅热更新。
- 常驻链路（已配置登录自启，正常无需手动运行）：计划任务 `xiaoman-HotUpdate` → `hotupdate/start-hidden.vbs` 静默拉起 `server.js`(8788) 与 `watch.js`。`watch.js` 监视 `app/src/main/assets`，内容真的变了就自动 push（按内容指纹去重，空保存不推），日志 `hotupdate/watch.log`。因此改 JS/CSS/HTML 不需要任何命令，手机端下次启动 App 自动热加载；常驻服务已在跑时手动再执行 `server.js` 会报端口占用（正常）。
- `node serve.js [port]` — 浏览器预览（8080/8090），内置 `/proxy/<真实URL>` 转发解决 CORS。
- `node admin/server.js` — Win 后台（8787）。
- `.\gradlew.bat assembleDebug` — Kotlin 编译检查。
- **版本号自动化 + 构建即发布**：`app/build.gradle.kts` 用构建时间生成 `versionCode`（2020-01-01 起的分钟数，单调递增，安装器才接受覆盖安装）与 `versionName`（`1.0.yyMMdd-HHmm`）；`assembleDebug` 结束后自动执行 `syncDebugApkToHotupdate`，把 APK 复制到 `hotupdate/apk/xiaoman-debug.apk` 并写 `apk-info.json`（versionCode/versionName/size/builtAt）。**因此构建完就已经发布，不需要手动拷包**。
- **App 内自更新**：服务端 `GET /apk.json` 返回上述元信息；手机端 `hotupdate.js` 的 `checkApk()`（读原生 `getAppVersion()` 比 versionCode）→ `installApk()`（原生 `downloadAndInstallApk` 下载到 `cacheDir/apk/` 并用 FileProvider 拉起系统安装器，用户只点一次「安装」）。设置→AI设置 有「检查 App 更新」按钮，App 启动时也会静默检查一次（同一版本只提示一次，见 settings `apkPromptedCode`）。首次需要手动装一次带新桥方法的 APK，之后即可应用内升级。

## References

- `CLAUDE.md` (Chinese) is the detailed source of truth: full bridge table, data flows, manifest quirks, SharedPreferences keys, and the repo's development rules (简洁优先, 精准修改, etc.). Follow it for anything not covered here.
