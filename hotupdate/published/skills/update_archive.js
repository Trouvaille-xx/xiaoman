// ─── update_archive Skill ───
// Updates the 6 archive files when user shares personal info
(function() {
  window.updateArchiveSkill = {
    definition: {
      name: "update_archive",
      description: "当用户告诉你关于自己的个人信息（如姓名、职业、年龄、喜好、习惯、价值观、目标等），调用此工具将信息写入档案。可更新身份、灵魂、用户、工具、记忆、心跳六个档案文件。如果信息适合归入多个文件，请分别调用。",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            enum: ["identity", "soul", "user", "tools", "memory", "heartbeat"],
            description: "要更新的档案文件：identity(身份/名字/定位)、soul(灵魂/价值观/说话方式)、user(用户/偏好/习惯)、tools(工具路径)、memory(稳定事实兜底)、heartbeat(心跳清单)"
          },
          content: {
            type: "string",
            description: "要写入的完整内容。如果只是补充新信息，请包含原有内容加上新增内容。一条一条清晰地写入。"
          },
          operation: {
            type: "string",
            enum: ["replace", "append"],
            description: "replace=完全替换该文件内容, append=在末尾追加新内容（默认append）"
          }
        },
        required: ["file", "content"]
      }
    },

    execute: function(args) {
      if (!args || !args.file || !args.content) {
        return { error: "缺少必要参数" };
      }

      var validFiles = ["identity", "soul", "user", "tools", "memory", "heartbeat"];
      if (validFiles.indexOf(args.file) === -1) {
        return { error: "无效的档案文件: " + args.file };
      }

      try {
        // 统一走 MemoryService（app.html 中先于 skills 加载）：读 + 迁移 + 长度约束
        if (typeof MemoryService === 'undefined') {
          return { error: "记忆服务未加载" };
        }

        var op = args.operation || "append";
        var content = args.content.trim();

        // v5：identity/soul 写入角色档案，user/memory 写入语义记忆，其余保留在兼容文件
        if (typeof MemoryService.applyArchiveUpdate === 'function') {
          var ok = MemoryService.applyArchiveUpdate(args.file, content, op);
          return ok
            ? { success: true, file: args.file, message: "已更新档案: " + args.file }
            : { error: "更新档案失败" };
        }

        var mem = MemoryService.load();
        if (!mem) mem = MemoryService.createEmpty();
        if (!mem.files) mem.files = {};

        if (op === "replace" || !mem.files[args.file]) {
          mem.files[args.file] = content;
        } else {
          var existing = mem.files[args.file] || "";
          if (existing.indexOf(content) === -1) {
            mem.files[args.file] = existing + (existing ? "\n" : "") + content;
          } else {
            return { success: true, message: "信息已存在，无需重复添加" };
          }
        }

        MemoryService.save(mem);
        return { success: true, file: args.file, message: "已更新档案文件: " + args.file };
      } catch(e) {
        return { error: "更新档案失败: " + e.message };
      }
    }
  };
})();
