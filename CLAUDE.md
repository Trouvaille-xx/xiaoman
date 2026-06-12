# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

念念 (NianNote) Android 原生应用 — Kotlin WebView 混合架构，WebView 加载本地 HTML/JS 资源，原生层提供存储、图片管理和系统能力。

## 命令

```bash
./gradlew assembleDebug      # Debug 构建
./gradlew assembleRelease    # Release 构建
# 或用 Android Studio 打开此目录
```

## 技术栈

- **语言**: Kotlin 2.0.21
- **构建**: AGP 8.7.0, Gradle 8.9, KSP 2.0.21-1.0.27
- **数据库**: Room 2.6.1 (KSP 编译)
- **异步**: kotlinx-coroutines-android 1.7.3
- **UI**: WebView 混合 (原生壳 + HTML/JS 渲染)
- **minSdk**: 24, **targetSdk/compileSdk**: 36
- **applicationId**: `com.niannote.app`

## 架构

### 总览 — 三层存储架构

```
JS 渲染层 (WebView 内 HTML/JS)
  ↕ 8 个 JavascriptInterface Bridge
Kotlin Bridge 层 (MainActivity.kt 内部类)
  ↕ Room DAO / ImageFileManager / HttpURLConnection
存储层: Room DB (文本) + 文件系统 (图片) + SharedPreferences (设置/信箱/记忆)
```

### 源代码结构

```
app/src/main/java/com/niannote/app/
├── MainActivity.kt         # Activity + 8个 JS Bridge 接口 (内部类)
├── MailWorker.kt           # AI 笔友后台回信 (OpenAI 兼容 API)
└── data/
    ├── Entities.kt         # Room 实体: NoteEntity, ImageEntity
    ├── Daos.kt             # NoteDao, ImageDao (suspend 函数)
    ├── AppDatabase.kt      # Room 单例 (nian_database, version 1)
    └── ImageFileManager.kt # 图片文件管理 (Base64解码/缩略图/CRUD)

app/src/main/assets/
├── app.html                # WebView 入口
├── style.css               # 全局样式
├── app.js                  # 主逻辑
├── insight/                # 洞察页面
├── memory/                 # 记忆管理系统 (memory.html/css/js)
└── mail/                   # 信箱页面
```

### 8 个 JavaScript Bridge 接口

| Bridge | JS 名称 | 存储 | 核心方法 |
|--------|---------|------|----------|
| StorageInterface | `AndroidStorage` | SharedPreferences `nian_notes_data` + Room | `loadNotes`, `saveNotes`, `syncNotesToDb(json)`, `getNotesCount` |
| SettingsInterface | `AndroidSettings` | SharedPreferences `nian_settings` | `loadSettings`, `saveSettings` |
| ShareInterface | `AndroidShare` | — | `share(text)` → 系统分享 Intent |
| MailInterface | `AndroidMail` | SharedPreferences `nian_mails` | `sendMail`, `loadMails`, `getUnreadCount`, `markRead`, `markAllRead` |
| MemoryInterface | `AndroidMemory` | SharedPreferences `nian_memories` | `loadAll`, `saveAll` (v2 格式: soul/user/facts) |
| FileInterface | `AndroidFile` | 文件系统 + Room images 表 | `saveImageFromBase64`, `getImageBase64`, `deleteImage`, `deleteImagesForNote` |
| ImageInterface | `AndroidImage` | 文件系统 + Room images 表 | `saveImagesSync` (批量), `getImageData`, `ping`, `getFileProviderAuthority` |
| HttpInterface | `AndroidHttp` | — | `get(url)` → 原生 HTTP GET (绕过 WebView CORS) |

### 数据流

**笔记保存**: JS `saveNote()` → `AndroidStorage.saveNotes()` (SharedPreferences) + `AndroidStorage.syncNotesToDb()` (Room 后台同步，提取 #标签 存入 tags 字段)

**图片保存**: JS `saveImages(base64[])` → `AndroidImage.saveImagesSync()` → Base64 解码写文件 + 生成 200px 缩略图 + Room images 表插入 (runBlocking 同步等待) → 返回 `[{id, path}]`

**图片加载**: JS 请求图片 → `AndroidFile.getImageBase64(path)` → 文件读回 Base64 → 或直接使用 `https://appassets.androidplatform.net/images/` (WebViewAssetLoader)

**AI 回信**: JS `AndroidMail.sendMail()` → 3 秒延迟 → `MailWorker.execute()` → HTTP POST OpenAI 兼容 API → 清理 `&lt;think&gt;` 标签 → 写入 `nian_mails`

**HTTP 请求**: JS → `AndroidHttp.get(url)` → `HttpURLConnection` GET → 返回响应文本（绕过 WebView CORS 限制）

**文件选择**: WebView `onShowFileChooser` → 根据 accept 类型分支：
- HTML/text → `ACTION_OPEN_DOCUMENT` 导入文件（无需权限）
- 图片 → 请求 `READ_MEDIA_IMAGES` 权限 → `ACTION_GET_CONTENT` 多选

### 图片系统

- **存储**: `/files/images/{uuid}.jpg` (原图) + `/files/thumbs/{uuid}_thumb.jpg` (200px 缩略图)
- **访问**: WebViewAssetLoader 暴露 `https://appassets.androidplatform.net/images/` URL
- **DB 记录**: ImageEntity (id, noteId, filePath, thumbPath, createdAt)
- **清理**: 删除笔记时联动删除关联图片文件和 DB 记录
- **FileProvider**: `com.niannote.app.fileprovider`，路径配置在 `res/xml/file_paths.xml`

### 记忆系统 (L0-L3)

四层分层架构，数据存 SharedPreferences `nian_memories` (JSON, v2 格式):
- **L0 会话记忆**: 内存中 nianMessages[] 数组 (最多 20 条)
- **L1 摘要记忆**: 定时生成 (待实现)
- **L2 事实记忆**: 结构化事实卡片 (8 分类: 身份/偏好/关系/目标/情绪/信念/健康/事件)
- **L3 档案记忆**: 可编辑 Markdown 文件 (soul.md / user.md / facts.md), 通过 `memory/memory.html` 管理

念念对话的记忆注入: `buildNianSystemPrompt()` → soul.md 做主 prompt + user.md + facts.md 追加 + nianMessages[] 历史上下文

## AndroidManifest 关键配置

- **权限**: `INTERNET`, `READ_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`
- **软键盘**: `windowSoftInputMode="adjustNothing"` — 键盘避让完全由 JS 通过 `window.__applySafeInsets(top, bottom, keyboard)` 自行处理
- **配置变更**: `configChanges="orientation|screenSize|screenLayout|keyboardHidden"` — 旋转/键盘变化不重建 Activity
- **返回键**: `onBackPressed` 优先 WebView `goBack()`，无可回退时退出 Activity
- **FileProvider**: `androidx.core.content.FileProvider`，authority 为 `${applicationId}.fileprovider`

## SharedPreferences Keys

| Key | 内部子键 | 内容 | 格式 |
|-----|---------|------|------|
| `nian_notes_data` | `"notes"` | 笔记数据 | JSON 数组 |
| `nian_settings` | `"settings"` | 设置 (API配置/洞察提示词/主题) | JSON 对象 |
| `nian_mails` | `"mails"` | 信箱 (发信/回信) | JSON 数组 |
| `nian_memories` | `"data"` | 记忆系统 (soul/user/facts/sessions) | JSON (v2) |

## Gotchas

- **`content-visibility: auto` 菜单堆叠 Bug**: Chromium WebView 中 `content-visibility: auto` 创建堆叠上下文，导致菜单/弹窗被其他元素遮盖。避免在可滚动容器中使用，或对弹窗使用 `position: fixed` + 高 `z-index`
- **`adjustNothing`**: Activity 使用 `windowSoftInputMode="adjustNothing"`，键盘避让完全由 JS 通过 `window.__applySafeInsets(top, bottom, keyboard)` 自行处理
- **安全区物理像素**: `systemBars.top` 返回物理像素，CSS 中需除以 `devicePixelRatio` 转为逻辑像素
- **SharedPreferences 单 Key**: 所有数据以大 JSON 字符串存储，修改任何子字段需整体序列化/反序列化
- **Room 同步写**: `saveImagesSync` 和 `saveImageFromBase64` 使用 `runBlocking` 确保图片写入 DB 后再返回 JS，避免渲染时取不到数据
- **WebViewAssetLoader**: 图片通过 `https://appassets.androidplatform.net/images/` URL 加载，不是 `file://` 路径
- **Gradle 8.9**: wrapper 配置的 Gradle 版本是 8.9，不要降级到 8.7

## 开发规则

> **权衡说明**: 这些规则偏向谨慎而非速度。对于简单任务，请自行判断。

### 1. Coding 前先思考

不要假设。不要隐藏疑惑。明确说出权衡。

**实现前：**
- 明确陈述假设。不确定时，直接问。
- 存在多种解释时，全部提出——不要静默选择。
- 存在更简单的方案时，指出它。有异议时据理力争。
- 有不清楚的地方，停下来。说出哪里不明白，然后问。

### 2. 简洁优先

用最少的代码解决问题。不做投机性开发。

- 不添加需求之外的功能。
- 不为一次性代码创建抽象。
- 不添加未被要求的"灵活性"或"可配置性"。
- 不处理不可能发生的错误。
- 如果写了 200 行而可以用 50 行完成，重写。

**自问**: "高级工程师会觉得这太复杂吗？"如果会，简化。

### 3. 精准修改

只改必须改的。只清理自己的烂摊子。

**编辑现有代码时：**
- 不"改进"相邻代码、注释或格式。
- 不重构没坏的东西。
- 匹配现有风格，即使你会有不同做法。
- 发现无关的死代码，指出它——不要删除。

**你的改动产生孤立代码时：**
- 移除因你的改动而不再使用的 import/变量/函数。
- 不要移除已有的死代码，除非被要求。

**检验标准**: 每一行改动都应该直接追溯到用户需求。

### 4. 目标驱动执行

定义成功标准。循环验证直到完成。

将任务转化为可验证的目标：

- "添加验证" → "为无效输入写测试，然后让它们通过"
- "修复 bug" → "写一个能复现问题的测试，然后让它通过"
- "重构 X" → "确保重构前后测试都通过"

**多步骤任务，简短计划：**

1. \[步骤] → 验证: \[检查方式]
2. \[步骤] → 验证: \[检查方式]
3. \[步骤] → 验证: \[检查方式]

**强的成功标准让你能独立循环。弱的标准("让它能工作")需要不断确认。**
