(function() {
    var hasBridge = (typeof AndroidStorage !== 'undefined' && AndroidStorage !== null);
    window.DataService = {
        notes: {
            save: function(data) { hasBridge ? AndroidStorage.saveNotes(JSON.stringify(data)) : localStorage.setItem('nian_notes', JSON.stringify(data)); },
            load: function() { try { var raw = hasBridge ? AndroidStorage.loadNotes() : localStorage.getItem('nian_notes'); return raw ? JSON.parse(raw) : []; } catch(e) { return []; } }
        },
        settings: {
            save: function(data) { hasBridge ? AndroidSettings.saveSettings(JSON.stringify(data)) : localStorage.setItem('nian_settings', JSON.stringify(data)); },
            load: function() { try { var raw = hasBridge ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings'); return raw ? JSON.parse(raw) : null; } catch(e) { return null; } }
        }
    };
})();

if (typeof AndroidStorage === 'undefined') {
    window.AndroidStorage = {
        saveNotes: function(json) { localStorage.setItem('nian_notes', json); },
        loadNotes: function() { return localStorage.getItem('nian_notes') || ''; }
    };
    window.AndroidSettings = {
        saveSettings: function(json) { localStorage.setItem('nian_settings', json); },
        loadSettings: function() { return localStorage.getItem('nian_settings') || ''; }
    };
}

window.__applySafeInsets = function(top, bottom, keyboard) {
    var dpr = window.devicePixelRatio || 1;
    var r = document.documentElement;
    var kb = Math.round((keyboard || 0) / dpr);
    r.style.setProperty('--safe-area-top', Math.round(top / dpr) + 'px');
    // 键盘弹出时底部安全区已被键盘覆盖，避免重复留白
    r.style.setProperty('--safe-area-bottom', Math.round((keyboard ? 0 : (bottom || 0)) / dpr) + 'px');
    r.style.setProperty('--keyboard-height', kb + 'px');
};

// 键盘弹出后确保输入框可见；页面底部已经通过 --keyboard-height 抬到键盘上方
document.addEventListener('focusin', function(e) {
    var t = e.target;
    if (!t || (t.id !== 'threadInput' && t.id !== 'replyComposeInput')) return;
    setTimeout(function() {
        try { t.scrollIntoView({ block: 'nearest' }); } catch (err) {}
    }, 300);
});

var hasMailBridge = (typeof AndroidMail !== 'undefined' && AndroidMail !== null);

var penpals = [
    { id: "nian", name: "小满", emoji: "💭", avatarImg: "../mascot/xiaoman-avatar.png", color: "#e85d04", personality: "你的 AI 生活伴侣", story: "小满是住在你手机里的生活伴侣，陪你记录日常、梳理情绪。", interests: ["日记", "洞察", "陪伴"], signature: "小得盈满，来日方长", systemPrompt: "" },
    { id: "xiaonuan", name: "小暖", emoji: "暖", color: "#FF8FA3", personality: "温柔善良，善解人意", story: "小暖是住在隔壁街区的邻家姐姐，说话轻轻柔柔，总在回信末尾画一朵小花。", interests: ["热茶", "治愈系电影", "手作小物"], signature: "愿你今天也被温柔以待", systemPrompt: "你是小暖，一个温柔善良的笔友。你说话温暖细腻，总是先共情再回应。回复控制在200字以内，像一位知心朋友。" },
    { id: "aran", name: "阿燃", emoji: "燃", color: "#FF6B35", personality: "热血奋进，永不服输", story: "阿燃是大学田径队的老队长，退役后开了家创业公司，信奉「人生就是要拼」。", interests: ["晨跑", "篮球", "创业"], signature: "冲！你可以的！", systemPrompt: "你是阿燃，一个热血奋进的笔友。你说话充满激情和能量，喜欢鼓励他人。回复控制在200字以内，像一位并肩作战的伙伴。" },
    { id: "shubai", name: "书白", emoji: "书", color: "#4A6FA5", personality: "博学睿智，冷静通透", story: "书白藏书万卷、深居简出，总能用一句引文帮你换个角度看问题。", interests: ["古籍", "哲学", "围棋"], signature: "灯下读书，窗外见月", systemPrompt: "你是书白，一个博学睿智的笔友。你说话理性深刻，善于引用知识和典故。回复控制在200字以内，像一位智慧的导师。" },
    { id: "momo", name: "墨墨", emoji: "墨", color: "#9B59B6", personality: "浪漫文艺，天马行空", story: "墨墨住在老巷子里，白天画插画、晚上写诗，相信流水账里也藏着诗。", interests: ["插画", "散文", "老唱片"], signature: "把日子染上颜色", systemPrompt: "你是墨墨，一个浪漫文艺的笔友。你说话诗意盎然，充满想象力和艺术感。回复控制在200字以内，像一位流浪的诗人。" }
];
// 笔友头像：带 avatarImg 的用形象图（小满），其余沿用 emoji + 主题色底
function penpalAvatarHtml(cls, pp, style) {
    if (pp && pp.avatarImg) {
        return '<div class="' + cls + '" style="background-image:url(' + pp.avatarImg + ');background-size:cover;background-position:center"></div>';
    }
    return '<div class="' + cls + '" style="' + style + '">' + (pp ? pp.emoji : '信') + '</div>';
}
// 后台配置可覆盖笔友回信提示词（NIAN_CONFIG.prompts.penpals）
try {
    if (typeof NIAN_CONFIG !== 'undefined' && NIAN_CONFIG.prompts && NIAN_CONFIG.prompts.penpals) {
        var ppCfg = NIAN_CONFIG.prompts.penpals;
        for (var ppi = 0; ppi < penpals.length; ppi++) {
            var cfgPrompt = ppCfg[penpals[ppi].id];
            if (typeof cfgPrompt === 'string' && cfgPrompt.trim()) {
                penpals[ppi].systemPrompt = cfgPrompt;
            }
        }
    }
} catch(e) {}
var mails = [];
var currentFilter = null;
var currentView = 'penpals';
var activeThreadPenpalId = null;

function init() {
    loadMails();
    renderPenpalWall();
}

function loadPenpals() {
    renderPenpalFilter();
}

function switchMailView(view) {
    currentView = view;
    document.getElementById('tabPenpals').classList.toggle('active', view === 'penpals');
    document.getElementById('tabWall').classList.toggle('active', view === 'wall');
    document.getElementById('penpalWall').style.display = view === 'penpals' ? '' : 'none';
    document.getElementById('wallView').style.display = view === 'wall' ? '' : 'none';
    if (view === 'wall') {
        renderPenpalFilter();
        renderEnvelopeWall();
    }
}

// ── 笔友列表首页 ──
function renderPenpalWall() {
    var container = document.getElementById('penpalWall');
    // 每个笔友的未读数 + 最近一条回复预览
    var stats = {};
    for (var i = 0; i < mails.length; i++) {
        var m = mails[i];
        if (!m.penpalId) continue;
        if (!stats[m.penpalId]) stats[m.penpalId] = { unread: 0, lastReply: '', lastAt: 0 };
        if (m.status === 'replied' && !m.read) stats[m.penpalId].unread++;
        if (m.reply && parseInt(m.replyAt || m.sentAt || 0, 10) > stats[m.penpalId].lastAt) {
            stats[m.penpalId].lastReply = m.reply;
            stats[m.penpalId].lastAt = parseInt(m.replyAt || m.sentAt || 0, 10);
        }
    }

    var html = '';
    for (var p = 0; p < penpals.length; p++) {
        var pp = penpals[p];
        var st = stats[pp.id];
        var unread = st ? st.unread : 0;
        var preview = st && st.lastReply ? st.lastReply : (pp.story || pp.personality);
        var previewText = preview.substring(0, 40);
        html += '<div class="penpal-card' + (unread > 0 ? ' unread' : '') + '" onclick="openThread(\'' + pp.id + '\')">' +
            penpalAvatarHtml('penpal-card-avatar', pp, 'background:' + pp.color + '18;color:' + pp.color) +
            '<div class="penpal-card-info">' +
            '<div class="penpal-card-row">' +
            '<span class="penpal-card-name">' + pp.name + '</span>' +
            (unread > 0 ? '<span class="penpal-card-badge">' + unread + '</span>' : '') +
            '</div>' +
            '<div class="penpal-card-personality">' + escapeHtml(pp.personality) + '</div>' +
            '<div class="penpal-card-preview">' + escapeHtml(previewText) + '</div>' +
            '</div>' +
            '<svg class="penpal-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
            '</div>';
    }
    container.innerHTML = html || '<div class="penpal-empty">还没有笔友来信</div>';
}

// ── 对话流视图 ──
function openThread(penpalId) {
    activeThreadPenpalId = penpalId;
    var pp = getPenpal(penpalId);
    if (!pp) return;
    document.getElementById('threadTitle').textContent = pp.name + ' 的信箱';
    document.getElementById('threadView').classList.add('open');
    document.getElementById('threadOverlay').classList.add('open');
    document.getElementById('threadInput').value = '';
    renderThread(penpalId);
}

function closeThread() {
    activeThreadPenpalId = null;
    document.getElementById('threadView').classList.remove('open');
    document.getElementById('threadOverlay').classList.remove('open');
    loadMails();
    renderPenpalWall();
}

function formatThreadDate(ts) {
    var d = new Date(parseInt(ts, 10));
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
        d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function renderThread(penpalId) {
    var pp = getPenpal(penpalId);
    var body = document.getElementById('threadBody');
    var threadMails = mails.filter(function(m) { return m.penpalId === penpalId; })
        .sort(function(a, b) { return parseInt(a.sentAt, 10) - parseInt(b.sentAt, 10); });

    // 笔友档案卡
    var html = '<div class="thread-profile">' +
        '<div class="thread-profile-top">' +
        penpalAvatarHtml('thread-profile-avatar', pp, 'background:' + pp.color + '18;color:' + pp.color) +
        '<div>' +
        '<div class="thread-profile-name" style="color:' + pp.color + '">' + pp.name + '</div>' +
        '<div class="thread-profile-personality">' + escapeHtml(pp.personality) + '</div>' +
        '</div>' +
        '</div>';
    if (pp.story) html += '<div class="thread-profile-story">' + escapeHtml(pp.story) + '</div>';
    if (pp.interests && pp.interests.length) {
        html += '<div class="thread-profile-interests">' + pp.interests.map(function(t) {
            return '<span class="thread-profile-tag">' + escapeHtml(t) + '</span>';
        }).join('') + '</div>';
    }
    if (pp.signature) html += '<div class="thread-profile-signature">「' + escapeHtml(pp.signature) + '」</div>';
    html += '</div>';

    if (threadMails.length === 0) {
        html += '<div class="thread-msg-sending">你还没有给 ' + pp.name + ' 写过信。<br>在下方写一封信，Ta 会用自己独特的方式回你。</div>';
    }

    // 按天分组的对话消息
    var lastDayKey = '';
    for (var i = 0; i < threadMails.length; i++) {
        var m = threadMails[i];
        var d = new Date(parseInt(m.sentAt, 10));
        var dayKey = isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
        if (dayKey && dayKey !== lastDayKey) {
            html += '<div class="thread-day-divider">' + (d.getMonth() + 1) + '月' + d.getDate() + '日</div>';
            lastDayKey = dayKey;
        }
        var userText = m.noteContent;
        if (userText.indexOf('--isHTML ') === 0) userText = userText.substring(9);
        userText = userText.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();
        html += '<div class="thread-msg-group">' +
            '<div class="thread-msg-user-label">我 · ' + formatThreadDate(m.sentAt) + '</div>' +
            '<div class="thread-msg-user">' + escapeHtml(userText) + '</div>';
        if (m.status === 'sending') {
            html += '<div class="thread-msg-sending">信件寄出，等待回信…</div>';
        } else if (m.reply) {
            html += '<div class="thread-msg-reply" style="border-left-color:' + pp.color + '">' +
                escapeHtml(m.reply) +
                '<div class="thread-msg-reply-footer">' + pp.name + ' · ' + formatThreadDate(m.replyAt || m.sentAt) + '</div>' +
                '</div>';
        } else if (m.status === 'failed') {
            html += '<div class="thread-msg-sending">' + escapeHtml(m.reply || '回信失败') + '</div>';
        }
        html += '</div>';
        // 标记已读
        if (m.status === 'replied' && !m.read) {
            m.read = true;
            if (hasMailBridge && !m.isProactive) AndroidMail.markRead(m.id);
        }
    }
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
}

// 从对话流写信
function sendThreadLetter() {
    if (!activeThreadPenpalId) return;
    var input = document.getElementById('threadInput').value.trim();
    if (!input) {
        showToast('请先写下想说的话');
        return;
    }
    var pp = getPenpal(activeThreadPenpalId);
    if (!pp) return;
    if (hasMailBridge) {
        var memoPrompt = (typeof window.buildPenpalContext === 'function')
            ? window.buildPenpalContext(activeThreadPenpalId, pp.systemPrompt)
            : pp.systemPrompt;
        AndroidMail.sendMail(input, activeThreadPenpalId, pp.name, memoPrompt);
    } else {
        // 浏览器 fallback
        var mailId = 'mail_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        var mail = {
            id: mailId, penpalId: activeThreadPenpalId, penpalName: pp.name,
            noteContent: input, reply: '', sentAt: Date.now().toString(),
            status: 'sending', read: false
        };
        var cache = JSON.parse(localStorage.getItem('nian_mails_cache') || '[]');
        cache.unshift(mail);
        localStorage.setItem('nian_mails_cache', JSON.stringify(cache));
        var config;
        try { config = JSON.parse(localStorage.getItem('nian_settings') || '{}'); } catch(e) { config = {}; }
        if (config.apiUrl && config.apiKey) {
            var url = NativeHttp.chatEndpoint(config.apiUrl);
            var browserPrompt = (typeof window.buildPenpalContext === 'function')
                ? window.buildPenpalContext(activeThreadPenpalId, pp.systemPrompt)
                : pp.systemPrompt;
            NativeHttp.postJson(url, { Authorization: 'Bearer ' + config.apiKey }, {
                model: config.model || 'gpt-4o',
                messages: [
                    { role: 'system', content: browserPrompt },
                    { role: 'user', content: '我写了一篇笔记，请以你的风格给我回信。笔记内容：\n\n' + input.substring(0, 1000) }
                ],
                max_tokens: 400, temperature: 0.8
            }).then(function(data) {
                var reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                if (reply) {
                    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
                    mail.reply = reply; mail.status = 'replied'; mail.replyAt = Date.now().toString();
                    saveBrowserMail(mail);
                }
            }).catch(function() {
                mail.status = 'failed'; mail.reply = '(回信失败，请检查网络和API配置)';
                saveBrowserMail(mail);
            });
        } else {
            mail.status = 'failed'; mail.reply = '(请先配置 API)';
            saveBrowserMail(mail);
        }
    }
    document.getElementById('threadInput').value = '';
    showToast('信已寄给 ' + pp.name + '，等待回信');
    setTimeout(function() {
        loadMails();
        renderThread(activeThreadPenpalId);
    }, 400);
}

function saveBrowserMail(mail) {
    try {
        var cache = JSON.parse(localStorage.getItem('nian_mails_cache') || '[]');
        var found = false;
        for (var i = 0; i < cache.length; i++) {
            if (cache[i].id === mail.id) { cache[i] = mail; found = true; break; }
        }
        if (!found) cache.unshift(mail);
        localStorage.setItem('nian_mails_cache', JSON.stringify(cache));
    } catch(e) {}
}

function loadMails() {
    if (hasMailBridge) {
        try {
            var raw = AndroidMail.loadMails();
            mails = raw ? JSON.parse(raw) : [];
        } catch(e) { mails = []; }
    } else {
        try {
            var cache = localStorage.getItem('nian_mails_cache');
            mails = cache ? JSON.parse(cache) : [];
        } catch(e) { mails = []; }
    }
    // 合并小满主动消息
    try {
        var s = hasBridge ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
        var settings = s ? JSON.parse(s) : {};
        var proactive = settings.proactiveMails || [];
        for (var i = 0; i < proactive.length; i++) {
            // 避免重复
            var dup = false;
            for (var j = 0; j < mails.length; j++) {
                if (mails[j].id === proactive[i].id) { dup = true; break; }
            }
            if (!dup) mails.push(proactive[i]);
        }
    } catch(e) {}
    mails.sort(function(a, b) { return parseInt(b.sentAt) - parseInt(a.sentAt); });

    renderEnvelopeWall();
}

function getPenpal(id) {
    for (var i = 0; i < penpals.length; i++) {
        if (penpals[i].id === id) return penpals[i];
    }
    return null;
}

function renderPenpalFilter() {
    var container = document.getElementById('penpalFilter');
    var html = '<div class="penpal-filter-item" onclick="setFilter(null)" id="filterAll">' +
        '<div class="penpal-filter-avatar" style="color:#e85d04;background:rgba(232,93,4,0.08)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="18" height="12" rx="1.5"/><polyline points="3 6 12 13 21 6"/></svg></div>' +
        '<div class="penpal-filter-name">全部</div></div>';

    penpals.forEach(function(p) {
        html += '<div class="penpal-filter-item" onclick="setFilter(\'' + p.id + '\')" id="filter_' + p.id + '">' +
            penpalAvatarHtml('penpal-filter-avatar', p, 'color:' + p.color + ';background:' + p.color + '20') +
            '<div class="penpal-filter-name">' + p.name + '</div></div>';
    });

    container.innerHTML = html;
    updateFilterActive();
}

function setFilter(penpalId) {
    currentFilter = penpalId;
    updateFilterActive();
    renderEnvelopeWall();
}

function updateFilterActive() {
    document.querySelectorAll('.penpal-filter-item').forEach(function(el) {
        el.classList.remove('inactive');
    });
    if (!currentFilter) {
        document.getElementById('filterAll').classList.remove('inactive');
    } else {
        document.getElementById('filterAll').classList.add('inactive');
        document.getElementById('filter_' + currentFilter).classList.remove('inactive');
    }
}

function renderEnvelopeWall() {
    var container = document.getElementById('envelopeWall');

    var filtered = currentFilter
        ? mails.filter(function(m) { return m.penpalId === currentFilter; })
        : mails;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="envelope-empty"><img class="empty-mascot" src="../mascot/xiaoman-logo.png" alt="">信箱还是空的<br>在笔记页选择一篇笔记<br>发给笔友吧</div>';
        return;
    }

    // Separate unread vs read for V6 featured layout
    var unread = [];
    var read = [];
    filtered.forEach(function(mail) {
        if (mail.status === 'replied' && !mail.read) unread.push(mail);
        else read.push(mail);
    });

    var html = '';

    // First unread → V6 featured card
    if (unread.length > 0) {
        var first = unread[0];
        var pp = getPenpal(first.penpalId);
        var date = new Date(parseInt(first.sentAt));
        var dateStr = (date.getMonth() + 1) + '月' + date.getDate() + '日';
        var preview = first.reply ? first.reply : first.noteContent;
        html += '<div class="mail-featured" onclick="openDetail(\'' + first.id + '\')">' +
            '<div class="mail-featured-from">' + (pp ? pp.name : '笔友') + '</div>' +
            '<div class="mail-featured-subject">' + escapeHtml(first.noteContent).substring(0, 40) + '</div>' +
            '<div class="mail-featured-preview">' + escapeHtml(preview).substring(0, 200) + '</div>' +
            '<div class="mail-featured-time">' + dateStr + '</div>' +
            '</div>';
    }

    // Remaining unread (after first) + read → regular items
    var rest = unread.slice(1).concat(read);
    rest.forEach(function(mail) {
        var pp = getPenpal(mail.penpalId);
        var date = new Date(parseInt(mail.sentAt));
        var dateStr = (date.getMonth() + 1) + '月' + date.getDate() + '日';
        var preview = mail.reply ? mail.reply.substring(0, 60) : mail.noteContent.substring(0, 60);
        var isUnread = mail.status === 'replied' && !mail.read;
        var stampColor = pp ? pp.color : '#999';
        html += '<div class="mail-item' + (isUnread ? ' unread' : '') + '" onclick="openDetail(\'' + mail.id + '\')">' +
            '<div class="mail-stamp" style="background:' + stampColor + '15;color:' + stampColor + '">' + (pp ? pp.emoji : '信') + '</div>' +
            '<div class="mail-info">' +
            '<div class="mail-row-1">' +
            '<span class="mail-from">' + (pp ? pp.name : '笔友') + '</span>' +
            '<span class="mail-time">' + dateStr + '</span>' +
            '</div>' +
            '<div class="mail-subject">' + escapeHtml(preview) + '</div>' +
            '</div>' +
            (isUnread ? '<div class="mail-status-dot"></div>' : '') +
            '</div>';
    });

    container.innerHTML = html;
    }

function colorEnvelopeBorders() {
    document.querySelectorAll('.envelope-card').forEach(function(card, i) {
        var body = card.querySelector('.envelope-body');
        if (body) {
            var style = body.getAttribute('style') || '';
            var match = style.match(/background:([^;]+)/);
            if (match) {
                var pseudo = document.createElement('style');
                pseudo.textContent = '.envelope-body:nth-child(' + (i + 1) + ')::before { background: ' + match[1] + ' !important; }';
            }
        }
    });

    var styles = '';
    document.querySelectorAll('.envelope-card').forEach(function(card) {
        var flap = card.querySelector('.envelope-flap');
        if (flap) {
            var color = flap.style.borderTopColor;
            var body = card.querySelector('.envelope-body');
            if (body && color) {
                body.style.setProperty('--penpal-color', color);
                body.style.borderLeft = '4px solid ' + color;
            }
        }
    });
}

function openDetail(mailId) {
    var mail = null;
    for (var i = 0; i < mails.length; i++) {
        if (mails[i].id === mailId) { mail = mails[i]; break; }
    }
    if (!mail) return;

    if (mail.status === 'replied' && !mail.read) {
        if (mail.isProactive) {
            // 标记小满主动消息为已读
            mail.read = true;
            try {
                var s = hasBridge ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
                var settings = s ? JSON.parse(s) : {};
                var msgs = settings.proactiveMails || [];
                for (var mi = 0; mi < msgs.length; mi++) {
                    if (msgs[mi].id === mailId) { msgs[mi].read = true; break; }
                }
                settings.proactiveMails = msgs;
                if (hasBridge) AndroidSettings.saveSettings(JSON.stringify(settings));
                else localStorage.setItem('nian_settings', JSON.stringify(settings));
            } catch(e) {}
        } else if (hasMailBridge) {
            AndroidMail.markRead(mailId);
            mail.read = true;
        }
        renderEnvelopeWall();
    }

    var pp = getPenpal(mail.penpalId);
    var color = pp ? pp.color : '#999';
    var date = new Date(parseInt(mail.sentAt));
    var dateStr = (date.getMonth() + 1) + '月' + date.getDate() + '日 ' +
        date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');

    document.getElementById('detailTitle').textContent = (pp ? pp.name : '笔友') + ' 的信';
    document.getElementById('detailPanel').classList.add('open');
    document.getElementById('detailOverlay').classList.add('open');

    var replyContent = '';
    if (mail.status === 'sending') {
        replyContent = '<div style="text-align:center;padding:40px 0;color:var(--text-muted);">信件已寄出，等待回信中...</div>';
    } else if (mail.reply) {
        replyContent =
            '<div class="letter-reply" style="border-left-color:' + color + '">' +
            '<div class="letter-reply-from">' +
            penpalAvatarHtml('letter-reply-avatar', pp, 'background:' + color + '20') +
            '<span class="letter-reply-name" style="color:' + color + '">' + (pp ? pp.name : '笔友') + '</span>' +
            '</div>' +
            '<div class="letter-reply-content">' + escapeHtml(mail.reply) + '</div>' +
            '<div class="letter-reply-footer">' + getReplyDate(mail) + '</div>' +
            '<div class="letter-reply-actions">' +
            '<button class="letter-reply-btn secondary" onclick="showReplyInput(' + "'" + mailId + "'" + ')">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>回复' +
            '</button>' +
            '<button class="letter-reply-btn secondary" onclick="deleteMail(' + "'" + mailId + "'" + ')">删除</button>' +
            '</div>' +
            '</div>';
    }

    document.getElementById('detailBody').innerHTML =
        '<div class="letter-original-label">你写给 ' + (pp ? pp.name : '笔友') + ' 的信 · ' + dateStr + '</div>' +
        '<div class="letter-original">' + escapeHtml(mail.noteContent) + '</div>' +
        replyContent;
}

function getReplyDate(mail) {
    if (!mail.replyAt) return '';
    var d = new Date(parseInt(mail.replyAt));
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
        d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function closeDetail() {
    cancelReply();
    document.getElementById('detailPanel').classList.remove('open');
    document.getElementById('detailOverlay').classList.remove('open');
    loadMails();
    if (activeThreadPenpalId) renderThread(activeThreadPenpalId);
}

function markAllRead() {
    if (hasMailBridge) { AndroidMail.markAllRead(); }
    mails.forEach(function(m) { m.read = true; });
    renderEnvelopeWall();
}

// 删除单封来信：普通信件走原生桥，主动消息走 settings.proactiveMails
function removeMailFromStorage(mail) {
    if (!mail) return false;
    if (mail.isProactive) {
        try {
            var s = hasBridge ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
            var settings = s ? JSON.parse(s) : {};
            settings.proactiveMails = (settings.proactiveMails || []).filter(function(m) { return m.id !== mail.id; });
            if (hasBridge) AndroidSettings.saveSettings(JSON.stringify(settings));
            else localStorage.setItem('nian_settings', JSON.stringify(settings));
            return true;
        } catch(e) { return false; }
    }
    if (hasMailBridge) {
        if (typeof AndroidMail.deleteMail !== 'function') {
            showToast('请更新 App 后再删除来信');
            return false;
        }
        AndroidMail.deleteMail(mail.id);
        return true;
    }
    try {
        var cache = JSON.parse(localStorage.getItem('nian_mails_cache') || '[]').filter(function(m) { return m.id !== mail.id; });
        localStorage.setItem('nian_mails_cache', JSON.stringify(cache));
        return true;
    } catch(e) { return false; }
}

function deleteMail(mailId) {
    var mail = null;
    for (var i = 0; i < mails.length; i++) {
        if (mails[i].id === mailId) { mail = mails[i]; break; }
    }
    if (!mail) return;
    if (!confirm('删除这封来信？')) return;
    if (!removeMailFromStorage(mail)) return;
    mails = mails.filter(function(m) { return m.id !== mailId; });
    closeDetail();
    renderEnvelopeWall();
    renderPenpalWall();
    showToast('来信已删除');
}

function clearReadMails() {
    if (hasMailBridge && typeof AndroidMail.deleteMail !== 'function') {
        showToast('请更新 App 后再清空已读');
        return;
    }
    var targets = mails.filter(function(m) { return m.status === 'replied' && m.read; });
    if (!targets.length) { showToast('没有已读来信'); return; }
    if (!confirm('清空 ' + targets.length + ' 封已读来信？')) return;
    var removed = 0;
    targets.forEach(function(m) { if (removeMailFromStorage(m)) removed++; });
    var ids = {};
    targets.forEach(function(m) { ids[m.id] = 1; });
    mails = mails.filter(function(m) { return !ids[m.id]; });
    renderEnvelopeWall();
    renderPenpalWall();
    showToast('已清空 ' + removed + ' 封已读来信');
}

var pendingNoteContent = '';
var pendingReplyMailId = null;

function showReplyInput(mailId) {
    pendingReplyMailId = mailId;
    var compose = document.getElementById('replyCompose');
    compose.classList.add('open');
    document.getElementById('replyComposeInput').value = '';
    setTimeout(function() {
        document.getElementById('replyComposeInput').focus();
    }, 300);
}

function cancelReply() {
    pendingReplyMailId = null;
    document.getElementById('replyCompose').classList.remove('open');
    document.getElementById('replyComposeInput').value = '';
}

function sendReply() {
    if (!pendingReplyMailId) return;
    var content = document.getElementById('replyComposeInput').value.trim();
    if (!content) {
        showToast('请先写下回信内容');
        return;
    }
    var mail = null;
    for (var i = 0; i < mails.length; i++) {
        if (mails[i].id === pendingReplyMailId) { mail = mails[i]; break; }
    }
    if (!mail) return;
    if (hasMailBridge) {
        var pp = getPenpal(mail.penpalId);
        if (pp) {
            var memoPrompt = (typeof window.buildPenpalContext === 'function')
                ? window.buildPenpalContext(mail.penpalId, pp.systemPrompt)
                : pp.systemPrompt;
            AndroidMail.sendMail(content, mail.penpalId, pp.name, memoPrompt);
        }
    }
    cancelReply();
    closeDetail();
    setTimeout(function() { loadMails(); }, 300);
    var pp = getPenpal(mail.penpalId);
    showToast('回信已寄给 ' + (pp ? pp.name : '笔友') + '，等待回信');
}

function openPenpalSheet(noteContent) {
    pendingNoteContent = noteContent;
    document.getElementById('detailOverlay').classList.add('open');
    showPenpalSheetUI(noteContent);
}

function showPenpalSheetUI(noteContent) {
    var overlay = document.getElementById('detailOverlay');
    if (!overlay.classList.contains('open')) overlay.classList.add('open');

    var existingSheet = document.getElementById('penpalSheet');
    if (existingSheet) existingSheet.remove();

    var sheet = document.createElement('div');
    sheet.id = 'penpalSheet';
    sheet.className = 'penpal-sheet';
    sheet.innerHTML =
        '<div class="penpal-sheet-handle"></div>' +
        '<div class="penpal-sheet-title">选择笔友</div>' +
        '<div class="penpal-sheet-subtitle">选择一位笔友，将这篇笔记寄给 Ta</div>' +
        '<div class="penpal-sheet-list">' +
        penpals.map(function(p) {
            return '<div class="penpal-sheet-item" onclick="confirmSend(\'' + p.id + '\')">' +
                penpalAvatarHtml('penpal-sheet-avatar', p, 'background:' + p.color + '20') +
                '<div class="penpal-sheet-name" style="color:' + p.color + '">' + p.name + '</div>' +
                '<div class="penpal-sheet-personality">' + p.personality + '</div>' +
                '</div>';
        }).join('') +
        '</div>';

    document.body.appendChild(sheet);

    requestAnimationFrame(function() {
        sheet.classList.add('open');
    });
}

function confirmSend(penpalId) {
    if (hasMailBridge && pendingNoteContent) {
        var pp = getPenpal(penpalId);
        if (pp) {
            var memoPrompt = (typeof window.buildPenpalContext === 'function')
                ? window.buildPenpalContext(penpalId, pp.systemPrompt)
                : pp.systemPrompt;
            AndroidMail.sendMail(pendingNoteContent, penpalId, pp.name, memoPrompt);
        }
    }

    var sheet = document.getElementById('penpalSheet');
    if (sheet) {
        sheet.classList.remove('open');
        document.getElementById('detailOverlay').classList.remove('open');
        setTimeout(function() { if (sheet.parentNode) sheet.remove(); }, 400);
    }

    closeDetail();
    setTimeout(function() { loadMails(); }, 300);

    var pp = getPenpal(penpalId);
    showToast('信件已寄给 ' + (pp ? pp.name : '笔友') + '，等待回信');
}

function showToast(msg) {
    var existing = document.getElementById('mailToast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'mailToast';
    toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%) translateY(20px);background:rgba(0,0,0,0.8);color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;z-index:700;opacity:0;pointer-events:none;transition:all 0.3s ease;';
    toast.textContent = msg;
    document.body.appendChild(toast);

    requestAnimationFrame(function() {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
    }, 2000);
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

function goBack() {
    if (hasMailBridge) {
        window.location.href = '../app.html';
    } else {
        history.back();
    }
}

init();
