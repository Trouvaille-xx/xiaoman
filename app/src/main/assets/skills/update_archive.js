// ─── update_archive Skill v2 ───
//
// v4 档案文件 (4 个):
//   SOUL.md          — AI 永不可写 (用户专属)
//   AGENT-RULES.md   — AI 永不可写 (用户专属)
//   USER.md          — AI 只能 propose, 由用户终审
//   MEMORY.md        — 只读视图, AI 不直接改 (通过 facts[] 改写)
//
// operation:
//   replace/append   — 直接写入 (仅对 SOUL/AGENT-RULES 报错, 其余走 propose)
//   propose          — 写入 pending-updates.json, 等用户批/驳
//
// 由于本 App 在 app.html 内运行, propose 实际上同步触发
// 对话流中的"工具调用卡片"由 app.js 拦截。这里我们用同步写法。
(function() {
  var VALID_FILES = ['SOUL.md', 'AGENT-RULES.md', 'USER.md', 'MEMORY.md'];
  var USER_ONLY = ['SOUL.md', 'AGENT-RULES.md'];
  var READONLY = ['MEMORY.md'];

  function loadMem() {
    var isBridge = (typeof AndroidMemory !== 'undefined' && AndroidMemory !== null);
    if (isBridge) {
      var raw = AndroidMemory.loadAll();
      return { data: raw ? JSON.parse(raw) : null, isBridge: isBridge };
    }
    var cached = localStorage.getItem('nian_memories');
    return { data: cached ? JSON.parse(cached) : null, isBridge: false };
  }
  function saveMem(mem) {
    var json = JSON.stringify(mem);
    if (typeof AndroidMemory !== 'undefined' && AndroidMemory !== null) {
      AndroidMemory.saveAll(json);
    } else {
      localStorage.setItem('nian_memories', json);
    }
  }

  window.updateArchiveSkill = {
    definition: {
      name: "update_archive",
      description: "写入或建议更新档案。SOUL.md / AGENT-RULES.md 仅用户可改, AI 调用会报错。USER.md 走 propose (写入 pending, 等用户批驳)。MEMORY.md 是事实表只读视图, AI 不直接改, 改用 add_fact / dedup_facts 工具。",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            enum: VALID_FILES,
            description: "SOUL.md (用户专属) / AGENT-RULES.md (用户专属) / USER.md (propose) / MEMORY.md (只读)"
          },
          content: {
            type: "string",
            description: "要写入的内容"
          },
          operation: {
            type: "string",
            enum: ["replace", "append", "propose"],
            description: "replace/append=直接替换或追加 (仅允许 USER.md 强制覆盖场景); propose=写入 pending 等用户批驳 (默认, 跨所有可写文件)"
          },
          reason: {
            type: "string",
            description: "为什么写这条 (展示给用户看)"
          }
        },
        required: ["file", "content"]
      }
    },

    execute: function(args) {
      if (!args || !args.file || !args.content) {
        return { error: "缺少必要参数 (file / content)" };
      }
      if (VALID_FILES.indexOf(args.file) === -1) {
        return { error: "无效的档案文件: " + args.file };
      }
      if (USER_ONLY.indexOf(args.file) !== -1) {
        return {
          error: args.file + " 仅用户可写，AI 永不可改。请直接告诉用户: '建议你手动在记忆页修改 " + args.file + "'。"
        };
      }
      if (READONLY.indexOf(args.file) !== -1) {
        return {
          error: args.file + " 是只读视图。AI 想写新事实请用 add_fact 工具; 想整理事实请等 dreaming 跑。"
        };
      }

      var op = args.operation || 'propose';
      var content = String(args.content).trim();
      if (!content) return { error: "content 为空" };

      // USER.md 走 propose
      if (args.file === 'USER.md') {
        var r = loadMem();
        var mem = r.data || { version: 4, docs: {} };
        if (!mem.docs) mem.docs = {};
        if (!mem.docs['pending-updates.json']) mem.docs['pending-updates.json'] = { content: '[]', updatedAt: new Date().toISOString() };

        var list = [];
        try { list = JSON.parse(mem.docs['pending-updates.json'].content || '[]'); } catch(e) { list = []; }
        var item = {
          id: 'pend_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          type: 'user_md_update',
          file: args.file,
          operation: op === 'propose' ? 'append' : op,
          content: content,
          reason: args.reason || '',
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        list.push(item);
        mem.docs['pending-updates.json'].content = JSON.stringify(list, null, 2);
        mem.docs['pending-updates.json'].updatedAt = new Date().toISOString();
        mem.version = 4;
        saveMem(mem);
        return { success: true, pending: true, itemId: item.id, message: "已写入 USER.md 待批列表，等用户在记忆页确认" };
      }

      return { error: "未知分支" };
    }
  };
})();
