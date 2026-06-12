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

    var replyContent = '';
    if (mail.status === 'sending') {
        replyContent = '<div style="text-align:center;padding:40px 0;color:var(--text-muted);">信件已寄出，等待回信中...</div>';
    } else if (mail.reply) {
        replyContent =
            '<div class="letter-reply" style="border-left-color:' + color + '">' +
            '<div class="letter-reply-from">' +
            '<div class="letter-reply-avatar" style="background:' + color + '20">' + (pp ? pp.emoji : '信') + '</div>' +
            '<span class="letter-reply-name" style="color:' + color + '">' + (pp ? pp.name : '笔友') + '</span>' +
            '</div>' +
            '<div class="letter-reply-content">' + escapeHtml(mail.reply) + '</div>' +
            '<div class="letter-reply-footer">' + getReplyDate(mail) + '</div>' +
            '<div class="letter-reply-actions">' +
            '<button class="letter-reply-btn secondary" onclick="showReplyInput(' + "'" + mailId + "'" + ')">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>回复' +
            '</button>' +
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
            AndroidMail.sendMail(content, mail.penpalId, pp.name, pp.systemPrompt);
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
