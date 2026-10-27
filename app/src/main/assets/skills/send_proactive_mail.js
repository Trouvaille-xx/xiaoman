// ─── send_proactive_mail Skill ───
// 让小满能通过信箱主动给用户发消息
(function() {
  window.sendProactiveMailSkill = {
    definition: {
      name: "send_proactive_mail",
      description: "通过信箱给用户发送一条消息。用在你想主动告诉用户什么事情时，比如注意到用户连续几天情绪低落想关心一下，或者发现用户达成了一个值得庆祝的成就。",
      parameters: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "消息简短主题，如「我发现…」「注意到…」"
          },
          message: {
            type: "string",
            description: "消息正文，用温暖自然的语气写给用户"
          },
          penpalId: {
            type: "string",
            description: "（可选）发件笔友，默认 nian"
          }
        },
        required: ["subject", "message"]
      }
    },

    execute: function(args) {
      if (!args || !args.subject || !args.message) {
        return { error: "缺少主题或内容" };
      }

      var penpalId = args.penpalId || "nian";

      // 构造邮件
      var mail = {
        id: "mail_" + Date.now(),
        noteContent: args.subject + "\n\n" + args.message,
        penpalId: penpalId,
        penpalName: "小满",
        sentAt: Date.now().toString(),
        status: "replied",
        reply: args.message,
        replyAt: Date.now().toString(),
        read: false,
        isProactive: true
      };

      // 写存储：Android 端走原生 upsertMail（落 nian_mails，未读角标可见）；
      // 兼容旧数据：同时保留 settings.proactiveMails 供 mail.html 合并读取
      if (typeof AndroidMail !== "undefined") {
        try {
          if (typeof AndroidMail.upsertMail === "function") {
            AndroidMail.upsertMail(JSON.stringify(mail));
          }
          var s = DataService.settings.load() || {};
          var proactiveMails = s.proactiveMails || [];
          proactiveMails.unshift(mail);
          if (proactiveMails.length > 200) proactiveMails = proactiveMails.slice(0, 200);
          s.proactiveMails = proactiveMails;
          DataService.settings.save(s);
        } catch(e) {
          return { error: "保存失败: " + e.message };
        }
      } else {
        // 浏览器 fallback
        try {
          var cache = JSON.parse(localStorage.getItem('nian_mails_cache') || '[]');
          cache.unshift(mail);
          localStorage.setItem('nian_mails_cache', JSON.stringify(cache));
        } catch(e) {
          return { error: "保存失败: " + e.message };
        }
      }

      return { success: true, mailId: mail.id, message: "消息已发送到信箱" };
    }
  };
})();
