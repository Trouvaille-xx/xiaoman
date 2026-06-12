// ─── create_note Skill ───
// 让念念能帮用户记录笔记
(function() {
  window.createNoteSkill = {
    definition: {
      name: "create_note",
      description: "帮用户创建一条新笔记。仅在用户明确要求「帮我记一下」「记录」「保存」「写一条笔记」等时调用。不要在日常闲聊、打招呼、问候、询问天气、搜索信息、分析洞察、回复问题时自动调用。用户没有明确要求记录，就绝对不要记。",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "笔记内容"
          }
        },
        required: ["content"]
      }
    },

    execute: function(args) {
      if (!args || !args.content || !args.content.trim()) {
        return { error: "内容不能为空" };
      }

      var content = args.content.trim();
      if (content.indexOf("#念念记") === -1) {
        content = content + "\n\n#念念记";
      }

      // 优先走桥接函数（同步到 UI）
      if (typeof window.__agentCreateNote === "function") {
        window.__agentCreateNote(content);
        return { success: true, message: "笔记已创建" };
      }

      // fallback：直接写存储
      var allNotes = window.DataService.notes.load() || [];
      var note = {
        id: "note_" + Date.now(),
        content: content,
        createdAt: new Date().toISOString()
      };
      allNotes.unshift(note);
      window.DataService.notes.save(allNotes);

      return { success: true, noteId: note.id, message: "笔记已创建" };
    }
  };
})();
