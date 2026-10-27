// ─── remember_to Skill ───
// 让小满记住"要在某天提醒用户某事"。到期后由心跳扫描自动主动发信提醒。
(function() {
  window.rememberToSkill = {
    definition: {
      name: "remember_to",
      description: "记住用户要求提醒的事项，在指定日期提醒用户。用在用户说「记得提醒我」「帮我记住X日要做的事」时。提醒会由小满在当天主动发送到信箱。",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "提醒内容，如「周五下午 3 点面试」"
          },
          date: {
            type: "string",
            description: "提醒日期，格式 YYYY-MM-DD。缺省为今天"
          }
        },
        required: ["text"]
      }
    },

    execute: function(args) {
      if (!args || !args.text || !args.text.trim()) {
        return { error: "提醒内容不能为空" };
      }
      if (typeof MemoryService === 'undefined' || typeof MemoryService.loadReminders !== 'function') {
        return { error: "记忆服务不可用" };
      }

      var date = args.date || new Date().toISOString().substring(0, 10);
      // 校验日期格式
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { error: "日期格式应为 YYYY-MM-DD" };
      }

      var reminders = MemoryService.loadReminders();
      var reminder = {
        id: 'rem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        text: String(args.text).trim().substring(0, 200),
        date: date,
        done: false,
        createdAt: Date.now()
      };
      reminders.push(reminder);
      MemoryService.saveReminders(reminders);

      return { success: true, id: reminder.id, date: date, message: "记住了，我会在 " + date + " 提醒你" };
    }
  };
})();
