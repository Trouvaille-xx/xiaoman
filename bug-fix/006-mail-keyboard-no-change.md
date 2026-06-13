
# Bug #006 — 回信输入框键盘跟随始终失效 / 高度异常

**日期**: 2026-06-14  
**严重程度**: P0（反复修复 6 次以上均无效）

---

## 现象

邮箱页面点击回信后，输入框不跟随键盘弹出，或弹起高度异常（过高/过低），与笔记编辑器和聊天输入框的表现不一致。用户反复反馈"没有任何变化"。

---

## 根因（两层）

### 第 1 层：重建脚本遗漏文件

`rebuild_v4mem.py` 的 REPLACE 列表中没有 `mail.js`、`mail.html`、`mail.css`。  
之前在 diff 审计时，因为这些文件与 base APK 无差异而被移除，但后续多次修改 mail 相关代码后**从未加回**。

**结果**：对 mail.js/mail.css 的所有修改，重建 APK 时使用的仍是 Jun 12 的旧文件。

### 第 2 层：CSS `margin-bottom` 与 JS `bottom` 叠加

修复第 1 层后，键盘跟随生效但高度错误（过高）。

**原理**：

```
笔记编辑器（正确）:
  .editor { position: fixed; bottom: 0; }
  JS: editor.style.bottom = keyboardHeight + 'px';
  → bottom 定位 margin 外边缘，无 margin → 元素 = keyboardHeight

回信输入框（错误）:
  .reply-compose { margin-bottom: calc(var(--keyboard-height) - var(--safe-area-bottom)); }
  JS: compose.style.bottom = keyboardHeight + 'px';
  → bottom 定位 margin 外边缘
  → 实际位置 = keyboardHeight + margin-bottom ≈ 2 × keyboardHeight
  → 输入框被推到键盘上方两倍高度
```

**CSS 规范**：`position: fixed` 元素的 `bottom` 属性定位的是 **margin 外边缘**（margin edge），而非 content edge。CSS `margin-bottom` 会把元素再往上推 `margin-bottom` 的距离。

---

## 修复

1. `rebuild_v4mem.py` REPLACE 列表增加 `mail.html`、`mail.js`、`mail.css`
2. `mail.css` 移除 `.reply-compose` 的 `margin-bottom` 规则
3. `mail.js` `__applySafeInsets()`：`bottom = kb`（与笔记编辑器公式一致）
4. `app.js` 聊天输入框同样修正为 `bottom = kb`

---

## 教训

1. **每次改动文件后，必须确认 rebuild 脚本包含该文件**。不能依赖"上次 diff 没变所以不需要"的假设。更好的做法：rebuild 脚本应该自动检测所有 changed files，而非手动维护 REPLACE 列表。

2. **CSS `position: fixed` + `bottom` 的正确定位公式**：
   - `bottom` 定位的是 **margin 外边缘**（不是 content edge）
   - 如果需要同时使用 `margin`（如 padding 替代），必须从 `bottom` 值中减去 `margin`
   - 最简单安全的方式：`position: fixed` 的元素**不要有 `margin-bottom`**，用 `padding-bottom` 代替

3. **对比已有工作代码是最有效的调试手段**。笔记编辑器一直正常，但花了 6 次迭代才完全对齐其公式。每次改动前应先用 diff 工具逐行对比。

4. **APK 内容验证不足**。在多次"无变化"反馈后，应该立即怀疑 rebuild 脚本本身，而非反复调整代码逻辑。
