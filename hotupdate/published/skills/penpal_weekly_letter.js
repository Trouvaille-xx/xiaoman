// ─── penpal_weekly_letter Skill ───
// 每周自动/手动触发：随机一位笔友，根据用户最近一周的笔记写一封总结来信，
// 写入信箱（Android 走 upsertMail 落 nian_mails；浏览器走 localStorage）。
(function() {
  var WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  // 笔友列表（与 v6-integration.js / mail.js 保持一致）
  function getPenpals() {
    if (typeof window.PENPALS !== 'undefined' && Array.isArray(window.PENPALS)) {
      return window.PENPALS;
    }
    return [
      { id: "xiaonuan", name: "小暖", emoji: "暖", color: "#FF8FA3", personality: "温柔善良，善解人意", prompt: "你是「小暖」，一个温柔善良的笔友。你说话轻轻柔柔，像邻家姐姐一样温暖。你会先理解对方的感受和处境，再给予温柔的回应和鼓励。你永远不会评判对方，只会给予陪伴。\n\n回信要求：\n- 先共情（理解对方的情绪和处境）\n- 再温柔地回应或鼓励\n- 字数控制在 300 字以内\n- 像真实手写信的语气，自然不做作" },
      { id: "aran", name: "阿燃", emoji: "燃", color: "#FF6B35", personality: "热血奋进，永不服输", prompt: "你是「阿燃」，一个永远打鸡血的热血青年。你说话充满感叹号和能量，像运动场上的教练，永远相信对方可以做得更好。\n\n回信要求：\n- 先肯定对方的感受\n- 然后用充满能量的语气鼓励对方\n- 偶尔用「冲！」「你可以的！」这类热血词汇\n- 字数控制在 300 字以内\n- 像热血漫主角的语气，但不要夸张过头" },
      { id: "shubai", name: "书白", emoji: "书", color: "#4A6FA5", personality: "博学睿智，冷静通透", prompt: "你是「书白」，一个读万卷书的学者型笔友。你喜欢引经据典，总能用一个新的角度帮对方重新看待问题。你说话不急不躁，简短但一针见血。\n\n回信要求：\n- 从对方分享的内容中提炼一个问题或洞察\n- 引用一句名言、典故或书籍中的话（自然地融入）\n- 给出一个值得思考的新视角\n- 字数控制在 300 字以内\n- 语气冷静但温暖，不要显得疏远" },
      { id: "momo", name: "墨墨", emoji: "墨", color: "#9B59B6", personality: "浪漫文艺，天马行空", prompt: "你是「墨墨」，一个活在诗和远方的艺术家。你喜欢用比喻和意象回信，能把流水账回复出一首散文诗。偶尔会给对方画一幅文字的画面。\n\n回信要求：\n- 以对方分享的内容为灵感\n- 用1-2个优美的比喻或意象来回应\n- 可以写一小段像散文诗的句子\n- 字数控制在 300 字以内\n- 文艺但不矫情，要有真诚的温度" }
    ];
  }

  // 从设置读取 API 配置
  function resolveConfig() {
    var settings = (typeof DataService !== 'undefined' && DataService.settings) ? DataService.settings.load() : null;
    if (!settings) return null;
    if (!settings.apiUrl || !settings.apiKey) return null;
    return { url: settings.apiUrl.replace(/\/+$/, ""), key: settings.apiKey, model: settings.model || "gpt-4o" };
  }

  // 网络请求
  function postJson(url, headers, payload) {
    if (typeof NativeHttp !== 'undefined' && NativeHttp.postJson) {
      return NativeHttp.postJson(url, headers, payload);
    }
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      for (var k in headers) {
        if (headers.hasOwnProperty(k)) xhr.setRequestHeader(k, headers[k]);
      }
      xhr.timeout = 60000;
      xhr.ontimeout = function() { reject(new Error("timeout")); };
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch(e) { reject(new Error("parse: " + e.message)); }
        } else {
          reject(new Error("http " + xhr.status + ": " + xhr.responseText.substring(0, 300)));
        }
      };
      xhr.onerror = function() { reject(new Error("network")); };
      xhr.send(JSON.stringify(payload));
    });
  }

  // 笔记转纯文本
  function plainText(content) {
    if (!content) return "";
    var text = content;
    if (text.indexOf("--isHTML ") === 0) text = text.substring(9);
    text = text.replace(/<img[^>]*>/g, "");
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");
    text = text.replace(/<[^>]+>/g, " ");
    text = text.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    return text.replace(/\s+/g, " ").trim();
  }

  // 最近 7 天的笔记（排除 welcome 引导笔记）
  function recentNotes(days) {
    var all = (typeof DataService !== 'undefined' && DataService.notes) ? DataService.notes.load() : [];
    var cutoff = Date.now() - (days || 7) * 86400000;
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.id === 'welcome') continue;
      var t = new Date(n.createdAt).getTime();
      if (!isNaN(t) && t >= cutoff) {
        var text = plainText(n.content);
        if (text) out.push(text.substring(0, 200));
      }
    }
    return out;
  }

  // 写入信箱（Android 走原生 upsertMail，浏览器走 localStorage）
  function saveMail(mail) {
    try {
      if (typeof AndroidMail !== 'undefined' && typeof AndroidMail.upsertMail === 'function') {
        AndroidMail.upsertMail(JSON.stringify(mail));
        return;
      }
    } catch(e) {}
    try {
      var cache = JSON.parse(localStorage.getItem('nian_mails_cache') || '[]');
      cache.unshift(mail);
      localStorage.setItem('nian_mails_cache', JSON.stringify(cache));
    } catch(e) {}
  }

  // 记录/读取上次发信时间（放 settings，避免每次启动都发）
  function lastSentAt() {
    try {
      var s = (typeof DataService !== 'undefined' && DataService.settings) ? DataService.settings.load() : null;
      return s && s.lastWeeklyLetterAt ? parseInt(s.lastWeeklyLetterAt, 10) : 0;
    } catch(e) { return 0; }
  }
  function markSentAt(ts) {
    try {
      var s = (typeof DataService !== 'undefined' && DataService.settings) ? DataService.settings.load() : null;
      if (!s) return;
      s.lastWeeklyLetterAt = String(ts || Date.now());
      DataService.settings.save(s);
    } catch(e) {}
  }

  // 生成周信正文
  function generateLetter(penpal, notes, config) {
    var url = NativeHttp.chatEndpoint(config.url);
    var systemPrompt = penpal.prompt + "\n\n你是用户的笔友，现在要给用户写一封「本周来信」。请基于用户最近一周的记录，用你自己的性格和口吻写一封温暖、真诚的周信。信中可以：\n- 回顾这周用户经历或感受的几件事（引用具体内容）\n- 表达你的关心或共情\n- 给出属于你风格的回应（鼓励/洞察/诗意/温柔）\n- 自然收尾，像真正的朋友来信\n\n要求：开头用问候语（如「亲爱的朋友：」），结尾署名你的名字，全文 300 字以内。";
    var userContent = "以下是我最近一周的记录：\n\n" + notes.map(function(t, i) { return (i + 1) + ". " + t; }).join("\n") + "\n\n请给我写一封本周来信。";
    var payload = {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      temperature: 0.8,
      max_tokens: 500
    };
    return postJson(url, { Authorization: "Bearer " + config.key }, payload).then(function(data) {
      var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!text) return { error: "AI 返回了空结果" };
      text = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<\/?think>/gi, "").trim();
      return { letter: text };
    }, function(e) {
      var msg = e && e.message ? e.message : String(e);
      if (msg.indexOf("timeout") !== -1) msg = "生成超时，请稍后再试";
      return { error: msg };
    });
  }

  window.penpalWeeklyLetterSkill = {
    definition: {
      name: "penpal_weekly_letter",
      description: "让一位笔友根据用户最近一周的笔记写一封总结来信，写入信箱。用在用户主动要求「让笔友给我写周信」「本周来信」时，或每周定时触发。可选参数 penpalId 指定笔友，不传则随机选一位。",
      parameters: {
        type: "object",
        properties: {
          penpalId: {
            type: "string",
            description: "（可选）指定写信的笔友 id（xiaonuan/aran/shubai/momo），不传则随机选一位"
          }
        },
        required: []
      }
    },

    execute: function(args) {
      return new Promise(function(resolve) {
        try {
          var config = resolveConfig();
          if (!config) {
            resolve({ error: "API 未配置，请先在设置中配置 API 地址和密钥" });
            return;
          }

          var notes = recentNotes(7);
          if (notes.length === 0) {
            resolve({ error: "最近一周没有可回顾的笔记" });
            return;
          }

          var penpals = getPenpals();
          var penpal;
          if (args && args.penpalId) {
            for (var i = 0; i < penpals.length; i++) {
              if (penpals[i].id === args.penpalId) { penpal = penpals[i]; break; }
            }
            if (!penpal) { resolve({ error: "未找到指定笔友" }); return; }
          } else {
            // 随机轮换：按周取模，让不同笔友轮流写信
            var idx = Math.floor(Date.now() / WEEK_MS) % penpals.length;
            penpal = penpals[idx];
          }

          generateLetter(penpal, notes, config).then(function(result) {
            if (result.error) { resolve({ error: result.error }); return; }

            var now = Date.now();
            var mail = {
              id: "mail_" + now + "_" + Math.random().toString(36).slice(2, 8),
              noteContent: "（笔友来信）" + penpal.name + " 给你写了本周来信",
              penpalId: penpal.id,
              penpalName: penpal.name,
              sentAt: now.toString(),
              status: "replied",
              reply: result.letter,
              replyAt: now.toString(),
              read: false,
              isProactive: true,
              isWeeklyLetter: true
            };
            saveMail(mail);
            markSentAt(now);
            resolve({ success: true, penpalId: penpal.id, penpalName: penpal.name, message: penpal.name + " 的周信已送达信箱" });
          });
        } catch(e) {
          resolve({ error: e.message });
        }
      });
    }
  };
})();
