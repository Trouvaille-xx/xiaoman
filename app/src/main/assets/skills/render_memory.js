// ─── render_memory Skill ───
// facts[] -> MEMORY.md (Markdown 表格) 自动渲染
// 这是 MEMORY.md 的唯一生成入口, 避免双写不一致
(function() {
  var CATEGORY_LABELS = {
    identity: '身份', preference: '偏好', relationship: '关系',
    goal: '目标', emotion: '情绪', belief: '信念',
    health: '健康', event: '事件'
  };

  window.renderMemorySkill = {
    /**
     * 把 facts[] 渲染成 MEMORY.md 文本
     * @param {Object} dataObj window.__memoryGetData() 返回
     * @returns {string} MEMORY.md 完整内容
     */
    render: function(dataObj) {
      if (!dataObj || !dataObj.facts) return '';
      var v = dataObj.facts.verified || [];
      var d = dataObj.facts.deprecated || [];
      var lines = ['# MEMORY.md — 事实记忆', ''];
      lines.push('> 来源：AI 自动维护 (dreaming 升级时落地)');
      lines.push('> 字段：id · 事实 · 分类 · 置信度 · 跨日数 · 首次/最近 · 来源');
      lines.push('> 用户可一键废弃。');
      lines.push('');

      lines.push('## 已验证事实 (' + v.length + ')');
      lines.push('');
      if (v.length === 0) {
        lines.push('_(暂无)_');
      } else {
        lines.push('| 事实 | 分类 | 置信度 | 跨日数 | 首次 | 最近 | 来源 |');
        lines.push('|---|---|---|---|---|---|---|');
        for (var i = 0; i < v.length; i++) {
          var f = v[i];
          lines.push('| ' + (f.fact || '').replace(/\|/g, '\\|') +
            ' | ' + (CATEGORY_LABELS[f.category] || f.category || '-') +
            ' | ' + (typeof f.confidence === 'number' ? f.confidence.toFixed(2) : '0.50') +
            ' | ' + (f.days || 1) +
            ' | ' + (f.firstAt || '-') +
            ' | ' + (f.lastAt || '-') +
            ' | ' + (f.source || '-').replace(/\|/g, '\\|') + ' |');
        }
      }
      lines.push('');

      if (d.length > 0) {
        lines.push('## 已废弃事实 (' + d.length + ')');
        lines.push('');
        lines.push('| 事实 | 废弃时间 | 原因 |');
        lines.push('|---|---|---|');
        for (var j = 0; j < d.length; j++) {
          var df = d[j];
          lines.push('| ' + (df.fact || '').replace(/\|/g, '\\|') +
            ' | ' + (df.deprecatedAt || '-') +
            ' | ' + (df.reason || '-').replace(/\|/g, '\\|') + ' |');
        }
        lines.push('');
      }

      return lines.join('\n');
    },

    /**
     * 写回到 dataObj.docs['MEMORY.md']
     */
    apply: function(dataObj) {
      var md = this.render(dataObj);
      if (dataObj.docs && dataObj.docs['MEMORY.md']) {
        dataObj.docs['MEMORY.md'].content = md;
        dataObj.docs['MEMORY.md'].updatedAt = new Date().toISOString();
      }
      return md;
    }
  };
})();
