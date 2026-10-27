# Bug #003 — 引用笔记只显示 20 条

**日期**: 2026-06-13  
**严重程度**: P2（功能受限）

---

## 现象

小满对话页 → 点击"引用笔记" → 弹出笔记选择器 → 只显示最近 20 条笔记 → 往下滚动一小段就到底了 → 其余笔记看不到。

## 根因

```js
// app.js:openNotePicker() line 321
var recent = notes.slice(0, 20);  // 写死 20 条上限
```

## 修复

```js
var recent = notes.slice();  // 全量
```

> CSS 已支持 `max-height: 80vh` + `overflow-y: auto`，滚动无问题。
