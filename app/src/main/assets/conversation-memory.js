// ─── conversation-memory.js: 笔友记忆系统 ───
// 让笔友记住和用户的过往来信与用户关键事实，回信时注入上下文，
// 避免每次回信都是"失忆"的独立回复。
// 兼容 Android 原生桥（AndroidMail / AndroidMemory）与浏览器 localStorage。
(function() {
  function loadMails() {
    try {
      if (typeof AndroidMail !== 'undefined' && AndroidMail.loadMails) {
        return JSON.parse(AndroidMail.loadMails() || '[]');
      }
      return JSON.parse(localStorage.getItem('nian_mails_cache') || '[]');
    } catch(e) { return []; }
  }

  // 读取用户关键事实（facts + memory 文件要点），供笔友"懂你"
  function loadUserFacts() {
    try {
      if (typeof AndroidMemory !== 'undefined' && AndroidMemory.loadAll) {
        var data = JSON.parse(AndroidMemory.loadAll() || '{}');
        var out = [];
        var facts = data.facts || [];
        for (var i = 0; i < facts.length; i++) {
          if (facts[i] && facts[i].fact) out.push(facts[i].fact);
          if (out.length >= 8) break;
        }
        return out;
      }
    } catch(e) {}
    return [];
  }

  function stripHtml(text) {
    if (!text) return '';
    var t = String(text);
    if (t.indexOf('--isHTML ') === 0) t = t.substring(9);
    t = t.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return t.replace(/\s+/g, ' ').trim();
  }

  function truncate(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.substring(0, max) + '…';
  }

  // 生成笔友记忆上下文，追加到系统提示词末尾。
  // basePrompt: 笔友的基础人设提示词；返回 basePrompt + 记忆段。
  window.buildPenpalContext = function(penpalId, basePrompt) {
    var extra = '';

    // 1) 过往来信：最近 8 轮完整往来（用户寄信 + 笔友回信）
    var mails = loadMails().filter(function(m) {
      return m.penpalId === penpalId && m.reply && m.noteContent;
    }).slice(-8);
    if (mails.length > 0) {
      var lines = [];
      for (var i = 0; i < mails.length; i++) {
        var m = mails[i];
        lines.push('用户：' + truncate(stripHtml(m.noteContent), 150));
        lines.push('你：' + truncate(stripHtml(m.reply), 150));
      }
      extra += '\n\n## 你和用户的过往来信\n' + lines.join('\n');
    }

    // 2) 用户关键事实（帮助笔友"懂你"）
    var facts = loadUserFacts();
    if (facts.length > 0) {
      extra += '\n\n## 关于用户的关键事实\n' + facts.map(function(f) { return '- ' + f; }).join('\n');
    }

    return basePrompt + extra;
  };
})();
