// ─── note_stats Skill ───
// 笔记统计：总数/连续打卡天数/最近活跃/标签榜。让小满能说「你已坚持写日记 N 天」。
(function() {
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  window.noteStatsSkill = {
    definition: {
      name: "note_stats",
      description: "统计用户的日记数据：总笔记数、连续记录天数、最近 7 天记录数、常用标签。用在用户问「我写了多少篇日记」「坚持多久了」时，用来鼓励用户。",
      parameters: {
        type: "object",
        properties: {}
      }
    },

    execute: function() {
      var allNotes = window.DataService.notes.load();
      if (!allNotes || !allNotes.length) {
        return { total: 0, streakDays: 0, recent7: 0, topTags: [] };
      }

      // 去掉欢迎/示例笔记（id 为 welcome / 纯数字）
      var realNotes = allNotes.filter(function(n) {
        return n && n.id !== 'welcome' && !/^\d+$/.test(String(n.id));
      });
      if (!realNotes.length) return { total: 0, streakDays: 0, recent7: 0, topTags: [] };

      // 按天去重统计打卡
      var days = {};
      var now = new Date();
      var today = dayKey(now.getTime());
      var weekAgo = new Date(now.getTime() - 7 * 86400000).getTime();
      var recent7 = 0;

      for (var i = 0; i < realNotes.length; i++) {
        var ts = new Date(realNotes[i].createdAt).getTime();
        if (isNaN(ts)) continue;
        var key = dayKey(ts);
        if (!days[key]) days[key] = 0;
        days[key]++;
        if (ts >= weekAgo) recent7++;
      }

      // 连续打卡天数（从今天/昨天往前数）
      var dayKeys = Object.keys(days);
      var streak = 0;
      var cursor = new Date();
      if (!days[dayKey(cursor.getTime())]) {
        cursor.setDate(cursor.getDate() - 1); // 今天没记，从昨天开始算
      }
      while (days[dayKey(cursor.getTime())]) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
        // 防止死循环
        if (streak > 3660) break;
      }

      // 标签榜
      var tagCount = {};
      var tagRegex = /#([^\s#<]+)/g;
      for (var t = 0; t < realNotes.length; t++) {
        var content = realNotes[t].content || '';
        if (content.indexOf('--isHTML ') === 0) content = content.substring(9);
        content = content.replace(/<[^>]+>/g, '');
        var m;
        while ((m = tagRegex.exec(content)) !== null) {
          var tag = m[1];
          if (tag === '小满记' || tag === '小满' || tag === '念念记' || tag === '念念') continue;
          tagCount[tag] = (tagCount[tag] || 0) + 1;
        }
      }
      var topTags = Object.keys(tagCount)
        .map(function(k) { return { tag: k, count: tagCount[k] }; })
        .sort(function(a, b) { return b.count - a.count; })
        .slice(0, 5);

      return {
        total: realNotes.length,
        streakDays: streak,
        recent7: recent7,
        topTags: topTags
      };
    }
  };
})();
