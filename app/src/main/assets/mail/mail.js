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
    r.style.setProperty('--safe-area-top', Math.round(top / dpr) + 'px');
    r.style.setProperty('--safe-area-bottom', Math.round(bottom / dpr) + 'px');
    r.style.setProperty('--keyboard-height', Math.round((keyboard || 0) / dpr) + 'px');

    // 回信输入框: position:fixed + bottom 跟随键盘
    var compose = document.getElementById('replyCompose');
    if (compose) {
        var kb = Math.round((keyboard || 0) / dpr);
        var sb = Math.round(bottom / dpr);
        if (kb > 60) {
            compose.style.position = 'fixed';
            compose.style.left = '0';
            compose.style.right = '0';
            compose.style.bottom = kb + 'px';
            compose.style.zIndex = '20';
        } else {
            compose.style.position = '';
            compose.style.left = '';
            compose.style.right = '';
            compose.style.bottom = '';
            compose.style.zIndex = '';
        }
    }
};

var hasMailBridge = (typeof AndroidMail !== 'undefined' && AndroidMail !== null);

var penpals = [
    { id: "nian", name: "念念", emoji: "💭", color: "#e85d04", personality: "你的 AI 生活伴侣", systemPrompt: "" },
    { id: "xiaonuan", name: "小暖", emoji: "暖", color: "#FF8FA3", personality: "温柔善良，善解人意", systemPrompt: "..." },
    { id: "aran", name: "阿燃", emoji: "燃", color: "#FF6B35", personality: "热血奋进，永不服输", systemPrompt: "..." },
    { id: "shubai", name: "书白", emoji: "书", color: "#4A6FA5", personality: "博学睿智，冷静通透", systemPrompt: "..." },
    { id: "momo", name: "墨墨", emoji: "墨", color: "#9B59B6", personality: "浪漫文艺，天马行空", systemPrompt: "..." }
];
var mails = [];
var currentFilter = null;

function init() {
    loadMails();
    loadMailThreads();
    renderPenpalFilter();
}

function loadPenpals() {
    renderPenpalFilter();
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
    // 恢复 thread 数据
    loadMailThreads();
    applyMailThreads();
    // 合并念念主动消息
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

    // Demo mails for preview when empty
    if (mails.length === 0) {
        mails = [
            {
                id: 'demo_1',
                penpalId: 'xiaonuan',
                noteContent: '今天工作上遇到了一个棘手的项目，和同事沟通不太顺畅。感觉自己有些急躁了，事后回想起来，其实可以更耐心一些。',
                reply: '听到你这么说，我能感受到你内心的那份自省。其实你已经做得很好了——能够在情绪过后冷静地反思，这本身就是一种很难得的品质。\n\n工作上的摩擦在所难免，重要的是你看到了自己的不足，这比任何完美的表现都更珍贵。下次当你感到急躁时，不妨先深呼吸三次，想想对方的角度。\n\n你是一个温柔的人，只是偶尔被压力遮住了光芒。今天早点休息，明天又是新的一天呢。',
                sentAt: Date.now() - 3600000,
                repliedAt: Date.now() - 3500000,
                status: 'replied',
                read: false
            },
            {
                id: 'demo_2',
                penpalId: 'shubai',
                noteContent: '最近在读《思考，快与慢》，书中提到系统1和系统2的运作方式让我很有启发。我们大部分的日常决策都是系统1在快速处理，而真正需要深度思考的时候才调用系统2。这让我意识到，很多我之前的"直觉"判断，其实只是思维懒惰。',
                reply: '你的这个思考非常精彩。卡尼曼的双系统理论确实是理解人类认知的一把钥匙。\n\n有趣的是，系统1并非总是"懒惰"的代名词——在真正的专家手中，经过大量刻意练习后形成的直觉（系统1），往往比刻意的分析（系统2）更准确。关键在于区分"基于经验的直觉"和"基于偏见的捷径"。\n\n不妨做一个练习：这周每天记录3个你认为是"直觉"的判断，然后回溯分析它们是来自真正的经验，还是认知捷径。你会更了解自己的思维模式。\n\n继续读下去，这本书的后半部分关于"两个自我"的讨论会更精彩。',
                sentAt: Date.now() - 7200000,
                repliedAt: Date.now() - 7100000,
                status: 'replied',
                read: true
            }
        ];
    }
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
            '<div class="penpal-filter-avatar" style="color:' + p.color + ';background:' + p.color + '20">' + p.emoji + '</div>' +
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
        container.innerHTML = '<div class="envelope-empty">信箱还是空的<br>在笔记页选择一篇笔记<br>发给笔友吧</div>';
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
            // 标记念念主动消息为已读
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

    // Build thread view: original mail + all replies
    var bodyHtml = '<div class="letter-original-label">你写给 ' + (pp ? pp.name : '笔友') + ' 的信 · ' + dateStr + '</div>' +
        '<div class="letter-original">' + escapeHtml(mail.noteContent) + '</div>';

    if (mail.status === 'sending') {
        bodyHtml += '<div style="text-align:center;padding:20px 0;color:var(--text-muted);">信件已寄出，等待回信中...</div>';
    } else if (mail.reply) {
        // Main AI reply
        bodyHtml +=
            '<div class="letter-reply" style="border-left-color:' + color + '">' +
            '<div class="letter-reply-from">' +
            '<div class="letter-reply-avatar" style="background:' + color + '20">' + (pp ? pp.emoji : '信') + '</div>' +
            '<span class="letter-reply-name" style="color:' + color + '">' + (pp ? pp.name : '笔友') + '</span>' +
            '</div>' +
            '<div class="letter-reply-content">' + escapeHtml(mail.reply) + '</div>' +
            '<div class="letter-reply-footer">' + getReplyDate(mail) + '</div>' +
            '</div>';
    }

    // Thread replies (user → AI continuations)
    if (mail.thread && mail.thread.length > 0) {
        for (var ti = 0; ti < mail.thread.length; ti++) {
            var t = mail.thread[ti];
            if (t.role === 'user') {
                bodyHtml += '<div class="letter-original-label thread-label">你的回信 · ' + (t.at ? t.at.substring(0, 10) : '') + '</div>' +
                    '<div class="letter-original thread-user">' + escapeHtml(t.content) + '</div>';
            } else if (t.role === 'assistant') {
                bodyHtml +=
                    '<div class="letter-reply thread-reply" style="border-left-color:' + color + '">' +
                    '<div class="letter-reply-from">' +
                    '<div class="letter-reply-avatar" style="background:' + color + '20">' + (pp ? pp.emoji : '信') + '</div>' +
                    '<span class="letter-reply-name" style="color:' + color + '">' + (pp ? pp.name : '笔友') + '</span>' +
                    '</div>' +
                    '<div class="letter-reply-content">' + escapeHtml(t.content) + '</div>' +
                    '<div class="letter-reply-footer">' + (t.at ? t.at.substring(0, 16) : '') + '</div>' +
                    '</div>';
            }
        }
    }

    // Reply button always at bottom
    bodyHtml += '<div class="letter-reply-actions" style="margin-top:12px">' +
        '<button class="letter-reply-btn secondary" onclick="showReplyInput(' + "'" + mailId + "'" + ')">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>回复' +
        '</button></div>';

    document.getElementById('detailBody').innerHTML = bodyHtml;
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
}

function markAllRead() {
    if (hasMailBridge) { AndroidMail.markAllRead(); }
    mails.forEach(function(m) { m.read = true; });
    renderEnvelopeWall();
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
    if (!content) { showToast('请先写下回信内容'); return; }
    var mail = null;
    for (var i = 0; i < mails.length; i++) {
        if (mails[i].id === pendingReplyMailId) { mail = mails[i]; break; }
    }
    if (!mail) return;

    var pp = getPenpal(mail.penpalId);
    if (!pp) { showToast('笔友不存在'); return; }

    // 保存 parentId 再清掉
    var parentId = pendingReplyMailId;

    // 追加用户回复到 thread
    if (!mail.thread) mail.thread = [];
    mail.thread.push({ role: 'user', content: content, at: new Date().toISOString() });
    saveMailThreads();

    // 清掉 compose
    document.getElementById('replyCompose').classList.remove('open');
    document.getElementById('replyComposeInput').value = '';
    pendingReplyMailId = null;

    // 直接调 AI (不经过 AndroidMail.sendMail, 避免新建 mail)
    var token = '';
    try {
        var authRaw = typeof AndroidSettings !== 'undefined' ? AndroidSettings.loadSettings() : '{}';
        if (authRaw) token = JSON.parse(authRaw).nian_auth_token || '';
    } catch(e) {}

    showToast('正在等待 ' + pp.name + ' 回信...');

    if (token && typeof AndroidHttp !== 'undefined' && AndroidHttp.get) {
        var ctx = '原始来信: ' + (mail.noteContent || '').replace(/<[^>]+>/g, '').substring(0, 500) + '\n';
        if (mail.reply) ctx += 'AI 初次回信: ' + mail.reply.substring(0, 300) + '\n';
        ctx += '用户回复: ' + content;

        var payload = {
            model: 'deepseek-v4-flash',
            messages: [
                { role: 'system', content: pp.systemPrompt },
                { role: 'user', content: ctx }
            ],
            temperature: 0.7, max_tokens: 400,
            thinking: { type: 'disabled' }
        };
        var url = (window.__NianBackend && window.__NianBackend.url || 'http://115.159.116.240:3456/v1').replace(/\/+$/, '') + '/chat/completions';
        var qs = 'token=' + encodeURIComponent(token) + '&q=' + encodeURIComponent(JSON.stringify(payload));
        var sep = url.indexOf('?') === -1 ? '?' : '&';

        setTimeout(function() {
            try {
                var resp = JSON.parse(AndroidHttp.get(url + sep + qs));
                var reply = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
                if (reply) {
                    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
                    mail.thread.push({ role: 'assistant', content: reply, at: new Date().toISOString() });
                    saveMailThreads();
                }
            } catch(e) {}
            loadMails();
            openDetail(parentId);
        }, 800);
    } else {
        showToast('暂不支持云端回复');
    }
}

function saveMailThreads() {
    var threads = {};
    for (var i = 0; i < mails.length; i++) {
        if (mails[i].thread && mails[i].thread.length > 0) {
            threads[mails[i].id] = mails[i].thread;
        }
    }
    localStorage.setItem('nian_mail_threads', JSON.stringify(threads));
}

function loadMailThreads() {
    try {
        var raw = localStorage.getItem('nian_mail_threads');
        if (raw) { var t = JSON.parse(raw); applyThreads(t); }
    } catch(e) {}
}

function applyThreads(threads) {
    for (var i = 0; i < mails.length; i++) {
        if (threads[mails[i].id]) {
            mails[i].thread = threads[mails[i].id];
        }
    }
}

function applyMailThreads() {
    try {
        var raw = localStorage.getItem('nian_mail_threads');
        if (raw) applyThreads(JSON.parse(raw));
    } catch(e) {}
}

// 子邮件过滤: 隐藏属于某个 thread 的子邮件，把 reply 合并到父 thread
function filterChildMails() {
    try {
        var hiddenIds = JSON.parse(localStorage.getItem('nian_hidden_mail_ids') || '[]');
        var threads = JSON.parse(localStorage.getItem('nian_mail_threads') || '{}');
        // 找新出现的 replied mail，匹配 pending 回复
        var pending = JSON.parse(localStorage.getItem('nian_mail_pending_replies') || '{}');
        var changed = false;
        for (var i = mails.length - 1; i >= 0; i--) {
            var m = mails[i];
            if (m.status === 'replied' && m.reply && hiddenIds.indexOf(m.id) === -1) {
                // 查找是否属于某个 pending 父邮件(同笔友+时间匹配)
                for (var pid in pending) {
                    var times = pending[pid];
                    for (var ti = 0; ti < times.length; ti++) {
                        if (parseInt(m.sentAt) > times[ti]) {
                            // 合并到父 thread
                            if (!threads[pid]) threads[pid] = [];
                            threads[pid].push({ role: 'assistant', content: m.reply, at: m.replyAt || m.sentAt });
                            hiddenIds.push(m.id);
                            times.splice(ti, 1);
                            changed = true;
                            break;
                        }
                    }
                    if (times.length === 0) delete pending[pid];
                }
            }
            // 隐藏已标记的子邮件
            if (hiddenIds.indexOf(m.id) !== -1) {
                mails.splice(i, 1);
            }
        }
        if (changed) {
            localStorage.setItem('nian_hidden_mail_ids', JSON.stringify(hiddenIds));
            localStorage.setItem('nian_mail_threads', JSON.stringify(threads));
            localStorage.setItem('nian_mail_pending_replies', JSON.stringify(pending));
        }
    } catch(e) {}
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
                '<div class="penpal-sheet-avatar" style="background:' + p.color + '20">' + p.emoji + '</div>' +
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
    // 注入云端 API 配置到 SharedPreferences —— MailWorker.kt 需要
    var backendUrl = (window.__NianBackend && window.__NianBackend.url) || 'http://115.159.116.240:3456/v1';
    var token = '';
    try {
        var authRaw3 = AndroidSettings.loadSettings();
        if (authRaw3) { var a3 = JSON.parse(authRaw3); token = a3.nian_auth_token || ''; }
    } catch(e) {}
    if (token && hasBridge) {
        var raw = AndroidSettings.loadSettings();
        var settings = raw ? JSON.parse(raw) : {};
        settings.apiUrl = backendUrl;
        settings.apiKey = token;
        settings.model = 'deepseek-v4-flash';
        AndroidSettings.saveSettings(JSON.stringify(settings));
    }

    if (hasMailBridge && pendingNoteContent) {
        var pp = getPenpal(penpalId);
        if (pp) {
            AndroidMail.sendMail(pendingNoteContent, penpalId, pp.name, pp.systemPrompt);
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
