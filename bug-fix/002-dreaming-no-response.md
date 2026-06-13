# Bug #002 — Dreaming 点击无反应

**日期**: 2026-06-13  
**严重程度**: P1（核心功能不可用）

---

## 现象

记忆页点击右上角 🌙 dreaming 按钮 → 弹出对话框 → 点"确认整理" → Toast "正在整理..." → 无后续反应。

## 根因（三重）

### 1. XHR CORS（同 #001）

```
runDreaming()
  → xhr.open("POST", url)
  → Authorization header 触发 CORS 预检
  → file:// origin 被拦截
```

### 2. 硬门槛：需要 ≥3 条 SUMMARY

```
summaryLines.length < 3 → done(false) → 静默返回
```

用户可能还没有 3 条摘要记录，dreaming 直接退出，不报错。

### 3. 触发机制可能失效

`memory.js:triggerDreamingFromMemory` 尝试 `window.opener.runDreaming()` —— 但 `memory.html` 是独立页面，`window.opener` 为 `null`。iframe fallback 加载 `../app.html?action=runDreaming`，但 app.js 中没有对应的 URL 参数处理。

## 修复

```js
// runDreaming() 改为:
// 1. 用 AndroidHttp.get() 替代 XHR（同 #001 方案）
// 2. 输入改为 facts.verified[] 列表（而非 SUMMARY.md 时间线）
// 3. 只要有 facts 就跑（去掉 ≥3 门槛）
// 4. setTimeout 异步化（避免 UI 冻结）
```
