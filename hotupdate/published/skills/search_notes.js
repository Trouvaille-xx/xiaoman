// ─── search_notes Skill ───
(function() {
  window.searchNotesSkill = {
    definition: {
      name: "search_notes",
      description: "搜索用户的日记笔记，支持按关键词、标签、日期范围筛选。返回笔记的摘要列表供小满参考。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "内容关键词，搜索笔记全文"
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "按标签筛选，如 ['情绪', '工作', '日常']"
          },
          days: {
            type: "number",
            description: "最近 N 天的笔记（从今天往前推）"
          },
          limit: {
            type: "number",
            description: "最多返回条数，默认 10"
          }
        }
      }
    },

    execute: function(args) {
      args = args || {};
      // 从 DataService 获取所有笔记
      var allNotes = window.DataService.notes.load();
      if (!allNotes || !allNotes.length) return [];

      var filtered = allNotes;

      // 按天数筛选
      if (args.days) {
        var cutoff = Date.now() - args.days * 86400000;
        filtered = filtered.filter(function(n) {
          return new Date(n.createdAt).getTime() > cutoff;
        });
      }

      // 按标签筛选
      if (args.tags && args.tags.length > 0) {
        filtered = filtered.filter(function(n) {
          var content = n.content;
          if (content.indexOf("--isHTML ") === 0) content = content.substring(9);
          return args.tags.some(function(tag) {
            var regex = new RegExp("#" + tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|<|$|/)");
            return regex.test(content);
          });
        });
      }

      // 按关键词搜索
      if (args.query) {
        var query = args.query.toLowerCase();
        filtered = filtered.filter(function(n) {
          var content = n.content;
          if (content.indexOf("--isHTML ") === 0) content = content.substring(9);
          content = content.replace(/<[^>]+>/g, "");
          return content.toLowerCase().indexOf(query) !== -1;
        });
      }

      // 限制数量
      var limit = args.limit || 10;
      filtered = filtered.slice(0, limit);

      // 提取预览（节省 Token）
      return filtered.map(function(n) {
        var content = n.content;
        if (content.indexOf("--isHTML ") === 0) content = content.substring(9);
        content = content.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
        return {
          id: n.id,
          preview: content.substring(0, 150),
          createdAt: n.createdAt,
          tags: (content.match(/#([^\s<]+)/g) || []).map(function(t) { return t.substring(1); })
        };
      });
    }
  };
})();
