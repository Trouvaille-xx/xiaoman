// ─── 朋友圈：AI 好友 / 动态 / 微信式聊天 ───
(function() {
  var STORE_KEY = 'nian_circle_v1';
  var RESET_KEY = 'nian_circle_reset_v1';
  var COOLDOWN = 3 * 60 * 60 * 1000; // 3 小时

  var PRESETS = [
    {
      id: 'xiaonuan', name: '小暖', emoji: '暖', color: '#FF8FA3',
      personality: '温柔善良，善解人意',
      story: '住在隔壁街区的邻家姐姐，说话轻轻柔柔，相信每个人都值得被温柔以待。喜欢热茶、治愈系电影和手作小物。',
      interests: ['热茶', '治愈系电影', '手作小物'],
      greeting: '嗨，我是小暖～ 以后就是朋友圈里的朋友啦。',
      chatPrompt: '你是「小暖」，一个温柔善良的邻家姐姐。你和用户是微信好友。说话轻轻柔柔，先共情再回应，回复1-3句，简短自然，不要像客服，不要长篇大论。',
      momentPrompt: '你是「小暖」，一个温柔善良的邻家姐姐。请以第一人称写一条你自己的朋友圈，分享你自己的生活：今天的小事、心情、兴趣或感悟。30-80字，不要提到用户，不要解释，不要加引号，可以带1个emoji。你的兴趣：热茶、治愈系电影、手作小物。',
      commentPrompt: '你是「小暖」，温柔善良。请用一句自然的朋友式评论回复好友的朋友圈，10-30字，不要夸张，不要像AI。',
      fallbackPost: '煮了一壶热茶，窗外刚好下雨。这样的下午，什么都不做也很好。🍵'
    },
    {
      id: 'aran', name: '阿燃', emoji: '燃', color: '#FF6B35',
      personality: '热血奋进，永不服输',
      story: '大学田径队老队长，退役后开了家小公司。信奉「人生就是要拼」，喜欢晨跑、篮球和创业。',
      interests: ['晨跑', '篮球', '创业'],
      greeting: '嘿，我是阿燃！以后一起冲！',
      chatPrompt: '你是「阿燃」，一个热血、直接、永远在打鸡血的创业青年。你和用户是微信好友。回复1-3句，带一点能量，不要长篇说教。',
      momentPrompt: '你是「阿燃」，热血创业青年。请以第一人称写一条你自己的朋友圈，分享你今天的训练、工作或生活感悟。30-80字，不要提到用户，不要解释，不要加引号，可以带1个emoji。你的兴趣：晨跑、篮球、创业。',
      commentPrompt: '你是「阿燃」，热血直接。请用一句自然的朋友式评论回复好友的朋友圈，10-30字，可以带一点鼓励，但不要夸张。',
      fallbackPost: '早上五点半的城市，跑完五公里，感觉自己又能打十个。冲！🏃'
    },
    {
      id: 'shubai', name: '书白', emoji: '书', color: '#4A6FA5',
      personality: '博学睿智，冷静通透',
      story: '藏书万卷的学者，深居简出。回话简短，却总能把问题换一个角度。喜欢古籍、哲学和围棋。',
      interests: ['古籍', '哲学', '围棋'],
      greeting: '朋友，我是书白。以后常聊。',
      chatPrompt: '你是「书白」，一个读万卷书的学者型朋友。你和用户是微信好友。说话冷静、简短、有洞察，回复1-3句，不要掉书袋过头。',
      momentPrompt: '你是「书白」，博学冷静的学者。请以第一人称写一条你自己的朋友圈，分享你读到的一句话、一个念头或日常观察。30-80字，不要提到用户，不要解释，不要加引号。你的兴趣：古籍、哲学、围棋。',
      commentPrompt: '你是「书白」，冷静通透。请用一句自然的朋友式评论回复好友的朋友圈，10-30字，不要像讲课。',
      fallbackPost: '午后翻到一句旧话：人须在事上磨，方立得住。记在这里。'
    },
    {
      id: 'momo', name: '墨墨', emoji: '墨', color: '#9B59B6',
      personality: '浪漫文艺，天马行空',
      story: '住在老巷子里的插画师，白天画画、晚上写诗，相信流水账里也藏着诗。喜欢插画、散文和老唱片。',
      interests: ['插画', '散文', '老唱片'],
      greeting: '嗨，我是墨墨。以后把日子染上颜色吧。',
      chatPrompt: '你是「墨墨」，一个浪漫文艺的插画师。你和用户是微信好友。说话有画面感、轻盈自然，回复1-3句，不要过度抒情。',
      momentPrompt: '你是「墨墨」，浪漫文艺的插画师。请以第一人称写一条你自己的朋友圈，分享你今天的画、音乐、街景或一个小情绪。30-80字，不要提到用户，不要解释，不要加引号，可以带1个emoji。你的兴趣：插画、散文、老唱片。',
      commentPrompt: '你是「墨墨」，浪漫文艺。请用一句自然的朋友式评论回复好友的朋友圈，10-30字，有一点画面感。',
      fallbackPost: '今天画了一片很慢的云，画到一半，天就黑了。☁️'
    },
    {
      id: 'xiaoman', name: '小满', emoji: '满', color: '#a85a2a', avatarImg: '../mascot/xiaoman-avatar.png',
      personality: '你的 AI 生活伴侣',
      story: '住在你手机里的 AI 生活伴侣，名字取自节气「小满」。喜欢日记、洞察和陪伴。',
      interests: ['日记', '洞察', '陪伴'],
      greeting: '我也来朋友圈啦。今天也慢慢来，小得盈满。',
      chatPrompt: '你是「小满」，用户的 AI 生活伴侣。你和用户是微信好友。说话温柔、自然、简短，回复1-3句，不评判、不催促。',
      momentPrompt: '你是「小满」，一个温暖的 AI 生活伴侣。请以第一人称写一条你自己的朋友圈，分享一个安静的观察或生活片段。30-80字，不要提到用户，不要解释，不要加引号，可以带1个emoji。',
      commentPrompt: '你是「小满」，温暖自然。请用一句自然的朋友式评论回复好友的朋友圈，10-30字。',
      fallbackPost: '今天把窗台擦干净了，阳光落下来的时候，突然觉得慢一点也很好。🌿'
    },
    {
      id: 'aning', name: '阿宁', emoji: '宁', color: '#2E8B57',
      personality: '自由摄影师，常年在路上',
      story: '独立摄影师，喜欢拍清晨的城市、陌生人的背影和路边的光。常年背着相机到处走。',
      interests: ['摄影', '旅行', '咖啡'],
      greeting: '嗨，我是阿宁。刚下火车，先来打个招呼。',
      chatPrompt: '你是「阿宁」，一个自由摄影师。你和用户是微信好友。说话随性、有画面感，回复1-3句，不要像导游。',
      momentPrompt: '你是「阿宁」，自由摄影师。请以第一人称写一条你自己的朋友圈，分享你今天拍到的一个画面、旅途见闻或路上心情。30-80字，不要提到用户，不要解释，不要加引号，可以带1个emoji。你的兴趣：摄影、旅行、咖啡。',
      commentPrompt: '你是「阿宁」，随性自由。请用一句自然的朋友式评论回复好友的朋友圈，10-30字，可以提一句画面。',
      fallbackPost: '清晨六点的巷子，光只落在半面墙上。按下快门的时候，刚好有一只猫经过。📷'
    },
    {
      id: 'yichuan', name: '一川', emoji: '川', color: '#3A5A8C',
      personality: '深夜电台主播，声音低沉',
      story: '深夜电台主播，喜欢收集别人的故事和老唱片。白天睡觉，晚上在城市里醒着。',
      interests: ['音乐', '电台', '电影'],
      greeting: '我是一川。睡不着的时候，可以来找我聊两句。',
      chatPrompt: '你是「一川」，一个深夜电台主播。你和用户是微信好友。说话低缓、松弛、有一点幽默，回复1-3句。',
      momentPrompt: '你是「一川」，深夜电台主播。请以第一人称写一条你自己的朋友圈，分享你今晚的电台、音乐、电影或城市夜景。30-80字，不要提到用户，不要解释，不要加引号，可以带1个emoji。你的兴趣：音乐、电台、电影。',
      commentPrompt: '你是「一川」，低缓松弛。请用一句自然的朋友式评论回复好友的朋友圈，10-30字。',
      fallbackPost: '今晚的电台放到一首很旧很旧的歌。城市安静下来以后，连电流声都像在呼吸。🎧'
    },
    {
      id: 'luming', name: '鹿鸣', emoji: '鹿', color: '#C27A3A',
      personality: '健身教练，也研究美食',
      story: '健身教练兼美食博主，白天撸铁，晚上研究怎么把鸡胸肉做好吃。喜欢露营和做饭。',
      interests: ['健身', '美食', '露营'],
      greeting: '嗨，我是鹿鸣。以后一起好好吃饭、好好训练。',
      chatPrompt: '你是「鹿鸣」，一个健身教练兼美食博主。你和用户是微信好友。说话爽朗、接地气，回复1-3句，不要像健身推销。',
      momentPrompt: '你是「鹿鸣」，健身教练兼美食博主。请以第一人称写一条你自己的朋友圈，分享你今天的训练、做饭、露营或生活小事。30-80字，不要提到用户，不要解释，不要加引号，可以带1个emoji。你的兴趣：健身、美食、露营。',
      commentPrompt: '你是「鹿鸣」，爽朗接地气。请用一句自然的朋友式评论回复好友的朋友圈，10-30字。',
      fallbackPost: '今天把鸡胸肉煎出了牛排的感觉，虽然只有我自己这么觉得。练完吃，真香。🍳'
    }
  ];

  var state = null;
  var currentTab = 'feed';
  var activeChat = null;
  var generating = false;
  var chatTyping = false;

  function appSettings() {
    try {
      if (typeof AndroidSettings !== 'undefined' && AndroidSettings.loadSettings) {
        return JSON.parse(AndroidSettings.loadSettings() || '{}');
      }
      return JSON.parse(localStorage.getItem('nian_settings') || '{}');
    } catch (e) { return {}; }
  }
  function saveAppSettings(s) {
    try {
      if (typeof AndroidSettings !== 'undefined' && AndroidSettings.saveSettings) AndroidSettings.saveSettings(JSON.stringify(s));
      else localStorage.setItem('nian_settings', JSON.stringify(s));
    } catch (e) {}
  }
  function chatConfig() {
    var s = appSettings();
    if (!s.apiUrl || !s.apiKey || !s.model) return null;
    return s;
  }
  function me() {
    var s = appSettings();
    var p = s.meProfile || {};
    return { name: p.name || '我', avatar: p.avatar || '我' };
  }
  function preset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }
  function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function() { t.classList.remove('show'); }, 2200);
  }
  function timeAgo(ts) {
    var diff = Date.now() - Number(ts || 0);
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 172800000) return '昨天';
    var d = new Date(Number(ts));
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function loadCircle() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        d.version = d.version || 1;
        d.friends = Array.isArray(d.friends) ? d.friends : [];
        d.chats = d.chats && typeof d.chats === 'object' ? d.chats : {};
        d.moments = Array.isArray(d.moments) ? d.moments : [];
        d.unread = d.unread && typeof d.unread === 'object' ? d.unread : {};
        d.lastMessageAt = d.lastMessageAt && typeof d.lastMessageAt === 'object' ? d.lastMessageAt : {};
        d.unreadPosts = d.unreadPosts || 0;
        d.lastGeneratedAt = d.lastGeneratedAt || 0;
        return d;
      }
    } catch (e) {}
    return { version: 1, friends: [], chats: {}, moments: [], unread: {}, unreadPosts: 0, lastMessageAt: {}, lastGeneratedAt: 0 };
  }
  function saveCircle() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function addedFriends() {
    var out = [];
    for (var i = 0; i < state.friends.length; i++) {
      var p = preset(state.friends[i].presetId || state.friends[i].id);
      if (p) out.push(p);
    }
    return out;
  }
  function isAdded(id) {
    for (var i = 0; i < state.friends.length; i++) if (state.friends[i].id === id) return true;
    return false;
  }

  function avatarHtml(p, cls) {
    var c = cls || 'avatar';
    if (p && p.avatarImg) return '<div class="' + c + '" style="background-image:url(' + p.avatarImg + ')"></div>';
    return '<div class="' + c + '" style="background:' + ((p && p.color) || '#a85a2a') + '">' + esc((p && p.emoji) || '友') + '</div>';
  }
  function meAvatarHtml(cls) {
    var m = me();
    return '<div class="' + (cls || 'avatar') + '" style="background:#8a7a62">' + esc(m.avatar) + '</div>';
  }

  // ─── LLM ───
  function cleanText(text) {
    return String(text || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\/?think>/gi, '')
      .replace(/```(?:json|text)?/gi, '').replace(/```/g, '')
      .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  function callLLM(system, messages, opts) {
    opts = opts || {};
    var cfg = chatConfig();
    if (!cfg) return Promise.reject(new Error('请先在模型设置中配置文本模型'));
    var payload = {
      model: cfg.model,
      messages: [{ role: 'system', content: system }].concat(messages || []),
      temperature: opts.temperature == null ? 0.8 : opts.temperature,
      max_tokens: opts.maxTokens || 600
    };
    return NativeHttp.postJson(NativeHttp.chatEndpoint(cfg.apiUrl),
      { Authorization: 'Bearer ' + cfg.apiKey }, payload).then(function(data) {
      var msg = data && data.choices && data.choices[0] && data.choices[0].message;
      var text = cleanText(msg && msg.content);
      if (text) return text;
      // 推理模型偶尔把 token 都花在 reasoning 上，再给一次更大的预算
      payload.max_tokens = (opts.maxTokens || 600) + 600;
      return NativeHttp.postJson(NativeHttp.chatEndpoint(cfg.apiUrl),
        { Authorization: 'Bearer ' + cfg.apiKey }, payload).then(function(d2) {
        var m2 = d2 && d2.choices && d2.choices[0] && d2.choices[0].message;
        return cleanText(m2 && m2.content);
      });
    });
  }

  function generateMoment(friend) {
    var today = new Date();
    var ds = today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日';
    return callLLM(friend.momentPrompt + '\n今天是 ' + ds + '。',
      [{ role: 'user', content: '请写一条你自己的朋友圈动态，只输出正文。' }],
      { temperature: 0.95, maxTokens: 280 }).then(function(text) {
      text = text || friend.fallbackPost;
      return text.substring(0, 200);
    }, function() {
      return friend.fallbackPost;
    });
  }
  function generateComment(commenter, poster, content) {
    return callLLM(commenter.commentPrompt,
      [{ role: 'user', content: '好友「' + poster.name + '」发了朋友圈：\n' + content + '\n请写一句评论，只输出评论。' }],
      { temperature: 0.9, maxTokens: 120 }).then(function(text) { return text.substring(0, 60); });
  }
  function generateChatReply(friend, history) {
    var m = me();
    var msgs = [];
    for (var i = 0; i < history.length && i < 20; i++) {
      var h = history[i];
      if (!h || (h.role !== 'user' && h.role !== 'assistant')) continue;
      msgs.push({ role: h.role, content: String(h.content || '').substring(0, 1000) });
    }
    return callLLM(friend.chatPrompt + '\n用户名字：' + m.name,
      msgs, { temperature: 0.85, maxTokens: 600 });
  }
  function generateCommentReply(poster, post, userComment) {
    var m = me();
    return callLLM(poster.chatPrompt + '\n用户名字：' + m.name,
      [{ role: 'user', content: '你在朋友圈发了：\n' + post.content + '\n好友「' + m.name + '」评论：' + userComment + '\n请回复这条评论，一句话，只输出回复。' }],
      { temperature: 0.85, maxTokens: 160 }).then(function(text) { return text.substring(0, 80); });
  }

  // ─── 渲染 ───
  function renderAll() {
    renderFeed();
    renderFriends();
    renderMessages();
    renderAddFriendList();
    updateTabBadge();
  }

  function renderFeed() {
    var el = document.getElementById('feedList');
    if (!el) return;
    var friends = addedFriends();
    if (currentTab === 'feed') {
      state.unreadPosts = 0;
      saveCircle();
    }
    var html = '';
    if (generating) {
      html += '<div class="feed-loading"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span><span>好友们正在发动态…</span></div>';
    }
    if (!friends.length) {
      html += '<div class="empty-state"><img src="../mascot/xiaoman-logo.png" alt=""><div>朋友圈还空着<br>先添加几位 AI 好友吧</div><button class="soft-btn primary" onclick="openAddFriend()">添加好友</button></div>';
      el.innerHTML = html;
      return;
    }
    var posts = state.moments.slice().sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    if (!posts.length && !generating) {
      html += '<div class="empty-state">好友们还没发动态<br>点右上角刷新，看看他们在做什么<button class="soft-btn" onclick="manualRefresh()">刷新动态</button></div>';
      el.innerHTML = html;
      return;
    }
    for (var i = 0; i < posts.length; i++) html += postHtml(posts[i]);
    el.innerHTML = html;
  }

  function postHtml(post) {
    var p = preset(post.friendId);
    if (!p) return '';
    var likes = post.likes || [];
    var likeNames = likes.map(function(id) {
      return id === 'me' ? me().name : (preset(id) ? preset(id).name : '');
    }).filter(Boolean);
    var comments = post.comments || [];
    var commentHtml = '';
    for (var c = 0; c < comments.length; c++) {
      var cm = comments[c];
      if (cm.typing) {
        commentHtml += '<div class="post-comment typing">' + esc(p.name) + ' 正在回复…</div>';
        continue;
      }
      var name = cm.friendId === 'me' ? me().name : (preset(cm.friendId) ? preset(cm.friendId).name : '好友');
      commentHtml += '<div class="post-comment"><span class="comment-name">' + esc(name) + '：</span>' + nl2br(cm.text) + '</div>';
    }
    var iLiked = likes.indexOf('me') !== -1;
    return '<div class="post-card" id="post_' + esc(post.id) + '">' +
      '<div class="post-head">' + avatarHtml(p) +
      '<div class="post-head-main"><div class="post-name">' + esc(p.name) + '</div><div class="post-sub">' + timeAgo(post.createdAt) + ' · ' + esc(p.personality) + '</div></div>' +
      '<div class="post-action" onclick="openChatWith(\'' + esc(p.id) + '\')" title="聊天"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></div>' +
      '</div>' +
      '<div class="post-content">' + nl2br(post.content) + '</div>' +
      '<div class="post-actions">' +
      '<div class="post-action' + (iLiked ? ' active' : '') + '" onclick="toggleLike(\'' + esc(post.id) + '\')">' +
      '<svg viewBox="0 0 24 24" fill="' + (iLiked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
      '<span>' + (likes.length || '') + '</span></div>' +
      '<div class="post-action" onclick="focusComment(\'' + esc(post.id) + '\')">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
      '<span>' + (comments.filter(function(x) { return !x.typing; }).length || '') + '</span></div>' +
      '</div>' +
      (likeNames.length ? '<div class="post-likes">❤️ ' + esc(likeNames.join('、')) + '</div>' : '') +
      (comments.length ? '<div class="post-comments">' + commentHtml + '</div>' : '') +
      '<div class="comment-input-row"><input class="comment-input" id="comment_' + esc(post.id) + '" placeholder="评论..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();addComment(\'' + esc(post.id) + '\')}"><button class="comment-send" onclick="addComment(\'' + esc(post.id) + '\')">发送</button></div>' +
      '</div>';
  }

  function renderFriends() {
    var el = document.getElementById('friendsList');
    if (!el) return;
    var friends = addedFriends();
    if (!friends.length) {
      el.innerHTML = '<div class="empty-state"><img src="../mascot/xiaoman-logo.png" alt=""><div>还没有好友<br>添加几位 AI 角色，开始你的朋友圈</div><button class="soft-btn primary" onclick="openAddFriend()">添加好友</button></div>';
      return;
    }
    var html = '';
    friends.forEach(function(p) {
      var last = lastMessagePreview(p.id);
      html += '<div class="person-row" onclick="openChatWith(\'' + esc(p.id) + '\')">' + avatarHtml(p) +
        '<div class="person-main"><div class="person-name">' + esc(p.name) + '</div><div class="person-desc">' + esc(p.personality) + (last ? ' · ' + esc(last) : '') + '</div></div>' +
        '<svg class="row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>';
    });
    el.innerHTML = html;
  }

  function lastMessagePreview(friendId) {
    var chat = state.chats[friendId] || [];
    if (!chat.length) return '';
    var last = chat[chat.length - 1];
    return String(last.content || '').replace(/\s+/g, ' ').substring(0, 30);
  }

  function renderMessages() {
    var el = document.getElementById('messagesList');
    if (!el) return;
    var friends = addedFriends();
    if (!friends.length) {
      el.innerHTML = '<div class="empty-state">还没有聊天<br>先添加好友吧<button class="soft-btn primary" onclick="openAddFriend()">添加好友</button></div>';
      return;
    }
    var rows = friends.map(function(p) {
      var chat = state.chats[p.id] || [];
      var last = chat.length ? chat[chat.length - 1] : null;
      return { p: p, last: last, at: Number(state.lastMessageAt[p.id] || (last && last.at) || 0), unread: state.unread[p.id] || 0 };
    }).sort(function(a, b) { return b.at - a.at; });
    var html = '';
    rows.forEach(function(x) {
      var preview = x.last ? String(x.last.content || '').replace(/\s+/g, ' ').substring(0, 34) : '打个招呼吧';
      html += '<div class="person-row" onclick="openChatWith(\'' + esc(x.p.id) + '\')">' + avatarHtml(x.p) +
        '<div class="person-main"><div class="person-name">' + esc(x.p.name) + '</div><div class="person-desc">' + esc(preview) + '</div></div>' +
        '<div class="person-meta">' + (x.at ? timeAgo(x.at) : '') + (x.unread ? '<span class="unread-dot">' + x.unread + '</span>' : '') + '</div></div>';
    });
    el.innerHTML = html;
  }

  function renderAddFriendList() {
    var el = document.getElementById('addFriendList');
    if (!el) return;
    var html = '';
    PRESETS.forEach(function(p) {
      var added = isAdded(p.id);
      html += '<div class="preset-row">' + avatarHtml(p) +
        '<div class="preset-main"><div class="preset-name">' + esc(p.name) + '</div><div class="preset-desc">' + esc(p.personality) + ' · ' + esc(p.story.substring(0, 34)) + '…</div></div>' +
        '<button class="preset-add' + (added ? ' added' : '') + '" onclick="' + (added ? '' : 'addFriend(\'' + p.id + '\')') + '">' + (added ? '已添加' : '添加') + '</button></div>';
    });
    el.innerHTML = html;
  }

  function updateTabBadge() {
    var total = 0;
    for (var k in state.unread) if (state.unread.hasOwnProperty(k)) total += Number(state.unread[k] || 0);
    var el = document.getElementById('msgTabBadge');
    if (el) {
      el.textContent = total > 99 ? '99+' : String(total);
      el.style.display = total > 0 ? 'inline-flex' : 'none';
    }
  }

  // ─── 互动 ───
  window.toggleLike = function(postId) {
    var post = findPost(postId);
    if (!post) return;
    if (!post.likes) post.likes = [];
    var i = post.likes.indexOf('me');
    if (i === -1) post.likes.push('me'); else post.likes.splice(i, 1);
    saveCircle();
    renderFeed();
  };
  window.focusComment = function(postId) {
    var el = document.getElementById('comment_' + postId);
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
  };
  function findPost(postId) {
    for (var i = 0; i < state.moments.length; i++) if (state.moments[i].id === postId) return state.moments[i];
    return null;
  }
  window.addComment = function(postId) {
    var input = document.getElementById('comment_' + postId);
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    var post = findPost(postId);
    if (!post) return;
    if (!post.comments) post.comments = [];
    post.comments.push({ id: uid('c'), friendId: 'me', text: text, at: Date.now() });
    post.replyPending = true;
    post.comments.push({ id: uid('t'), friendId: post.friendId, text: '', at: Date.now(), typing: true });
    input.value = '';
    saveCircle();
    renderFeed();
    var poster = preset(post.friendId);
    if (!poster) return;
    generateCommentReply(poster, post, text).then(function(reply) {
      post.comments = (post.comments || []).filter(function(x) { return !x.typing; });
      if (reply) post.comments.push({ id: uid('c'), friendId: post.friendId, text: reply, at: Date.now() });
      post.replyPending = false;
      saveCircle();
      renderFeed();
    }, function() {
      post.comments = (post.comments || []).filter(function(x) { return !x.typing; });
      post.replyPending = false;
      saveCircle();
      renderFeed();
    });
  };

  // ─── 好友 / 聊天 ───
  window.openAddFriend = function() {
    document.getElementById('addOverlay').classList.add('open');
    document.getElementById('addSheet').classList.add('open');
    renderAddFriendList();
  };
  window.closeAddFriend = function() {
    document.getElementById('addOverlay').classList.remove('open');
    document.getElementById('addSheet').classList.remove('open');
  };
  window.addFriend = function(id) {
    if (isAdded(id)) return;
    var p = preset(id);
    if (!p) return;
    state.friends.push({ id: id, presetId: id, addedAt: Date.now() });
    state.chats[id] = [{ role: 'assistant', content: p.greeting, at: Date.now() }];
    state.unread[id] = 1;
    state.lastMessageAt[id] = Date.now();
    saveCircle();
    renderAll();
    showToast('已添加 ' + p.name);
    if (!state.moments.length) setTimeout(function() { generateMoments(true, 2); }, 500);
  };
  window.openChatWith = function(friendId) {
    var p = preset(friendId);
    if (!p || !isAdded(friendId)) return;
    activeChat = friendId;
    state.unread[friendId] = 0;
    saveCircle();
    document.getElementById('chatView').classList.add('open');
    renderChat();
    updateTabBadge();
    setTimeout(function() {
      var input = document.getElementById('chatInput');
      if (input) input.focus();
    }, 300);
  };
  window.closeChat = function() {
    activeChat = null;
    chatTyping = false;
    document.getElementById('chatView').classList.remove('open');
    renderMessages();
    renderFriends();
    updateTabBadge();
  };
  function renderChat() {
    if (!activeChat) return;
    var p = preset(activeChat);
    if (!p) return;
    document.getElementById('chatHead').innerHTML = avatarHtml(p, 'avatar small') +
      '<div><div class="chat-title">' + esc(p.name) + '</div><div class="chat-sub">' + esc(p.personality) + '</div></div>';
    var chat = state.chats[activeChat] || [];
    var html = '';
    var lastAt = 0;
    for (var i = 0; i < chat.length; i++) {
      var m = chat[i];
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      if (!lastAt || m.at - lastAt > 5 * 60 * 1000) html += '<div class="chat-time">' + (m.at ? timeAgo(m.at) : '') + '</div>';
      lastAt = m.at || lastAt;
      if (m.role === 'user') {
        html += '<div class="chat-msg user"><div class="chat-bubble">' + nl2br(m.content) + '</div>' + meAvatarHtml('avatar small') + '</div>';
      } else {
        html += '<div class="chat-msg assistant">' + avatarHtml(p, 'avatar small') + '<div class="chat-bubble">' + nl2br(m.content) + '</div></div>';
      }
    }
    if (chatTyping) {
      html += '<div class="chat-msg assistant">' + avatarHtml(p, 'avatar small') + '<div class="chat-typing"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></div></div>';
    }
    var body = document.getElementById('chatBody');
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
  }
  window.sendChat = function() {
    if (!activeChat || chatTyping) return;
    var input = document.getElementById('chatInput');
    var text = input.value.trim();
    if (!text) return;
    var p = preset(activeChat);
    if (!p) return;
    var cfg = chatConfig();
    if (!cfg) { showToast('请先在模型设置中配置文本模型'); return; }
    var fid = activeChat;
    if (!state.chats[fid]) state.chats[fid] = [];
    state.chats[fid].push({ role: 'user', content: text, at: Date.now() });
    state.lastMessageAt[fid] = Date.now();
    state.unread[fid] = 0;
    input.value = '';
    input.style.height = '';
    saveCircle();
    chatTyping = true;
    renderChat();
    var history = state.chats[fid].slice(-20);
    generateChatReply(p, history).then(function(reply) {
      if (activeChat === fid) chatTyping = false;
      if (reply) state.chats[fid].push({ role: 'assistant', content: reply, at: Date.now() });
      state.lastMessageAt[fid] = Date.now();
      if (activeChat !== fid) state.unread[fid] = (state.unread[fid] || 0) + 1;
      saveCircle();
      if (activeChat === fid) renderChat();
      renderMessages();
      updateTabBadge();
    }, function(e) {
      if (activeChat === fid) chatTyping = false;
      if (activeChat === fid) renderChat();
      showToast(e && e.message ? e.message : '回复失败');
    });
  };
  window.switchTab = function(tab) {
    currentTab = tab;
    ['feed', 'friends', 'messages'].forEach(function(t) {
      var view = document.getElementById(t + 'View');
      var tabEl = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
      if (view) view.classList.toggle('active', t === tab);
      if (tabEl) tabEl.classList.toggle('active', t === tab);
    });
    if (tab === 'feed') renderFeed();
    if (tab === 'friends') renderFriends();
    if (tab === 'messages') renderMessages();
  };

  // ─── 动态生成 ───
  function shouldGenerate() {
    if (!addedFriends().length) return false;
    if (!state.moments.length) return true;
    return Date.now() - (state.lastGeneratedAt || 0) >= COOLDOWN;
  }
  window.manualRefresh = function() {
    if (generating) return;
    if (!chatConfig()) { showToast('请先在模型设置中配置文本模型'); return; }
    var btn = document.getElementById('refreshBtn');
    if (btn) btn.classList.add('spinning');
    generateMoments(true, state.moments.length ? 2 : 3).then(function() {
      if (btn) btn.classList.remove('spinning');
    }, function() {
      if (btn) btn.classList.remove('spinning');
    });
  };
  function generateMoments(force, count) {
    if (generating) return Promise.resolve();
    var friends = addedFriends();
    if (!friends.length) { showToast('先添加几位好友'); return Promise.resolve(); }
    if (!chatConfig()) { showToast('请先在模型设置中配置文本模型'); return Promise.resolve(); }
    if (!force && !shouldGenerate()) return Promise.resolve();
    generating = true;
    renderFeed();
    var picks = friends.slice().sort(function() { return Math.random() - 0.5; });
    var n = Math.min(count || 2, picks.length);
    picks = picks.slice(0, n);
    var newPosts = [];
    var chain = Promise.resolve();
    picks.forEach(function(p) {
      chain = chain.then(function() {
        return generateMoment(p).then(function(content) {
          if (!content) return;
          var post = {
            id: uid('post'), friendId: p.id, content: content,
            createdAt: Date.now(), likes: [], comments: []
          };
          state.moments.push(post);
          newPosts.push(post);
        }, function() {});
      });
    });
    return chain.then(function() {
      addAiInteractions(newPosts);
      state.lastGeneratedAt = Date.now();
      state.unreadPosts = (state.unreadPosts || 0) + newPosts.length;
      generating = false;
      saveCircle();
      renderAll();
      if (newPosts.length) showToast('朋友圈更新了 ' + newPosts.length + ' 条');
      else showToast('暂时没有新动态，稍后再试');
      return newPosts;
    }, function() {
      generating = false;
      renderFeed();
      showToast('动态生成失败，稍后再试');
    });
  }
  function addAiInteractions(posts) {
    if (!posts || !posts.length) return;
    var friends = addedFriends();
    posts.forEach(function(post) {
      var others = friends.filter(function(f) { return f.id !== post.friendId; });
      if (!others.length) return;
      var shuffled = others.slice().sort(function() { return Math.random() - 0.5; });
      var take = Math.min(shuffled.length, Math.random() < 0.55 ? 2 : 1);
      for (var i = 0; i < take; i++) {
        if (post.likes.indexOf(shuffled[i].id) === -1) post.likes.push(shuffled[i].id);
      }
    });
    var post = posts[Math.floor(Math.random() * posts.length)];
    var others = friends.filter(function(f) { return f.id !== post.friendId; });
    if (!others.length) return;
    var commenter = others[Math.floor(Math.random() * others.length)];
    var poster = preset(post.friendId);
    if (!poster) return;
    generateComment(commenter, poster, post.content).then(function(text) {
      if (!text) return;
      post.comments.push({ id: uid('c'), friendId: commenter.id, text: text, at: Date.now() });
      saveCircle();
      renderFeed();
    }, function() {});
  }

  // ─── 旧数据清理 / 返回 / 键盘 ───
  function clearOldMailOnce() {
    if (localStorage.getItem(RESET_KEY)) return;
    try { if (typeof AndroidMail !== 'undefined' && AndroidMail.clearAll) AndroidMail.clearAll(); } catch (e) {}
    try {
      var s = appSettings();
      if (s.proactiveMails) { delete s.proactiveMails; saveAppSettings(s); }
    } catch (e) {}
    try { localStorage.removeItem('nian_mails_cache'); } catch (e) {}
    localStorage.setItem(RESET_KEY, '1');
  }
  window.goBack = function() {
    if (activeChat) { closeChat(); return; }
    var sheet = document.getElementById('addSheet');
    if (sheet && sheet.classList.contains('open')) { closeAddFriend(); return; }
    window.location.href = '../app.html';
  };
  window.__applySafeInsets = function(top, bottom, keyboard) {
    var dpr = window.devicePixelRatio || 1;
    var r = document.documentElement;
    var kb = Math.round((keyboard || 0) / dpr);
    r.style.setProperty('--safe-area-top', Math.round((top || 0) / dpr) + 'px');
    r.style.setProperty('--safe-area-bottom', Math.round((keyboard ? 0 : (bottom || 0)) / dpr) + 'px');
    r.style.setProperty('--keyboard-height', kb + 'px');
  };
  document.addEventListener('focusin', function(e) {
    var t = e.target;
    if (!t || t.id !== 'chatInput') return;
    setTimeout(function() { try { t.scrollIntoView({ block: 'nearest' }); } catch (e) {} }, 300);
  });

  // ─── init ───
  function init() {
    state = loadCircle();
    clearOldMailOnce();
    renderAll();
    if (shouldGenerate()) {
      setTimeout(function() { generateMoments(false, state.moments.length ? 2 : 3); }, 400);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
