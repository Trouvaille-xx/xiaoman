// ─── search_notes Skill ───
// 只返回紧凑索引（id / 日期 / 50 字预览），避免工具结果被 Agent 截断。
// 默认返回最近 8 条；用 offset 翻页，用 query/tags/days 缩小范围。
// 需要全文时，让模型继续调用 get_note(noteId)。
(function() {
  function contentText(raw) {
    var content = String(raw || '');
    if (content.indexOf('--isHTML ') === 0) content = content.substring(9);
    return content
      .replace(/<img[^>]*>/gi, '[图片]')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  window.searchNotesSkill = {
    definition: {
      name: "search_notes",
      description: "搜索用户的日记笔记。返回紧凑索引（id、日期、50字预览、标签），并带 total/offset/hasMore。默认/最多 8 条；用 offset 翻页，用 query/tags/days 缩小范围；需要全文时用 get_note(noteId)。",
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
          offset: {
            type: "number",
            description: "从第几条开始返回，默认 0；配合 hasMore 翻页"
          },
          limit: {
            type: "number",
            description: "最多返回条数，默认 8，最大 8；需要更多请用 offset 翻页"
          }
        }
      }
    },

    execute: function(args) {
      args = args || {};
      var allNotes = window.DataService.notes.load();
      if (!allNotes || !allNotes.length) {
        return { total: 0, offset: 0, returned: 0, hasMore: false, notes: [] };
      }

      var filtered = allNotes.slice();

      if (args.days) {
        var days = Number(args.days);
        if (isFinite(days) && days > 0) {
          var cutoff = Date.now() - days * 86400000;
          filtered = filtered.filter(function(n) {
            return new Date(n.createdAt).getTime() > cutoff;
          });
        }
      }

      if (args.tags && args.tags.length > 0) {
        filtered = filtered.filter(function(n) {
          var content = String(n.content || '');
          if (content.indexOf('--isHTML ') === 0) content = content.substring(9);
          return args.tags.some(function(tag) {
            var regex = new RegExp('#' + String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|<|$|/)');
            return regex.test(content);
          });
        });
      }

      if (args.query) {
        var query = String(args.query).toLowerCase();
        filtered = filtered.filter(function(n) {
          return contentText(n.content).toLowerCase().indexOf(query) !== -1;
        });
      }

      // 最近优先：导入的旧笔记也能通过 offset/query 找到
      filtered.sort(function(a, b) {
        var ta = new Date(a.createdAt || 0).getTime() || 0;
        var tb = new Date(b.createdAt || 0).getTime() || 0;
        return tb - ta;
      });

      var offset = Math.max(0, parseInt(args.offset, 10) || 0);
      var limit = Math.max(1, Math.min(8, parseInt(args.limit, 10) || 8));
      var page = filtered.slice(offset, offset + limit);

      var notes = page.map(function(n) {
        var text = contentText(n.content);
        return {
          id: n.id,
          date: String(n.createdAt || '').slice(0, 10),
          preview: text.substring(0, 50),
          tags: (text.match(/#([^\s<]+)/g) || []).map(function(t) { return t.substring(1); }).slice(0, 4)
        };
      });

      return {
        total: filtered.length,
        offset: offset,
        returned: notes.length,
        hasMore: offset + notes.length < filtered.length,
        notes: notes
      };
    }
  };
})();
