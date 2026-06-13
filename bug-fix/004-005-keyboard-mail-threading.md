# Bug #004 — 聊天/回信输入框不跟随键盘

**日期**: 2026-06-14  
**严重程度**: P1（核心交互体验）

---

## 现象

念念对话页面和邮箱回信页面，键盘弹出后输入框停留在原位（被键盘遮挡），没有向上移动。

## 根因分析

### 失败的尝试历程

1. **CSS `margin-bottom` 加在输入框容器上** — 无效。因为输入框是 flex column 最后子元素，父容器 `height: 100%`，`margin-bottom` 被截掉不可见。

2. **CSS `margin-bottom` 加在 messages 容器上** — 无效。`margin-bottom` 在 flex 上下文中是分隔空间，不压缩元素高度。

3. **JS `scrollIntoView`** — 无效。`adjustNothing` 模式 WebView 不 resize，浏览器认为全屏可见。

4. **`visualViewport` API** — 理论上可用但实测不一致。

### 真正有效的方案：笔记编辑器的实现

笔记编辑器一直能正常跟随键盘，它的实现：

```css
.editor {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    /* JS 动态调 bottom */
}
```

```js
function adjustEditorForKeyboard() {
    var keyboardH = /* --keyboard-height CSS var */;
    if (keyboardH > 0) {
        editor.style.bottom = keyboardH + 'px';  // 贴键盘上方
    } else {
        editor.style.bottom = '';                 // 恢复贴底
    }
}
```

核心原理：`position: fixed` + `bottom` 相对于 viewport 底部定位。键盘弹出时 `bottom = keyboardHeight` 就把元素推到了键盘上方。

### 为什么之前不用这个方案

聊天输入框在 flex column 布局中（不是 `position: fixed`）。改为 `fixed` 会脱离文档流，需要额外处理：
- 键盘收起时恢复 `position: static`（回到 flex 布局）
- `fixed` 状态下给 messages 区域补 `padding-bottom` 防止内容被遮挡

## 修复

在 `__applySafeInsets()` 中新增：

```js
var chatInput = document.querySelector('.nian-chat-input-container');
if (kb > 0) {
    chatInput.style.position = 'fixed';
    chatInput.style.bottom = (kb - sb) + 'px';  // kb=键盘, sb=导航栏
    // 给 messages 留空
    msgs.style.paddingBottom = (chatInput.offsetHeight + kb - sb) + 'px';
} else {
    chatInput.style.position = '';
    chatInput.style.bottom = '';
    msgs.style.paddingBottom = '';
}
```

---

# Bug #005 — 邮箱回信新建对话线程

**日期**: 2026-06-14  
**严重程度**: P1（邮件对话体验）

---

## 现象

邮箱页面点击一封信 → 回复 → 回复没有跟原信放在同一个对话线程里，而是生成了新的独立邮件。

## 根因

`AndroidMail.sendMail()` 在 Kotlin 端每次调用都**创建新 mail 条目**，无法通过参数传递 `threadId`。Kotlin 代码未变（Gradle build 失败），只能在 JS 层做线程管理。

## 修复方案：JS 层线程 + 子邮件自动合并

### 数据流

```
sendReply()
  ├─ 用户回复内容 → mail.thread[].push({role:'user', content, at})
  ├─ saveMailThreads() → localStorage 'nian_mail_threads'
  ├─ 记录时间戳 → localStorage 'nian_mail_pending_replies'
  └─ AndroidMail.sendMail() → MailWorker 创建新 mail → AI 回信

loadMails()
  ├─ AndroidMail.loadMails() → 获取全部 mail (含新创建的)
  ├─ loadMailThreads() → 恢复 localStorage 存的 thread 到 mail 对象
  ├─ filterChildMails() → 扫描新 mail:
  │   - 匹配 pending 时间戳 + 同笔友
  │   - 把 AI 回信内容合并到父 mail.thread[] (role:'assistant')
  │   - 标记子 mail 为 hidden → 从列表删除
  └─ applyMailThreads() → 挂载更新后的 thread
```

### 关键文件

`mail/mail.js`:
- `sendReply()` — 追加 thread + 追踪时间戳
- `loadMailThreads()` / `saveMailThreads()` — localStorage 持久化
- `filterChildMails()` — 子邮件识别与合并
- `applyMailThreads()` / `applyThreads()` — thread 挂载到 mail 对象
- `openDetail()` — 展示完整 thread（原始信 → AI 回 → 你的回复 → AI 再回）
