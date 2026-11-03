// ─── get_note Skill ───
// 按 id 获取一篇笔记的完整内容（search_notes 只返回 150 字预览）。
// 用在模型需要引用原文、回信、分析等需要完整内容的场景。
(function() {
  window.getNoteSkill = {
    definition: {
      name: "get_note",
      description: "根据笔记 id 获取一篇笔记的完整内容。用在需要查看笔记全文时，比如引用原文、给笔友写信、结合完整内容分析。先用 search_notes 找到笔记 id，再调用本工具。",
      parameters: {
        type: "object",
        properties: {
          noteId: {
            type: "string",
            description: "笔记 id（来自 search_notes 返回的 id 字段）"
          }
        },
        required: ["noteId"]
      }
    },

    execute: function(args) {
      if (!args || !args.noteId) {
        return { error: "缺少参数：需要 noteId" };
      }
      var allNotes = window.DataService.notes.load();
      if (!allNotes || !allNotes.length) {
        return { error: "没有找到笔记" };
      }
      var note = null;
      for (var i = 0; i < allNotes.length; i++) {
        if (allNotes[i].id === args.noteId) { note = allNotes[i]; break; }
      }
      if (!note) {
        return { error: "未找到指定的笔记: " + args.noteId };
      }
      var content = note.content || '';
      if (content.indexOf("--isHTML ") === 0) content = content.substring(9);
      content = content.replace(/<img[^>]*>/g, "[图片]")
        .replace(/<br\s*\/?>/g, "\n").replace(/<\/p>/g, "\n").replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/\n{3,}/g, "\n\n").trim();
      if (typeof window.__addNoteRef === 'function') {
        window.__addNoteRef({ id: note.id, date: String(note.createdAt || '').slice(0, 10), preview: content.substring(0, 100) });
      }
      return {
        id: note.id,
        content: content.substring(0, 3000),
        createdAt: note.createdAt || ''
      };
    }
  };
})();
