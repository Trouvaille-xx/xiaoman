// ─── daily_review Skill ───
// 今日/近期回顾：返回最近几天的笔记摘要，供小满开场和共情。
(function() {
  function getPlain(note) {
    var content = note.content || '';
    if (content.indexOf('--isHTML ') === 0) content = content.substring(9);
    content = content.replace(/<img[^>]*>/g, '[图片]')
      .replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n').trim();
    return content;
  }

  window.dailyReviewSkill = {
    definition: {
      name: "daily_review",
      description: "回顾用户最近几天（默认今天和昨天）的日记，返回笔记列表。用在对话开场想知道用户最近状态、或用户问「我今天写了什么」「帮我看看最近的日记」时。",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "回顾最近 N 天（默认 2 天）"
          },
          limit: {
            type: "number",
            description: "最多返回几条（默认 5）"
          }
        }
      }
    },

    execute: function(args) {
      args = args || {};
      var days = parseInt(args.days, 10) || 2;
      if (days < 1) days = 1;
      if (days > 30) days = 30;
      var limit = parseInt(args.limit, 10) || 5;

      var allNotes = window.DataService.notes.load();
      if (!allNotes || !allNotes.length) return [];

      var cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - (days - 1));
      var cutoffTs = cutoff.getTime();

      var matched = allNotes.filter(function(n) {
        var ts = new Date(n.createdAt).getTime();
        return !isNaN(ts) && ts >= cutoffTs && n.id !== 'welcome';
      });
      matched.sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
      matched = matched.slice(0, limit);

      return matched.map(function(n) {
        var plain = getPlain(n);
        return {
          id: n.id,
          date: (n.createdAt || '').substring(0, 10),
          preview: plain.substring(0, 200)
        };
      });
    }
  };
})();
