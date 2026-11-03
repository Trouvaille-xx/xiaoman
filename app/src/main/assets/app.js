
// ─── ImageService: file-based image storage ───
(function() {
    window.ImageService = {
        isAvailable: function() {
            return (typeof AndroidImage !== 'undefined' && AndroidImage !== null) ||
                   (typeof AndroidFile !== 'undefined' && AndroidFile !== null);
        },

        saveImages: function(base64Images, noteId) {
            return new Promise(function(resolve) {
                if (!base64Images || base64Images.length === 0) {
                    resolve([]);
                    return;
                }

                if (typeof AndroidImage !== 'undefined' && AndroidImage !== null) {
                    var json = JSON.stringify(base64Images);
                    var result = AndroidImage.saveImagesSync(json, noteId);
                    try {
                        var parsed = JSON.parse(result);
                        resolve(parsed);
                    } catch(e) {
                        resolve([]);
                    }
                } else {
                    resolve(base64Images.map(function(b64) {
                        return { id: '', path: b64 };
                    }));
                }
            });
        },

        getImageData: function(imageId) {
            if (typeof AndroidImage !== 'undefined' && AndroidImage !== null) {
                try {
                    var result = AndroidImage.getImageData(imageId);
                    var parsed = JSON.parse(result);
                    return parsed;
                } catch(e) {
                    return null;
                }
            }
            return null;
        },

        deleteImage: function(imageId) {
            if (typeof AndroidFile !== 'undefined' && AndroidFile !== null) {
                AndroidFile.deleteImage(imageId);
            }
        }
    };
})();

// ─── DataService: unified storage layer ───
(function() {
    var hasBridge = (typeof AndroidStorage !== 'undefined' && AndroidStorage !== null);
    window.DataService = {
        notes: {
            save: function(data) {
                if (hasBridge) {
                    AndroidStorage.saveNotes(JSON.stringify(data));
                    AndroidStorage.syncNotesToDb(JSON.stringify(data));
                } else {
                    try { localStorage.setItem('nian_notes', JSON.stringify(data)); } catch(e) {}
                }
            },
            load: function() {
                try {
                    var raw = hasBridge ? AndroidStorage.loadNotes() : localStorage.getItem('nian_notes');
                    return raw ? JSON.parse(raw) : [];
                } catch(e) { return []; }
            }
        },
        settings: {
            save: function(data) {
                if (hasBridge) {
                    AndroidSettings.saveSettings(JSON.stringify(data));
                } else {
                    try { localStorage.setItem('nian_settings', JSON.stringify(data)); } catch(e) {}
                }
            },
            load: function() {
                try {
                    var raw = hasBridge ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
                    return raw ? JSON.parse(raw) : null;
                } catch(e) { return null; }
            }
        }
    };
})();
if (typeof AndroidStorage === 'undefined') {
            var _notesData = localStorage.getItem('nian_notes');
            window.AndroidStorage = {
                saveNotes: function(json) { localStorage.setItem('nian_notes', json); },
                loadNotes: function() { return localStorage.getItem('nian_notes') || ''; }
            };
            window.AndroidSettings = {
                saveSettings: function(json) { localStorage.setItem('nian_settings', json); },
                loadSettings: function() { return localStorage.getItem('nian_settings') || ''; }
            };
        }
        // ─── Agent 初始化 ───
        var nianAgent = null;
        // 工具开关（Win 后台导出 app-config.js 的 tools.enabled 控制；缺省 = 全部启用）
        var enabledTools = null;
        try {
            var runtimeCfg = (typeof window !== 'undefined' && window.NIAN_CONFIG) || {};
            if (runtimeCfg.tools && Array.isArray(runtimeCfg.tools.enabled)) {
                enabledTools = runtimeCfg.tools.enabled;
            }
        } catch(e) {}

        function isToolEnabled(name) {
            return !enabledTools || enabledTools.indexOf(name) !== -1;
        }

        function initAgent() {
          if (typeof NianAgent === "undefined") return;
          nianAgent = new NianAgent();
          var regs = [
            ['searchNotesSkill', 'search_notes'],
            ['getNoteSkill', 'get_note'],
            ['listInsightModesSkill', 'list_insight_modes'],
            ['runInsightSkill', 'run_insight'],
            ['createNoteSkill', 'create_note'],
            ['getWeatherSkill', 'get_weather'],
            ['webSearchSkill', 'web_search'],
            ['sendProactiveMailSkill', 'send_proactive_mail'],
            ['updateArchiveSkill', 'update_archive'],
            ['rememberToSkill', 'remember_to'],
            ['noteStatsSkill', 'note_stats'],
            ['dailyReviewSkill', 'daily_review'],
            ['specialDaySkill', 'get_special_day'],
            ['generateNoteImageSkill', 'generate_note_image'],
            ['penpalWeeklyLetterSkill', 'penpal_weekly_letter']
          ];
          for (var ri = 0; ri < regs.length; ri++) {
            var globalName = regs[ri][0];
            var toolName = regs[ri][1];
            if (typeof window[globalName] !== 'undefined' && isToolEnabled(toolName)) {
              nianAgent.registerSkill(window[globalName]);
            }
          }
        }
        initAgent();
        // loadConversations();

        // ─── 遥测日志上报（Win 后台查看执行过程；浏览器 POST，Android 走原生桥）───
        function sendTelemetry(log) {
            try {
                var cfg = (typeof window !== 'undefined' && window.NIAN_CONFIG) || {};
                if (!cfg.telemetry || !cfg.telemetry.url) return;
                var payload = JSON.stringify([log]);
                if (typeof NativeHttp !== 'undefined' && typeof AndroidHttp !== 'undefined') {
                    NativeHttp.postJson(cfg.telemetry.url, {}, payload).catch(function() {});
                } else if (typeof fetch === 'function') {
                    fetch(cfg.telemetry.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(function() {});
                }
            } catch(e) {}
        }

        // ─── 提醒心跳扫描：启动后 + 每 30 分钟检查到期提醒，小满主动发信 ───
        function scanDueReminders() {
            try {
                if (typeof MemoryService === 'undefined' || typeof MemoryService.dueReminders !== 'function') return;
                if (typeof sendProactiveMailSkill === 'undefined') return;
                var due = MemoryService.dueReminders();
                if (!due.length) return;
                var reminders = MemoryService.loadReminders();
                var changed = false;
                for (var i = 0; i < reminders.length; i++) {
                    var r = reminders[i];
                    if (r.done) continue;
                    var isDue = false;
                    for (var di = 0; di < due.length; di++) {
                        if (due[di].id === r.id) { isDue = true; break; }
                    }
                    if (isDue) {
                        try {
                            sendProactiveMailSkill.execute({ subject: '小满的提醒', message: r.text });
                        } catch(e) {}
                        r.done = true;
                        changed = true;
                    }
                }
                if (changed) MemoryService.saveReminders(reminders);
            } catch(e) {}
        }
        setTimeout(scanDueReminders, 8000);
        setInterval(scanDueReminders, 30 * 60 * 1000);
        // 情绪感知关怀：与提醒同频扫描，检测到最近情绪低落时小满主动来信
        setTimeout(scanMoodCare, 15000);
        setInterval(scanMoodCare, 30 * 60 * 1000);

        // ─── 笔友周信定时扫描：启动后延迟 + 每 6 小时检查一次，
        // 距上次周信 ≥7 天且有可回顾笔记时，随机一位笔友来信 ───
        function scanWeeklyLetter() {
            try {
                if (typeof penpalWeeklyLetterSkill === 'undefined') return;
                var s = DataService.settings.load();
                if (!s) return;
                var last = s.lastWeeklyLetterAt ? parseInt(s.lastWeeklyLetterAt, 10) : 0;
                if (last && (Date.now() - last) < 7 * 24 * 60 * 60 * 1000) return;
                // 有最近 7 天的笔记才发，避免空周信
                penpalWeeklyLetterSkill.execute({}).then(function(result) {
                    if (result && result.success) showToast(result.message);
                });
            } catch(e) {}
        }
        setTimeout(scanWeeklyLetter, 20000);
        setInterval(scanWeeklyLetter, 6 * 60 * 60 * 1000);

        // ─── Agent 创建的笔记同步到 UI ───
        window.__agentCreateNote = function(content) {
          var note = { id: "note_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8), content: content, createdAt: new Date().toISOString() };
          notes.unshift(note);
          persistNotes();
          updateSidebarStats();
          renderHeatmap();
          showToast('小满为你记了一条笔记');
          if (currentPage === 'notes') {
            renderNotes(currentTagFilter);
            setTimeout(loadNoteImages, 100);
          }
        };

        let currentTagFilter = null;
        let currentPage = 'notes';
        var nianMessages = [];

// ─── Conversation History ───
var conversations = [];
var currentConvId = null;
var referencedNote = null;
var insightMethods = [];
var pendingInsightNoteId = null;
var isInsightMode = false;

// ─── 洞察场景 & 模式定义 ───
var INSIGHT_SCENARIOS = [
    { id: "emotion", name: "情绪梳理", desc: "心情不好、焦虑、愤怒、悲伤，想被理解和疏导" },
    { id: "reflect", name: "深度反思", desc: "对某件事想了很多，想挖更深、看清本质" },
    { id: "daily", name: "日常记录", desc: "今天发生了什么，想知道有什么值得关注的" },
    { id: "problem", name: "问题求助", desc: "遇到具体困难或矛盾，不知道怎么解决" },
    { id: "decision", name: "决策纠结", desc: "面临选择，各有利弊，难以下定决心" },
    { id: "relation", name: "人际困扰", desc: "和他人的关系出了问题，困惑或受伤" },
    { id: "self", name: "自我探索", desc: "想更了解自己——我是谁、我要什么、我的模式是什么" },
    { id: "growth", name: "成长规划", desc: "有目标但不知道怎么落地，想找到行动方向" }
];
var INSIGHT_MODES = [
    { id: "chat", name: "对话式", desc: "小满像朋友一样边聊边分析，可追问、可展开" },
    { id: "direct", name: "直接输出", desc: "一次性输出完整分析报告" },
    { id: "socratic", name: "苏格拉底追问", desc: "AI 只提问不给答案，引导用户自己找到答案" }
];
var insightPickerState = { step: 0, noteId: null, scenario: null };

// 存储结构：索引 key 只存元信息；每个对话单独一个 key 存消息。
// 单个对话数据损坏只影响它自己，不会连累整份历史。
var CONV_INDEX_KEY = 'nian_conv_index';
var CONV_PREFIX = 'nian_conv_';
var CONV_CURRENT_KEY = 'nian_conv_current';
var CONV_LEGACY_KEY = 'nian_conversations';
var REF_MARKER = '\n\n[引用笔记]\n';

function loadConversations() {
    conversations = [];

    // 1) 按索引逐个读回对话
    var index = null;
    try {
        var rawIndex = localStorage.getItem(CONV_INDEX_KEY);
        if (rawIndex) index = JSON.parse(rawIndex);
    } catch(e) { index = null; }

    if (index && index.length) {
        for (var i = 0; i < index.length; i++) {
            var meta = index[i];
            if (!meta || !meta.id) continue;
            var conv = null;
            try {
                var rawConv = localStorage.getItem(CONV_PREFIX + meta.id);
                if (rawConv) conv = JSON.parse(rawConv);
            } catch(e) { conv = null; }
            if (conv && conv.id) {
                if (!conv.messages) conv.messages = [];
                conversations.push(conv);
            } else {
                // 该对话缺失或损坏：用索引元信息兜底，并标记 damaged，
                // 后续保存时跳过它，避免用空消息覆盖可能还能恢复的原始数据
                conversations.push({
                    id: meta.id,
                    title: meta.title || '新的对话',
                    messages: [],
                    createdAt: meta.createdAt,
                    updatedAt: meta.updatedAt,
                    __damaged: true
                });
            }
        }
    }

    // 2) 新格式没有数据时，尝试从旧版单 key 迁移
    if (conversations.length === 0) {
        conversations = migrateLegacyConversations();
    }

    // 3) 确认两条路都没有数据，才新建空对话。
    //    关键改动：读取/解析失败不再立刻写回空数据（旧逻辑会借此覆盖全部历史）。
    if (conversations.length === 0) {
        var id = 'conv_' + Date.now();
        conversations.push({ id: id, title: '新的对话', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        currentConvId = id;
        saveConversations();
    } else {
        // 优先恢复上次打开的那个对话，找不到再退回第一条
        var savedCur = null;
        try { savedCur = localStorage.getItem(CONV_CURRENT_KEY); } catch(e) {}
        var exists = false;
        for (var k = 0; k < conversations.length; k++) {
            if (conversations[k].id === savedCur) { exists = true; break; }
        }
        currentConvId = exists ? savedCur : conversations[0].id;
    }

    var conv = getCurrentConv();
    if (conv) nianMessages = conv.messages;
}

// 旧版迁移：读 nian_conversations，拆成新格式写盘；旧 key 保留作备份不删除
function migrateLegacyConversations() {
    var legacy = null;
    try {
        var raw = localStorage.getItem(CONV_LEGACY_KEY);
        if (!raw) return [];
        legacy = JSON.parse(raw);
    } catch(e) { return []; }
    if (!legacy || !legacy.length) return [];

    var out = [];
    var index = [];
    for (var i = 0; i < legacy.length; i++) {
        var c = legacy[i];
        if (!c || !c.id) continue;
        if (!c.messages) c.messages = [];
        out.push(c);
        index.push({
            id: c.id,
            title: c.title || '新的对话',
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            msgCount: c.messages.length
        });
        try { localStorage.setItem(CONV_PREFIX + c.id, JSON.stringify(c)); } catch(e) {}
    }
    if (out.length) {
        try { localStorage.setItem(CONV_INDEX_KEY, JSON.stringify(index)); } catch(e) {}
        if (window.console) console.log('[conversation] 已从旧格式迁移', out.length, '个对话');
    }
    return out;
}

function saveConversations() {
    if (!conversations || !conversations.length) return;
    var index = [];
    for (var i = 0; i < conversations.length; i++) {
        var c = conversations[i];
        if (!c || !c.id) continue;
        index.push({
            id: c.id,
            title: c.title || '新的对话',
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            msgCount: (c.messages || []).length
        });
        if (c.__damaged) continue;
        try {
            localStorage.setItem(CONV_PREFIX + c.id, JSON.stringify({
                id: c.id,
                title: c.title || '新的对话',
                messages: c.messages || [],
                summary: c.summary,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt
            }));
        } catch(e) {
            if (window.console) console.warn('[conversation] 对话保存失败:', c.id, e);
        }
    }
    try {
        localStorage.setItem(CONV_INDEX_KEY, JSON.stringify(index));
    } catch(e) {
        if (window.console) console.warn('[conversation] 索引保存失败:', e);
    }
}

function getCurrentConv() {
    for (var i = 0; i < conversations.length; i++) {
        if (conversations[i].id === currentConvId) return conversations[i];
    }
    return conversations.length > 0 ? conversations[0] : null;
}

function newConversation() {
    var id = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    conversations.unshift({ id: id, title: '新的对话', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    currentConvId = id;
    nianMessages = conversations[0].messages;
    try { localStorage.setItem(CONV_CURRENT_KEY, id); } catch(e) {}
    saveConversations();
    closeHistoryPanel();
    renderNianMessages();
    if (typeof window.resetAgentContext === 'function') window.resetAgentContext(nianMessages, undefined);
}

function switchToConversation(id) {
    currentConvId = id;
    var conv = getCurrentConv();
    if (conv) nianMessages = conv.messages;
    try { localStorage.setItem(CONV_CURRENT_KEY, id); } catch(e) {}
    renderNianMessages();
    renderHistoryList();
    saveConversations();
    // 切换对话时同步 agent 上下文（限长重建 + 恢复摘要），避免旧对话消息污染新对话
    if (typeof window.resetAgentContext === 'function') window.resetAgentContext(nianMessages, conv ? conv.summary : undefined);
}

// 把消息内容拆成「气泡里的话」和「引用的笔记正文」
// 存储格式没变（正文仍跟在 [引用笔记] 标记后，AI 上下文照旧完整），
// 只在渲染时剥离出来折叠，历史旧消息也能自动获得折叠效果。
function splitRefNote(content) {
    var s = content || '';
    var i = s.indexOf(REF_MARKER);
    if (i < 0) return { text: s, ref: null };
    return { text: s.substring(0, i), ref: s.substring(i + REF_MARKER.length) };
}

// 引用笔记折叠条：默认收起，点击展开/收起全文
function buildRefChip(refText) {
    var firstLine = (refText.split('\n')[0] || '').replace(/\s+/g, ' ').trim();
    var preview = firstLine.length > 40 ? firstLine.substring(0, 40) + '…' : firstLine;
    var wrap = document.createElement('div');
    wrap.className = 'nian-ref-chip-wrap';

    var chip = document.createElement('div');
    chip.className = 'nian-ref-chip';
    chip.innerHTML = '<span class="nian-ref-chip-arrow">▸</span>'
        + '<span class="nian-ref-chip-title">引用笔记</span>'
        + '<span class="nian-ref-chip-preview">' + escapeHtml(preview) + '</span>';
    chip.onclick = function() {
        var open = wrap.classList.toggle('open');
        var arrow = chip.querySelector('.nian-ref-chip-arrow');
        if (arrow) arrow.textContent = open ? '▾' : '▸';
    };
    wrap.appendChild(chip);

    var body = document.createElement('div');
    body.className = 'nian-ref-body';
    body.textContent = refText;
    wrap.appendChild(body);
    return wrap;
}

// 渲染一条用户消息：气泡在上，引用笔记折叠条在气泡下方
function renderUserMessageEl(el, rawContent) {
    var parts = splitRefNote(rawContent);
    var stack = document.createElement('div');
    stack.className = 'nian-msg-stack';

    var bubble = document.createElement('div');
    bubble.className = 'nian-message-text';
    bubble.innerHTML = escapeHtml(parts.text);
    stack.appendChild(bubble);

    if (parts.ref) stack.appendChild(buildRefChip(parts.ref));
    el.appendChild(stack);
}

function renderNianMessages() {
    var container = document.getElementById('nianChatMessages');
    if (!container) return;
    container.innerHTML = '';
    var conv = getCurrentConv();
    if (!conv || conv.messages.length === 0) {
        var msg = document.createElement('div');
        msg.className = 'nian-message assistant';
        msg.innerHTML = '<div class="nian-message-text">你好呀！我是小满，你的 AI 日记伴侣。有什么想和我分享的吗？</div>';
        container.appendChild(msg);
        return;
    }
    for (var i = 0; i < conv.messages.length; i++) {
        var m = conv.messages[i];
        if (m.role === 'system') continue;
        var el = document.createElement('div');
        el.className = 'nian-message ' + (m.role === 'user' ? 'user' : 'assistant');
        if (m.role === 'user') {
            renderUserMessageEl(el, m.content || '');
        } else {
            el.innerHTML = '<div class="nian-message-text">' + renderThinkContent(m.content || '') + '</div>';
        }
        container.appendChild(el);
    }
    scrollToBottom();
}

function toggleHistoryPanel() {
    var p = document.getElementById('historyPanel');
    if (!p) return;
    if (p.classList.contains('open')) closeHistoryPanel();
    else openHistoryPanel();
}
function openHistoryPanel() { renderHistoryList(); var p=document.getElementById('historyPanel'),o=document.getElementById('historyOverlay'); if(p)p.classList.add('open'); if(o)o.classList.add('open'); }
function closeHistoryPanel() { var p=document.getElementById('historyPanel'),o=document.getElementById('historyOverlay'); if(p)p.classList.remove('open'); if(o)o.classList.remove('open'); }

function renderHistoryList() {
    var container = document.getElementById('historyList');
    if (!container) return;
    container.innerHTML = '';
    for (var i = 0; i < conversations.length; i++) {
        var c = conversations[i];
        var d = new Date(c.updatedAt || c.createdAt);
        (function(convId, title, dateStr, isActive) {
            var div = document.createElement('div');
            div.className = 'history-panel-item' + (isActive ? ' active' : '');
            div.innerHTML = '<div class="history-panel-item-title">' + escapeHtml(title) + '</div><div class="history-panel-item-meta">' + dateStr + '</div>';
            div.onclick = function() { if (convId !== currentConvId) switchToConversation(convId); closeHistoryPanel(); };
            container.appendChild(div);
        })(c.id, c.title || '新对话', (d.getMonth()+1)+'/'+d.getDate(), c.id === currentConvId);
    }
}

loadConversations();

// 冷启动时把上次打开的对话渲染出来。
// 否则页面会一直停在 HTML 里写死的欢迎气泡，看起来像「历史没存」。
function renderInitialConversation() {
    try { renderNianMessages(); } catch(e) { if (window.console) console.warn('[conversation] 初始渲染失败:', e); }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderInitialConversation);
} else {
    renderInitialConversation();
}

// 对话页激活时给 .content 加标记类，用于收窄底部留白（让输入面板下沉）。
// 用观察者而不是改 switchToXxx 里的每一处 active 切换，避免漏改。
(function syncChatActiveClass() {
    var content = document.getElementById('appContent');
    var page = document.getElementById('nianPage');
    if (!content || !page) return;
    function sync() {
        if (page.classList.contains('active')) content.classList.add('chat-active');
        else content.classList.remove('chat-active');
    }
    try {
        new MutationObserver(sync).observe(page, { attributes: true, attributeFilter: ['class'] });
    } catch(e) {}
    sync();
})();

function deleteConversation(id) {
    if (conversations.length <= 1) { showToast('至少保留一个对话'); return; }
    conversations = conversations.filter(function(c) { return c.id !== id; });
    if (currentConvId === id) currentConvId = conversations[0].id;
    try { localStorage.removeItem(CONV_PREFIX + id); } catch(e) {}
    saveConversations();
    switchToConversation(currentConvId);
}

// ─── 帮我记 ───
function insertRememberTag() {
    var input = document.getElementById('nianChatInput');
    if (!input) return;
    input.value = '#帮我记 ';
    input.focus();
    autoGrowInput(input);
}

// ─── 引用笔记 ───
function openNotePicker() {
    var container = document.getElementById('notePickerList');
    if (!container) return;
    container.innerHTML = '';
    if (notes.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px">暂无笔记</div>';
    } else {
        var recent = notes.slice(0, 20);
        for (var i = 0; i < recent.length; i++) {
            (function(note) {
                var preview = (note.content || '').replace(/<[^>]+>/g, '').substring(0, 50);
                var date = (note.createdAt || '').substring(0, 10);
                var div = document.createElement('div');
                div.className = 'penpal-sheet-item';
                div.innerHTML = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:2px">' + date + '</div><div style="font-size:14px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(preview) + '</div>';
                div.onclick = function() { selectNote(note); };
                container.appendChild(div);
            })(recent[i]);
        }
    }
    var o = document.getElementById('notePickerOverlay');
    var s = document.getElementById('notePickerSheet');
    if (o) o.classList.add('open');
    if (s) s.classList.add('open');
}

function closeNotePicker() {
    var o = document.getElementById('notePickerOverlay');
    var s = document.getElementById('notePickerSheet');
    if (o) o.classList.remove('open');
    if (s) s.classList.remove('open');
}

// 笔记正文统一转纯文本：先把 HTML 的换行标记换成真换行，再剥标签。
// 直接 replace(/<[^>]+>/g,'') 会把 <br>、</p> 一起吃掉，原本分段的内容
// 会被缝成一大坨，看起来就像"展示不全 / 串行"。
function plainNoteText(html) {
    return (html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '');
}

function selectNote(note) {
    closeNotePicker();
    referencedNote = note;
    var date = (note.createdAt || '').substring(0, 10);
    var full = plainNoteText(note.content).replace(/\n{3,}/g, '\n\n').trim();
    var el = document.getElementById('nianRefPreview');
    if (el) {
        var txt = el.querySelector('.nian-ref-preview-text');
        // 摘要条只显示两行（换行压成空格交给 CSS 截断），全文点开弹层看
        if (txt) txt.textContent = '📎 ' + date + ' ' + full.replace(/\s+/g, ' ');
        el.style.display = 'block';
    }
}

// 点预览条 → 底部弹层显示笔记全文。
// 不用在输入框上方原地展开：这条 538 字的笔记正文高 794px，
// 而屏幕只有 914px，原位展开必然把消息区压扁、把输入框挤出屏幕。
function openRefNoteSheet() {
    if (!referencedNote) return;
    // 键盘没关时弹层会落在键盘后面：布局视口高度不变，fixed 底部就被挡住了。
    // 先让输入框失焦收起键盘，再弹层。
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    var full = plainNoteText(referencedNote.content).replace(/\n{3,}/g, '\n\n').trim();
    var date = (referencedNote.createdAt || '').substring(0, 10);
    var body = document.getElementById('refNoteSheetBody');
    var meta = document.getElementById('refNoteSheetMeta');
    if (body) body.textContent = full;
    if (meta) meta.textContent = date + ' · 共 ' + full.replace(/\s/g, '').length + ' 字';
    var o = document.getElementById('refNoteOverlay');
    var s = document.getElementById('refNoteSheet');
    if (o) o.classList.add('open');
    if (s) {
        s.classList.add('open');
        if (body) body.scrollTop = 0;
    }
}

function closeRefNoteSheet() {
    var o = document.getElementById('refNoteOverlay');
    var s = document.getElementById('refNoteSheet');
    if (o) o.classList.remove('open');
    if (s) s.classList.remove('open');
}

function clearNoteReference() {
    closeRefNoteSheet();
    referencedNote = null;
    var el = document.getElementById('nianRefPreview');
    if (el) el.style.display = 'none';
}

// ─── 洞察模式 ───
function enterInsightMode() {
    openInsightPicker(false, null);
}

function enterInsightModeUI() {
    // 洞察的选择与结果都直接在对话里完成，不再改动页面结构
    isInsightMode = true;
}

function exitInsightMode() {
    // 仅清理选择器状态，页面本身不做任何变化
    var el = document.getElementById('insightPicker');
    if (el) el.style.display = 'none';
    insightPickerState = { step: 0, noteId: null, scenario: null };
    isInsightMode = false;
}

// ─── 洞察选择器 ───
function openInsightPicker(fromMenu, noteId) {
    insightPickerState = { step: 0, noteId: null, scenario: null };
    var el = document.getElementById('insightPicker');
    if (!el) return;
    el.style.display = 'block';
    if (fromMenu && noteId) {
        insightPickerState.noteId = noteId;
        showInsightScenarios();
    } else {
        showInsightNotes();
    }
}

function closeInsightPicker() {
    if (isInsightMode) {
        exitInsightMode();
        return;
    }
    var el = document.getElementById('insightPicker');
    if (el) el.style.display = 'none';
    insightPickerState = { step: 0, noteId: null, scenario: null };
}

function goBackInsightStep() {
    if (insightPickerState.step <= 1) {
        showInsightNotes();
    } else if (insightPickerState.step === 2) {
        showInsightScenarios();
    }
}

function showInsightNotes() {
    insightPickerState.step = 0;
    insightPickerState.scenario = null;
    var title = document.getElementById('insightPickerTitle');
    var back = document.getElementById('insightPickerBack');
    var chips = document.getElementById('insightPickerChips');
    if (title) title.textContent = '选择笔记';
    if (back) back.style.display = 'none';

    var allNotes = DataService.notes.load() || [];
    var recent = allNotes.slice(0, 20);
    if (recent.length === 0) {
        chips.innerHTML = '<div style="padding:4px 14px 12px;font-size:13px;color:var(--text-muted)">暂无笔记</div>';
        return;
    }
    chips.innerHTML = recent.map(function(n) {
        var preview = (n.content || '').replace(/<[^>]+>/g, '').replace(/--isHTML /, '').substring(0, 30);
        var date = (n.createdAt || '').substring(0, 10);
        return '<span class="insight-picker-chip note-chip" onclick="selectInsightNote(\'' + n.id + '\')" title="' + escapeHtml(date + ': ' + preview) + '">' + escapeHtml(preview || '(空)') + '</span>';
    }).join('');
}

function selectInsightNote(noteId) {
    insightPickerState.noteId = noteId;
    if (!isInsightMode) enterInsightModeUI();
    var chips = document.getElementById('insightPickerChips');
    chips.innerHTML = '<div class="insight-picker-loading"><span>AI 正在分析笔记</span><span class="dot-pulse"></span><span class="dot-pulse"></span><span class="dot-pulse"></span></div>';
    var title = document.getElementById('insightPickerTitle');
    if (title) title.textContent = 'AI 分析中...';
    recommendScenarios(noteId);
}

function recommendScenarios(noteId) {
    var allNotes = DataService.notes.load() || [];
    var note = null;
    for (var i = 0; i < allNotes.length; i++) {
        if (allNotes[i].id === noteId) { note = allNotes[i]; break; }
    }
    if (!note) { showInsightScenarios(); return; }
    var content = (note.content || '').replace(/--isHTML /, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    var preview = content.substring(0, 200);

    var config = null;
    try { config = DataService.settings.load(); } catch(e) {}
    if (!config || !config.apiUrl || !config.apiKey) { showInsightScenarios(); return; }

    var url = NativeHttp.chatEndpoint(config.apiUrl);

    var scenarioList = INSIGHT_SCENARIOS.map(function(s, idx) {
        return (idx + 1) + '. ' + s.name + '：' + s.desc;
    }).join('\n');

    var payload = {
        model: config.model || 'gpt-4o',
        messages: [
            { role: 'system', content: '你是一个日记分析场景分类器。根据日记内容，从以下 8 个场景中选择最匹配的 3 个。只返回场景编号，用逗号分隔，如 "1,3,5"。不要返回其他内容。\n\n' + scenarioList },
            { role: 'user', content: '日记内容：' + preview }
        ],
        temperature: 0.3,
        max_tokens: 20
    };

    try {
        // Android 走原生桥（无 CORS），浏览器走 XHR
        var request = (typeof NativeHttp !== 'undefined')
            ? NativeHttp.postJson(url, { Authorization: 'Bearer ' + config.apiKey }, payload)
            : new Promise(function(resolve) {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', url);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('Authorization', 'Bearer ' + config.apiKey);
                xhr.timeout = 10000;
                xhr.onload = function() {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try { resolve(JSON.parse(xhr.responseText)); }
                        catch(e) { resolve(null); }
                    } else {
                        resolve(null);
                    }
                };
                xhr.onerror = function() { resolve(null); };
                xhr.ontimeout = function() { resolve(null); };
                xhr.send(JSON.stringify(payload));
            });

        request.then(function(data) {
            if (!data) { showInsightScenarios(); return; }
            try {
                var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                if (text) {
                    var nums = text.match(/\d+/g);
                    if (nums && nums.length > 0) {
                        var recommended = [];
                        for (var ni = 0; ni < nums.length && recommended.length < 3; ni++) {
                            var idx = parseInt(nums[ni]) - 1;
                            if (idx >= 0 && idx < INSIGHT_SCENARIOS.length && recommended.indexOf(idx) === -1) {
                                recommended.push(idx);
                            }
                        }
                        if (recommended.length > 0) { showInsightScenarios(recommended); return; }
                    }
                }
            } catch(e) {}
            showInsightScenarios();
        }, function() { showInsightScenarios(); });
    } catch(e) { showInsightScenarios(); }
}

function showInsightScenarios(recommendedIndices) {
    insightPickerState.step = 1;
    insightPickerState.scenario = null;
    var title = document.getElementById('insightPickerTitle');
    var back = document.getElementById('insightPickerBack');
    var chips = document.getElementById('insightPickerChips');
    if (title) title.textContent = '选择场景';
    if (back) { back.style.display = 'flex'; back.onclick = goBackInsightStep; }

    if (recommendedIndices && recommendedIndices.length > 0) {
        var html = '';
        for (var i = 0; i < recommendedIndices.length; i++) {
            var s = INSIGHT_SCENARIOS[recommendedIndices[i]];
            html += '<span class="insight-picker-chip recommend" onclick="selectInsightScenario(\'' + s.id + '\')">' + s.name + '</span>';
        }
        html += '<span class="insight-picker-chip more" onclick="showAllScenarios()">更多 ▸</span>';
        chips.innerHTML = html;
    } else {
        showAllScenarios();
    }
}

function showAllScenarios() {
    var title = document.getElementById('insightPickerTitle');
    var back = document.getElementById('insightPickerBack');
    var chips = document.getElementById('insightPickerChips');
    if (title) title.textContent = '选择场景';
    if (back) { back.style.display = 'flex'; back.onclick = goBackInsightStep; }
    chips.innerHTML = INSIGHT_SCENARIOS.map(function(s) {
        return '<span class="insight-picker-chip" onclick="selectInsightScenario(\'' + s.id + '\')">' + s.name + '</span>';
    }).join('');
}

function selectInsightScenario(scenarioId) {
    for (var i = 0; i < INSIGHT_SCENARIOS.length; i++) {
        if (INSIGHT_SCENARIOS[i].id === scenarioId) {
            insightPickerState.scenario = INSIGHT_SCENARIOS[i];
            break;
        }
    }
    showInsightModes();
}

function showInsightModes() {
    insightPickerState.step = 2;
    var title = document.getElementById('insightPickerTitle');
    var back = document.getElementById('insightPickerBack');
    var chips = document.getElementById('insightPickerChips');
    if (title) title.textContent = '选择交互模式';
    if (back) { back.style.display = 'flex'; back.onclick = goBackInsightStep; }
    chips.innerHTML = INSIGHT_MODES.map(function(m) {
        return '<span class="insight-picker-chip" onclick="executeInsight(\'' + m.id + '\')">' + m.name + '</span>';
    }).join('');
}

function executeInsight(modeId) {
    var noteId = insightPickerState.noteId;
    var scenario = insightPickerState.scenario;
    if (!noteId || !scenario) return;

    var mode = null;
    for (var i = 0; i < INSIGHT_MODES.length; i++) {
        if (INSIGHT_MODES[i].id === modeId) { mode = INSIGHT_MODES[i]; break; }
    }
    if (!mode) return;

    // 隐藏选择器
    var el = document.getElementById('insightPicker');
    if (el) el.style.display = 'none';
    insightPickerState = { step: 0, noteId: null, scenario: null };

    var allNotes = DataService.notes.load() || [];
    var note = null;
    for (var i = 0; i < allNotes.length; i++) {
        if (allNotes[i].id === noteId) { note = allNotes[i]; break; }
    }
    if (!note) return;

    var content = (note.content || '').replace(/--isHTML /, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

    var config = null;
    try { config = DataService.settings.load(); } catch(e) {}
    if (!config || !config.apiUrl || !config.apiKey) {
        var container = document.getElementById('nianChatMessages');
        var errMsg = document.createElement('div');
        errMsg.className = 'nian-message assistant';
        errMsg.innerHTML = '<div class="nian-message-text">请先在设置中配置 AI 参数（API 地址、密钥、模型）</div>';
        container.appendChild(errMsg);
        var errConv = getCurrentConv();
        if (errConv) {
            errConv.messages.push({ role: 'assistant', content: '请先在设置中配置 AI 参数（API 地址、密钥、模型）' });
            errConv.updatedAt = new Date().toISOString();
            saveConversations();
        }
        exitInsightMode();
        scrollToBottom();
        return;
    }

    var modePrompts = {
        'chat': '你是一个温暖的 AI 日记伴侣「小满」。请以对话的方式，对用户的日记进行深入分析。边分析边与用户互动，可以提出问题引发用户思考，也可以根据用户的回应调整分析方向。分析视角：' + scenario.name + '。',
        'direct': '你是一个深度洞察分析师。请对用户的日记内容进行全面而深入的分析。直接输出完整的分析报告，不需要互动。分析视角：' + scenario.name + '。输出格式：使用简洁的中文，结构化呈现。',
        'socratic': '你是一个苏格拉底式的提问者。不要给出任何答案或建议，只通过一个接一个的深度问题，引导用户自己发现答案。每个问题要直击本质，帮助用户从新的角度审视自己的日记。分析视角：' + scenario.name + '。只提问，不给答案。'
    };
    var systemPrompt = modePrompts[modeId] || modePrompts['chat'];

    var container = document.getElementById('nianChatMessages');
    var userMsg = document.createElement('div');
    userMsg.className = 'nian-message user';
    userMsg.innerHTML = '<div class="nian-message-text">洞察分析：' + escapeHtml(scenario.name) + ' · ' + mode.name + '</div>';
    container.appendChild(userMsg);
    var insightConv = getCurrentConv();
    if (insightConv) {
        insightConv.messages.push({ role: 'user', content: '洞察分析：' + scenario.name + ' · ' + mode.name });
        insightConv.updatedAt = new Date().toISOString();
        saveConversations();
    }
    scrollToBottom();

    var typingId = showTypingIndicator(true);

    var url = NativeHttp.chatEndpoint(config.apiUrl);

    var payload = {
        model: config.model || 'gpt-4o',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '以下是我的日记内容，请分析：\n\n' + content }
        ],
        temperature: 0.8,
        max_tokens: 2000
    };

    if (modeId === 'chat' && typeof nianAgent !== 'undefined' && nianAgent.messages) {
        nianAgent.messages.push({ role: 'user', content: '【洞察模式 - ' + scenario.name + '】请以对话方式分析这篇日记：\n\n' + content });
    }

    // Android 走原生桥（无 CORS），浏览器走 XHR
    var request = (typeof NativeHttp !== 'undefined')
        ? NativeHttp.postJson(url, { Authorization: 'Bearer ' + config.apiKey }, payload)
        : new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('Authorization', 'Bearer ' + config.apiKey);
            xhr.timeout = 60000;
            xhr.onload = function() {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch(e) { reject(new Error('parse')); }
                } else {
                    reject(new Error('http ' + xhr.status));
                }
            };
            xhr.onerror = function() { reject(new Error('network')); };
            xhr.ontimeout = function() { reject(new Error('timeout')); };
            xhr.send(JSON.stringify(payload));
        });

    request.then(function(data) {
        hideTypingIndicator(typingId);
        try {
            var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            if (text) {
                text = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                var assistantMsg = document.createElement('div');
                assistantMsg.className = 'nian-message assistant';
                assistantMsg.innerHTML = '<div class="nian-message-text">' + renderThinkContent(text) + '</div>';
                container.appendChild(assistantMsg);
                if (modeId === 'chat' && typeof nianAgent !== 'undefined' && nianAgent.messages) {
                    nianAgent.messages.push({ role: 'assistant', content: text });
                }
                var resConv = getCurrentConv();
                if (resConv) {
                    resConv.messages.push({ role: 'assistant', content: text });
                    resConv.updatedAt = new Date().toISOString();
                    saveConversations();
                }
                // 结果已展示在对话中，仅清理选择器状态（不改动页面）
                exitInsightMode();
                scrollToBottom();
                return;
            }
        } catch(e) {}
        var errMsg = document.createElement('div');
        errMsg.className = 'nian-message assistant';
        errMsg.innerHTML = '<div class="nian-message-text">洞察分析失败，请重试</div>';
        container.appendChild(errMsg);
        exitInsightMode();
        scrollToBottom();
    }, function(err) {
        hideTypingIndicator(typingId);
        var msgText = (err && err.message === 'timeout') ? '洞察分析超时' : '网络请求失败';
        var errMsg = document.createElement('div');
        errMsg.className = 'nian-message assistant';
        errMsg.innerHTML = '<div class="nian-message-text">' + msgText + '</div>';
        container.appendChild(errMsg);
        exitInsightMode();
        scrollToBottom();
    });
}

        function buildNianSystemPrompt(query) {
            try {
                var mem = null;
                if (typeof MemoryService !== 'undefined') {
                    mem = MemoryService.load();
                } else if (typeof AndroidMemory !== 'undefined' && AndroidMemory !== null) {
                    var raw = AndroidMemory.loadAll();
                    if (raw) mem = JSON.parse(raw);
                } else {
                    var cached = localStorage.getItem('nian_memories');
                    if (cached) mem = JSON.parse(cached);
                }

                // 已注册 skill 摘要 → tools 段（让模型知道有什么工具、何时用）
                var toolList = null;
                if (nianAgent && typeof nianAgent.getToolDefinitions === 'function') {
                    var defs = nianAgent.getToolDefinitions();
                    if (defs && defs.length) {
                        toolList = [];
                        for (var di = 0; di < defs.length; di++) {
                            var fn = defs[di].function;
                            if (fn) {
                                toolList.push({ name: fn.name, desc: fn.description || '' });
                            }
                        }
                    }
                }

                if (typeof MemoryService !== 'undefined') {
                    // 统一构建：各段带上限 + 自动 tools 段 + 回忆段（moments），防止 system prompt 无限膨胀
                    return MemoryService.buildSystemPrompt(mem, toolList, query);
                }

                // 兜底（memory-service.js 未加载时）
                if (mem) {
                    var files = mem.files || {};
                    var parts = [];
                    if (files.identity && files.identity.trim()) {
                        parts.push('## 身份\n' + files.identity);
                    }
                    if (files.soul && files.soul.trim()) {
                        parts.push('## 灵魂\n' + files.soul);
                    }
                    if (files.user && files.user.trim()) {
                        parts.push('## 用户\n' + files.user);
                    }
                    if (files.tools && files.tools.trim()) {
                        parts.push('## 工具\n' + files.tools);
                    }
                    if (files.memory && files.memory.trim()) {
                        parts.push('## 记忆\n' + files.memory);
                    }
                    if (files.heartbeat && files.heartbeat.trim()) {
                        parts.push('## 心跳\n' + files.heartbeat);
                    }
                    if (parts.length === 0) {
                        return '你是小满，温暖的AI伴侣。用亲切自然的语气回复。\n\n当用户告诉你个人信息（姓名/职业/兴趣等），用 update_archive 工具写入对应档案文件，不需询问直接保存。';
                    }
                    return '你是小满，温暖的AI伴侣。\n\n以下是完整上下文：\n\n' + parts.join('\n\n') + '\n\n用亲切自然的语气回复。\n\n当用户告诉你个人信息时，用 update_archive 写入对应档案。不需要询问，直接保存。';
                }
            } catch(e) {}
            return '你是小满，温暖的AI伴侣。用亲切自然的语气回复。\n\n当用户告诉你个人信息时，用 update_archive 写入对应档案文件，不需询问直接保存。';
        }

        function __applySafeInsets(top, bottom, keyboard) {
            var dpr = window.devicePixelRatio || 1;
            var r = document.documentElement;
            r.style.setProperty('--safe-area-top', Math.round(top / dpr) + 'px');
            r.style.setProperty('--safe-area-bottom', Math.round(bottom / dpr) + 'px');
            r.style.setProperty('--keyboard-height', Math.round((keyboard || 0) / dpr) + 'px');
            updateChatKeyboardMargin(Math.round((keyboard || 0) / dpr));
            adjustEditorForKeyboard();
        }

        // 键盘弹出时把小满聊天输入框底边精确钉到键盘顶边。
        // 不用 CSS 魔法数字硬算抬升量，而是实测当前底边位置做线性修正：
        // margin 每增加 1px 底边上移 1px，故一次修正即可到位，自动吸收
        // 头部高度/底部导航/安全区等布局偏差，避免输入框与键盘之间出现缝隙。
        function updateChatKeyboardMargin(kbLogical) {
            var el = document.querySelector('#nianPage .nian-chat-input-container');
            if (!el || el.offsetParent === null) return; // 页面隐藏时跳过
            var desiredBottom = window.innerHeight - (kbLogical || 0); // 键盘顶边的目标位置
            var cur = parseFloat(el.style.marginBottom) || 0;
            var delta = el.getBoundingClientRect().bottom - desiredBottom;
            var next = Math.max(0, cur + delta);
            if (Math.abs(next - cur) > 0.5) el.style.marginBottom = next + 'px';
        }

        function persistNotes() {
            try {
                DataService.notes.save(notes);
            } catch(e) {}
        }

        function loadNotes() {
            return DataService.notes.load();
        }

        const notes = loadNotes();
        var hasWelcome = notes.some(function(n) { return n.id === 'welcome'; });
        if (!hasWelcome) {
            notes.unshift(
                { id: 'welcome', content: '#小满 #入门指南\n\n欢迎来到小满。\n\n小满是一个温暖的个人成长伴侣，以下是你可以做的事：\n\n记录生活\n点击下方 + 号，随时记录你的心情、想法和日常。#标签 可以帮助你整理和回顾。右上角的搜索框可以按内容或标签查找笔记。\n\n和小满对话\n底部切换到小满页，你可以和 AI 聊天。小满会记住你在「记忆管理」中填写的信息，还会引用你们的对话历史。\n\n把笔记寄给笔友\n每篇笔记右上角「···」→ 发信，选择一位笔友（小暖、阿燃、书白、墨墨），他们会用各自的风格给你回信。回信会出现在右上角信箱图标里，带红点提醒。\n\n深度洞察\n笔记菜单「···」→ 洞察，选择一种分析模式（5why追问、盲区探索、灵魂拷问等 16 种），小满会从不同角度帮你深度理解自己的想法。\n\n打造你们的回忆\n小满会把你们一起经历的重要时刻（大事、心情、期待）记进「回忆」里。小满页右上角大脑图标 → 进入回忆空间：最近的心情、回忆时间线都在这里。你还可以让小满把最近的回忆写成信，送到你的信箱。档案里的身份/灵魂/用户/概要文件会自动注入对话，让相处越来越懂你。\n\n自定义提示词\n侧边栏 → 设置 → 提示词管理，你可以编辑所有洞察模式的 AI 提示词，打造完全个性化的分析体验。\n\n祝你在这里遇见更好的自己。', createdAt: new Date().toISOString() }
            );
        }
        if (notes.length === 0) {
            notes.push(
                { id: '1', content: '今天天气很好，心情也跟着明朗起来。#好心情 #日常', createdAt: new Date().toISOString() },
                { id: '2', content: '读到一句很有启发的话：人生没有白走的路，每一步都算数。#感悟 #读书', createdAt: new Date(Date.now() - 86400000).toISOString() },
                { id: '3', content: '工作上的项目终于完成了，虽然过程艰辛，但结果很满意。#工作 #成就感', createdAt: new Date(Date.now() - 172800000).toISOString() }
            );
        }
        if (!hasWelcome || notes.length === 0) {
            persistNotes();
        }

        function switchToNotes() {
            if (typeof closeNoteExpand === 'function') closeNoteExpand();
            if (typeof closeAllNoteMenus === 'function') closeAllNoteMenus();
            currentPage = 'notes';
            document.getElementById('notesPage').classList.add('active');
            document.getElementById('nianPage').classList.remove('active');
            document.getElementById('navNotes').classList.add('active');
            document.getElementById('navNian').classList.remove('active');
            document.getElementById('appHeader').style.display = 'flex';
            var brand = document.getElementById('headerBrand');
            if (brand) brand.remove();
            var mailIcon = document.querySelector('.header-icon[onclick*="openMailbox"]');
            if (mailIcon) mailIcon.style.marginLeft = '';
            var memIcon = document.getElementById('memoryIcon');
            if (memIcon) memIcon.style.display = 'none';
            createSearchElements();
            createTagDropdown();
            closeFab();
            closeSidebar();
            renderNotes(currentTagFilter);
            setTimeout(loadNoteImages, 100);
        }

        function switchToNian() {
            if (typeof closeNoteExpand === 'function') closeNoteExpand();
            if (typeof closeAllNoteMenus === 'function') closeAllNoteMenus();

            currentPage = 'nian';
            document.getElementById('notesPage').classList.remove('active');
            document.getElementById('nianPage').classList.add('active');
            document.getElementById('navNotes').classList.remove('active');
            document.getElementById('navNian').classList.add('active');
            document.getElementById('appHeader').style.display = 'flex';
            var brand = document.getElementById('headerBrand');
            if (!brand) {
                brand = document.createElement('span');
                brand.className = 'header-brand';
                brand.id = 'headerBrand';
                // 图形标直接克隆侧栏那份，同一个 SVG 不抄两遍（改标只改 app.html 的 .drawer-lockup）
                var markSrc = document.querySelector('.drawer-lockup .brand-mark');
                if (markSrc) brand.appendChild(markSrc.cloneNode(true));
                var brandWord = document.createElement('span');
                brandWord.className = 'brand-word';
                brandWord.id = 'headerBrandWord';
                brandWord.textContent = '小满';
                brand.appendChild(brandWord);
                var brandDot = document.createElement('span');
                brandDot.className = 'brand-dot';
                brandDot.textContent = '.';
                brand.appendChild(brandDot);
                document.getElementById('appHeader').insertBefore(brand, document.querySelector('.header-icon[onclick*="openMailbox"]'));
            }
            var mailIcon = document.querySelector('.header-icon[onclick*="openMailbox"]');
            if (mailIcon) mailIcon.style.marginLeft = 'auto';
            var memIcon = document.getElementById('memoryIcon');
            if (memIcon) memIcon.style.display = '';
            var dd = document.getElementById('headerTagDropdown');
            if (dd) dd.remove();
            var sc = document.getElementById('searchContainer');
            if (sc) sc.remove();
            var si = document.querySelector('.search-icon');
            if (si) si.remove();
            closeFab();
            closeSidebar();

            // Onboarding: always read fresh localStorage state
            nian_onboarded = localStorage.getItem('nian_onboarded');
            if (!nian_onboarded && !onbShowing) {
                showOnboarding();
            }
        }

        // ─── Onboarding ───
        var nian_onboarded = localStorage.getItem('nian_onboarded');
        var onbAnimating = false;
        var onbTyping = false;
        var onbShowing = false;

        var ONB_TEXTS = [
            [
                { text: '嗨，我是小满', cls: 'tw-title' },
                { text: '', cls: 'tw-space' },
                { text: '住在这个 app 里的小精灵', cls: 'tw-body' },
                { text: '诞生于人工智能时代', cls: 'tw-body' },
                { text: '', cls: 'tw-space' },
                { text: '没有那些厉害的 AI 懂得多', cls: 'tw-body' },
                { text: '只希望在未来的日子里', cls: 'tw-body' },
                { text: '接住你的情绪，陪你一起思考', cls: 'tw-body' }
            ],
            [
                { text: '我们拥有共同的记忆', cls: 'tw-title' },
                { text: '', cls: 'tw-space' },
                { text: '你告诉我的，我都会记得', cls: 'tw-body' },
                { text: '', cls: 'tw-space' },
                { text: '除此之外，我还可以', cls: 'tw-body' },
                { text: '帮你记录、陪你聊天、整理思绪', cls: 'tw-body' }
            ],
            [
                { text: '前路漫漫', cls: 'tw-title' },
                { text: '', cls: 'tw-space' },
                { text: '可以让我陪着你走吗', cls: 'tw-body' }
            ]
        ];

        function showOnboarding() {
            if (onbShowing) return;
            onbShowing = true;
            var ob = document.getElementById('nianOnboarding');
            if (!ob) return;
            ob.style.display = 'flex';
            var slide0 = document.getElementById('onbSlide0');
            if (slide0) {
                slide0.style.display = 'flex';
                setTimeout(function() {
                    slide0.classList.add('visible');
                    startTyping(0, function() {
                        var card = slide0.querySelector('.onb-card');
                        if (card) card.onclick = function() {
                            if (!onbTyping) nextOnboardingSlide(0);
                        };
                    });
                }, 100);
            }
        }

        function startTyping(slideIndex, callback) {
            onbTyping = true;
            var container = document.getElementById('tw' + slideIndex);
            if (!container) { onbTyping = false; if (callback) callback(); return; }
            container.innerHTML = '';
            var lines = ONB_TEXTS[slideIndex];
            var lineIdx = 0;
            var charIdx = 0;
            var cursor = document.createElement('span');
            cursor.className = 'tw-cursor';
            container.appendChild(cursor);

            function typeLine() {
                if (lineIdx >= lines.length) {
                    cursor.classList.add('done');
                    onbTyping = false;
                    if (callback) callback();
                    return;
                }
                var line = lines[lineIdx];
                var el = document.createElement('div');
                el.className = 'tw-line ' + (line.cls || '');
                container.insertBefore(el, cursor);

                if (line.text === '') {
                    el.className = 'tw-line tw-space';
                    lineIdx++;
                    setTimeout(typeLine, 200);
                    return;
                }

                charIdx = 0;
                function typeChar() {
                    if (charIdx < line.text.length) {
                        el.textContent += line.text[charIdx];
                        charIdx++;
                        var delay = 30 + Math.random() * 20;
                        setTimeout(typeChar, delay);
                    } else {
                        el.classList.add('twFadeIn');
                        lineIdx++;
                        setTimeout(typeLine, 250);
                    }
                }
                typeChar();
            }

            setTimeout(typeLine, 300);
        }

        function nextOnboardingSlide(current) {
            if (onbAnimating) return;
            onbAnimating = true;

            var next = current + 1;
            if (next > 2) { onbAnimating = false; finishOnboarding(); return; }

            var curSlide = document.getElementById('onbSlide' + current);
            var nextSlide = document.getElementById('onbSlide' + next);

            if (curSlide) {
                curSlide.classList.remove('visible');
                curSlide.classList.add('exit');
                setTimeout(function() {
                    curSlide.style.display = 'none';
                    curSlide.classList.remove('exit');
                }, 260);
            }

            if (nextSlide) {
                nextSlide.style.display = 'flex';
                requestAnimationFrame(function() {
                    nextSlide.classList.add('visible');
                });
                // Start typing on the next slide
                startTyping(next, function() {
                    var card = nextSlide.querySelector('.onb-card');
                    if (card) {
                        if (next < 2) {
                            card.onclick = function() {
                                if (!onbTyping) nextOnboardingSlide(next);
                            };
                        } else {
                            var btn = document.getElementById('onbStartBtn');
                            if (btn) {
                                btn.style.display = 'inline-block';
                                btn.onclick = function() { finishOnboarding(); };
                            }
                        }
                    }
                });
            }

            // Update dots
            var dots = document.querySelectorAll('.onb-dot');
            for (var d = 0; d < dots.length; d++) {
                dots[d].classList.toggle('active', d === next);
            }

            setTimeout(function() { onbAnimating = false; }, 400);
        }

        function finishOnboarding() {
            onbShowing = false;
            var ob = document.getElementById('nianOnboarding');
            if (ob) {
                ob.style.opacity = '0';
                ob.style.transition = 'opacity 0.35s';
                setTimeout(function() {
                    ob.style.display = 'none';
                    ob.style.opacity = '';
                    ob.style.transition = '';
                }, 360);
            }
            nian_onboarded = '1';
            try { localStorage.setItem('nian_onboarded', '1'); } catch(e) {}
        }

        var MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
        var MONTH_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var noteMonthGroups = [];

        function renderNoteCard(note, size) {
            var wrapperClass = 'note-card-wrapper';
            if (size) wrapperClass += ' ' + size;
            var date = new Date(note.createdAt);
            var dateStr = (date.getMonth() + 1) + '月' + date.getDate() + '日 ' +
                date.getHours().toString().padStart(2, '0') + ':' +
                date.getMinutes().toString().padStart(2, '0');
            var rawContent = note.content;
            var isHTML = rawContent.indexOf('--isHTML ') === 0;
            var html;
            if (isHTML) {
                html = rawContent.substring(9);
                html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:2px 1px">');
                html = html.replace(/#([^\s<]+)/g, '<span class="tag-inline">#$1</span>');
            } else {
                html = rawContent;
                html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:2px 1px">');
                html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
                html = html.replace(/<u>([^<]+)<\/u>/g, '<u>$1</u>');
                html = html.replace(/#([^\s]+)/g, '<span class="tag-inline">#$1</span>');
                html = html.replace(/\n/g, '<br>');
            }

            var imagesHtml = '';
            var imageIds = [];
            html = html.replace(/<img[^>]*>/g, function(m) {
                var imageIdMatch = m.match(/data-image-id="([^"]+)"/);
                if (imageIdMatch) {
                    imageIds.push(imageIdMatch[1]);
                    if (m.indexOf('onclick=') === -1) {
                        m = m.replace(/<img/, '<img onclick="openImagePreview(\'' + imageIdMatch[1] + '\')"');
                    }
                }
                if (m.indexOf('loading=') === -1) m = m.replace(/<img/, '<img loading="lazy"');
                imagesHtml += m;
                return '';
            });

            var noteIdAttr = 'data-note-id="' + note.id + '"';
            var imageIdsAttr = imageIds.length ? ' data-image-ids="' + imageIds.join(',') + '"' : '';

            var wordCount = (rawContent.match(/[一-龥]/g) || []).length +
                (rawContent.match(/[a-zA-Z0-9]+/g) || []).length;
            var editDate = note.updatedAt || note.createdAt;
            var editDateObj = new Date(editDate);
            var editDateStr = editDateObj.getFullYear() + '-' +
                (editDateObj.getMonth() + 1).toString().padStart(2, '0') + '-' +
                editDateObj.getDate().toString().padStart(2, '0');

            var dayAttr = size === 'featured' ? ' data-day="' + date.getDate() + '"' : '';

            return '<div class="' + wrapperClass + '" ' + noteIdAttr + imageIdsAttr + '>' +
                '<div class="note-card" onclick="toggleNoteExpand(this)"' + dayAttr + '>' +
                    '<div class="note-meta">' +
                        '<span class="note-date">' + dateStr + '</span>' +
                    '</div>' +
                    '<div class="note-text note-text-collapsed">' + html + '</div>' +
                    (imagesHtml ? '<div class="note-images">' + imagesHtml + '</div>' : '') +
                '</div>' +
                '<div class="note-menu-btn" onclick="event.stopPropagation(); toggleNoteMenu(this)">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="note-menu">' +
                    '<div class="note-menu-section">' +
                        '<div class="note-menu-item" onclick="event.stopPropagation(); editNote(\'' + note.id + '\')">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
                                '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>' +
                            '</svg>' +
                            '<span>编辑</span>' +
                        '</div>' +
                        '<div class="note-menu-item" onclick="event.stopPropagation(); shareNote(\'' + encodeURIComponent(note.content) + '\')">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
                                '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>' +
                                '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>' +
                            '</svg>' +
                            '<span>分享</span>' +
                        '</div>' +
                        '<div class="note-menu-item danger" onclick="event.stopPropagation(); deleteNote(\'' + note.id + '\')">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
                                '<polyline points="3 6 5 6 6 6 21 6"/>' +
                                '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
                            '</svg>' +
                            '<span>删除</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="note-menu-section note-menu-section-wide">' +
                        '<div class="note-menu-item note-menu-item-horizontal" onclick="event.stopPropagation(); openInsightSheet(\'' + note.id + '\')">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
                                '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/>' +
                            '</svg>' +
                            '<span>洞察</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="note-menu-section note-menu-section-wide">' +
                        '<div class="note-menu-item note-menu-item-horizontal" onclick="event.stopPropagation(); openImageGenSheet(\'' + note.id + '\')">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
                                '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>' +
                            '</svg>' +
                            '<span>配图</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="note-menu-section note-menu-section-wide">' +
                        '<div class="note-menu-item note-menu-item-horizontal" onclick="event.stopPropagation(); openPenpalSheet(decodeURIComponent(\'' + encodeURIComponent(note.content) + '\'))">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
                                '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>' +
                            '</svg>' +
                            '<span>发信</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="note-menu-meta">' +
                        '<span>字数 ' + wordCount + '</span>' +
                        '<span>' + editDateStr + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }

        function renderNotes(tagFilter) {
            if (tagFilter === undefined) tagFilter = null;
            var container = document.getElementById('notesList');
            var filteredNotes = notes;

            if (tagFilter) {
                filteredNotes = notes.filter(function(note) {
                    var tags = note.content.match(/#([^\s]+)/g) || [];
                    return tags.some(function(t) { return t.substring(1) === tagFilter; });
                });
            }

            if (filteredNotes.length === 0) {
                container.innerHTML = '<div class="empty-hint">还没有笔记<br>点击下方 + 开始记录</div>';
                noteMonthGroups = [];
                return;
            }

            // Sort by date descending
            var sorted = filteredNotes.slice().sort(function(a, b) {
                return new Date(b.createdAt) - new Date(a.createdAt);
            });

            // Group by year-month
            var groups = [];
            var currentKey = null;
            var currentGroup = null;
            for (var i = 0; i < sorted.length; i++) {
                var d = new Date(sorted[i].createdAt);
                var key = d.getFullYear() + '-' + (d.getMonth() + 1);
                if (key !== currentKey) {
                    currentKey = key;
                    currentGroup = {
                        year: d.getFullYear(),
                        month: d.getMonth() + 1,
                        monthName: MONTH_NAMES[d.getMonth()],
                        enName: MONTH_EN[d.getMonth()],
                        notes: []
                    };
                    groups.push(currentGroup);
                }
                currentGroup.notes.push(sorted[i]);
            }
            noteMonthGroups = groups;

            var html = '';
            var currentYear = null;

            for (var g = 0; g < groups.length; g++) {
                var group = groups[g];
                if (group.year !== currentYear) {
                    currentYear = group.year;
                    if (g > 0) {
                        html += '<div class="notes-year-divider"><span class="notes-year-label">' + group.year + '</span></div>';
                    }
                }

                html += '<div class="notes-section" data-month-index="' + g + '">';
                html += '<div class="notes-section-header" onclick="toggleMonthSection(this.parentElement)">';
                html += '<span class="notes-section-month">' + group.monthName + '</span>';
                html += '<span class="notes-section-en">' + group.enName + '</span>';
                html += '<span class="notes-section-count">' + group.notes.length + ' 篇</span>';
                html += '</div>';
                html += '<div class="notes-flow">';
                var RATIOS = [[17,7],[16,8],[14,10],[13,11],[12,12],[11,13],[10,14],[8,16]];
                var regIdx = 0;
                for (var n = 0; n < group.notes.length; n++) {
                    var size;
                    if (n === 0) {
                        size = 'featured';
                    } else {
                        regIdx++;
                        if (regIdx % 2 === 1) {
                            var lenA = (group.notes[n].content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
                            var hasB = n + 1 < group.notes.length;
                            var lenB = hasB ? (group.notes[n+1].content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').length : 0;

                            // Pick ratio: bigger content diff → more lopsided
                            var diff = hasB ? Math.abs(lenA - lenB) : 1000;
                            var idx;
                            if (diff < 30) idx = 4;                        // similar → 1:1
                            else if (diff < 80) idx = Math.random() > 0.5 ? 3 : 5;  // ~6:5 or ~5:6
                            else if (diff < 200) idx = Math.random() > 0.5 ? 2 : 6;  // 7:5 or 5:7
                            else if (diff < 500) idx = Math.random() > 0.5 ? 1 : 7;  // 2:1 or 1:2
                            else idx = Math.random() > 0.5 ? 0 : 8;                  // 5:2 or 2:5

                            var pair = RATIOS[Math.min(Math.max(idx, 0), 7)];
                            if (!hasB) {
                            size = 'size-full';
                        } else if (lenA >= lenB) {
                                size = 'size-' + pair[0] + 'w';
                                if (hasB) group.notes[n+1]._pairSize = 'size-' + pair[1] + 'n';
                            } else {
                                size = 'size-' + pair[1] + 'n';
                                if (hasB) group.notes[n+1]._pairSize = 'size-' + pair[0] + 'w';
                            }
                        } else {
                            size = group.notes[n]._pairSize || 'size-full';
                        }
                    }
                    html += renderNoteCard(group.notes[n], size);
                }
                html += '</div>';
                html += '</div>';
            }

            container.innerHTML = html;
        }

        function toggleMonthSection(section) {
            section.classList.toggle('collapsed');
        }

        // 菜单开关：菜单保持在原 wrapper 内，用 CSS class .open 控制显示
        // position: absolute + top: 44px + right: 8px 是 CSS 写死的
        // wrapper 不再创建堆叠上下文（去掉了 content-visibility: auto），
        // 菜单的 z-index 2147483647 直接进 body 根堆叠上下文压制一切
        function toggleNoteMenu(btn) {
            var menu = btn.nextElementSibling;
            if (menu.classList.contains('open')) {
                // 同一个菜单再次点击 → 关闭
                menu.classList.remove('open');
            } else {
                // 关闭所有其它打开的菜单
                closeAllNoteMenus();
                menu.classList.add('open');
            }
        }

        function closeAllNoteMenus() {
            document.querySelectorAll('.note-menu.open').forEach(function(m) {
                m.classList.remove('open');
            });
        }

        // 全局 click-outside：菜单没开就不处理；按钮和菜单内部不关
        document.addEventListener('click', function(e) {
            var openMenus = document.querySelectorAll('.note-menu.open');
            if (openMenus.length === 0) return;
            // 点击 ⋮ 按钮 → toggleNoteMenu 自己处理
            if (e.target.closest && e.target.closest('.note-menu-btn')) return;
            // 点击在菜单内部 → 不关
            if (e.target.closest && e.target.closest('.note-menu.open')) return;
            // 其他位置 → 关
            closeAllNoteMenus();
        }, true);

        // Esc 键关闭
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' || e.keyCode === 27) {
                closeAllNoteMenus();
            }
        });

        // img.onerror 处理器：图片加载失败时换成占位 div
        function onImageLoadError(img) {
            if (!img || !img.parentNode) return;
            if (img.classList.contains('image-error-handled')) return;
            img.classList.add('image-error-handled');
            var id = img.getAttribute('data-image-id') || '';
            var placeholder = document.createElement('div');
            placeholder.className = 'image-missing';
            placeholder.innerHTML = '<div class="image-missing-icon">🖼</div><div class="image-missing-text">图片不可用</div>';
            placeholder.onclick = function() { openImagePreview(id); };
            img.parentNode.replaceChild(placeholder, img);
        }

        // 兼容旧数据：file:// / image:// / content:// 全部改写为 https://
        function loadNoteImages() {
            var imgs = document.querySelectorAll('.note-card-wrapper img[data-image-id]');
            imgs.forEach(function(img) {
                var src = img.getAttribute('src') || '';
                // data: 是浏览器端的 base64 fallback，保留
                if (src.indexOf('data:') === 0) return;
                var id = img.getAttribute('data-image-id');
                if (id) {
                    img.src = 'https://appassets.androidplatform.net/images/' + id + '.jpg';
                }
            });
        }

        function toggleNoteExpand(card) {
            var wrapper = card.closest('.note-card-wrapper');
            if (wrapper) {
                wrapper.classList.add('note-selected');
                setTimeout(function() { wrapper.classList.remove('note-selected'); }, 600);
            }
            var text = card.querySelector('.note-text');
            text.classList.toggle('note-text-collapsed');
        }

        function openImagePreview(imageId) {
            var overlay = document.getElementById('imagePreviewOverlay');
            var container = document.getElementById('imagePreviewContainer');
            // 1. 优先复用原图 src —— 浏览器侧是 base64，WebView 侧是 https://
            var src = '';
            var origImg = document.querySelector('img[data-image-id="' + imageId + '"]');
            if (origImg) {
                src = origImg.getAttribute('src') || '';
            }
            // 2. 原图不在 DOM 时，WebView 用 https:// 重新构造
            if (!src && imageId && (typeof AndroidImage !== 'undefined')) {
                src = 'https://appassets.androidplatform.net/images/' + imageId + '.jpg';
            }
            container.innerHTML = '<img src="' + src + '" onclick="event.stopPropagation()" onerror="this.parentNode.innerHTML=\'<div class=&quot;image-missing&quot; style=&quot;padding:40px&quot;>图片不可用</div>\'">';
            overlay.classList.add('open');
        }

        function closeImagePreview() {
            var overlay = document.getElementById('imagePreviewOverlay');
            overlay.classList.remove('open');
        }

        function closeAllNoteMenus() {
            document.querySelectorAll('.note-menu.open').forEach(function(m) {
                m.classList.remove('open');
                m.style.transform = '';
            });
            document.querySelectorAll('.note-card-wrapper.menu-open').forEach(function(w) {
                w.classList.remove('menu-open');
            });
        }

        // 菜单宽度固定而卡片可能很窄，打开后按真实尺寸限制在视口内。
        // 使用 transform 保留原有 right:8px 锚点，不改变卡片布局。
        function clampNoteMenuToViewport(menu) {
            if (!menu) return;
            menu.style.transform = '';
            var rect = menu.getBoundingClientRect();
            var viewportWidth = document.documentElement.clientWidth || window.innerWidth;
            var edge = 8;
            var targetLeft = Math.max(edge, Math.min(rect.left, viewportWidth - rect.width - edge));
            var delta = targetLeft - rect.left;
            if (Math.abs(delta) > 0.5) {
                menu.style.transform = 'translateX(' + delta + 'px)';
            }
        }

        function toggleNoteMenu(btn) {
            var menu = btn.nextElementSibling;
            var wrapper = btn.closest('.note-card-wrapper');
            var wasOpen = menu.classList.contains('open');
            closeAllNoteMenus();
            if (!wasOpen) {
                menu.classList.add('open');
                if (wrapper) wrapper.classList.add('menu-open');
                clampNoteMenuToViewport(menu);
            }
        }

        var pendingDeleteId = null;

        function deleteNote(id) {
            pendingDeleteId = id;
            document.getElementById('confirmText').textContent = '确定要删除这条笔记吗？';
            document.getElementById('confirmDialog').classList.add('open');
            document.getElementById('confirmOverlay').classList.add('open');
            closeAllNoteMenus();   // 先关菜单，避免 z-index 干扰
            document.getElementById('confirmOkBtn').onclick = function() {
                for (var i = 0; i < notes.length; i++) {
                    if (notes[i].id === pendingDeleteId) {
                        var content = notes[i].content;
                        if (content.indexOf('--isHTML ') === 0) {
                            content = content.substring(9);
                            var imgRegex = /<img[^>]*data-image-id="([^"]*)"[^>]*>/g;
                            var match;
                            while ((match = imgRegex.exec(content)) !== null) {
                                var imageId = match[1];
                                if (imageId) ImageService.deleteImage(imageId);
                            }
                        }
                        if (typeof AndroidFile !== 'undefined') {
                            AndroidFile.deleteImagesForNote(pendingDeleteId);
                        }
                        notes.splice(i, 1);
                        break;
                    }
                }
                persistNotes();
                updateSidebarStats();
                renderHeatmap();
                renderNotes(currentTagFilter);
                showToast('笔记已删除');
                closeConfirm();
            };
        }

        function closeConfirm() {
            document.getElementById('confirmDialog').classList.remove('open');
            document.getElementById('confirmOverlay').classList.remove('open');
            pendingDeleteId = null;
        }

        function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('open');
            document.getElementById('sidebarOverlay').classList.toggle('open');
        }

        function closeSidebar() {
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('open');
        }

        function createTagDropdown() {
            if (document.getElementById('headerTagDropdown')) return;
            var dd = document.createElement('div');
            dd.className = 'header-tag-dropdown';
            dd.id = 'headerTagDropdown';
            dd.innerHTML = '<div class="header-tag-dropdown-btn" onclick="toggleTagDropdown()"><span id="selectedTagName">全部</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div><div class="header-tag-dropdown-menu" id="headerTagDropdownMenu"><div class="header-tag-dropdown-item" onclick="selectHeaderTag(\'全部\')">全部</div><div class="header-tag-dropdown-item header-tag-manage" onclick="showToast(\'标签管理\')">标签管理</div></div>';
            document.getElementById('appHeader').insertBefore(dd, document.querySelector('.search-icon'));
        }

        function toggleTagDropdown() {
            if (!document.getElementById('notesPage').classList.contains('active')) return;
            var dropdown = document.getElementById('headerTagDropdownMenu');
            dropdown.classList.toggle('open');
            if (dropdown.classList.contains('open')) {
                renderTagDropdown();
            }
        }

        function renderTagDropdown() {
            if (!document.getElementById('notesPage').classList.contains('active')) return;
            var tagSet = new Set();
            notes.forEach(function(note) {
                var tags = note.content.match(/#([^\s]+)/g) || [];
                tags.forEach(function(t) { tagSet.add(t.substring(1)); });
            });

            var container = document.getElementById('headerTagDropdownMenu');
            var html = '<div class="header-tag-dropdown-item" onclick="selectHeaderTag(\'全部\')">全部</div>';
            tagSet.forEach(function(tag) {
                html += '<div class="header-tag-dropdown-item" onclick="selectHeaderTag(\'' + tag + '\')">#' + tag + '</div>';
            });
            html += '<div class="header-tag-dropdown-item header-tag-manage" onclick="showToast(\'标签管理\')">标签管理</div>';
            container.innerHTML = html;
        }

        function selectHeaderTag(tag) {
            document.getElementById('headerTagDropdownMenu').classList.remove('open');
            var cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
            document.getElementById('selectedTagName').textContent = tag === '全部' ? '全部' : '#' + cleanTag;
            currentTagFilter = tag === '全部' ? null : cleanTag;
            renderNotes(currentTagFilter);
        }

        function createSearchElements() {
            if (document.querySelector('.search-icon')) return;
            var icon = document.createElement('div');
            icon.className = 'header-icon search-icon';
            icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
            icon.onclick = openSearch;
            var mailIcon = document.querySelector('.header-icon[onclick*="openMailbox"]');
            document.getElementById('appHeader').insertBefore(icon, mailIcon);

            var container = document.createElement('div');
            container.className = 'search-container';
            container.id = 'searchContainer';
            container.innerHTML = '<div class="search-input-wrapper"><svg class="search-icon-prefix" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" class="search-input" id="searchInput" placeholder="搜索笔记..." oninput="searchNotes()"><div class="search-clear" id="searchClear" onclick="clearSearch()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div><span class="search-cancel" onclick="closeSearch()">取消</span>';
            document.getElementById('appContent').parentNode.insertBefore(container, document.getElementById('appContent'));
        }

        function openSearch() {
            document.getElementById('searchContainer').classList.add('open');
            setTimeout(function() {
                document.getElementById('searchInput').focus();
            }, 100);
        }

        function closeSearch() {
            document.getElementById('searchContainer').classList.remove('open');
            document.getElementById('searchInput').value = '';
            document.getElementById('searchClear').classList.remove('show');
            renderNotes(currentTagFilter);
        }

        function clearSearch() {
            document.getElementById('searchInput').value = '';
            document.getElementById('searchClear').classList.remove('show');
            renderNotes(currentTagFilter);
        }

        function searchNotes() {
            var query = document.getElementById('searchInput').value.toLowerCase();
            var clearBtn = document.getElementById('searchClear');
            clearBtn.classList.toggle('show', query.length > 0);

            if (!query) {
                renderNotes(currentTagFilter);
                return;
            }

            var filtered = notes.filter(function(note) {
                return note.content.toLowerCase().includes(query);
            });

            var container = document.getElementById('notesList');
            if (filtered.length === 0) {
                container.innerHTML = '<div class="empty-hint">没有找到相关笔记</div>';
            } else {
                container.innerHTML = filtered.map(function(note) {
                    var date = new Date(note.createdAt);
                    var dateStr = (date.getMonth() + 1) + '月' + date.getDate() + '日 ' +
                        date.getHours().toString().padStart(2, '0') + ':' +
                        date.getMinutes().toString().padStart(2, '0');
                    var html = note.content;
                    html = html.replace(/#([^\s]+)/g, '<span class="tag-inline">#$1</span>');

                    return '<div class="note-card-wrapper">' +
                        '<div class="note-card" onclick="toggleNoteExpand(this)">' +
                            '<div class="note-meta">' +
                                '<span class="note-date">' + dateStr + '</span>' +
                            '</div>' +
                            '<div class="note-text note-text-collapsed">' + html + '</div>' +
                        '</div>' +
                    '</div>';
                }).join('');
            }
        }

        function openExplore() {
            document.getElementById('explorePanel').classList.add('open');
            document.getElementById('exploreOverlay').classList.add('open');
        }

        function closeExplore() {
            document.getElementById('explorePanel').classList.remove('open');
            document.getElementById('exploreOverlay').classList.remove('open');
        }

        function handleNianInput(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendNianMessage();
            }
        }

        function autoGrowInput(el) {
            el.style.height = '';
            el.style.height = el.scrollHeight + 'px';
        }

        function sendSuggestion(text) {
            document.getElementById('nianChatInput').value = text;
            sendNianMessage(text);
        }

        function sendNianMessage(message) {
            if (!message) {
                var input = document.getElementById('nianChatInput');
                message = input.value.trim();
            }
            if (!message) return;

            // 帮我记: direct handling
            if (message.indexOf('#帮我记') === 0) {
                var content = message.replace('#帮我记', '').trim();
                if (content) {
                    if (typeof window.__agentCreateNote === 'function') {
                        window.__agentCreateNote(content + '\n\n#小满记');
                    } else {
                        var note = { id: "note_" + Date.now(), content: content + '\n\n#小满记', createdAt: new Date().toISOString() };
                        notes.unshift(note);
                        persistNotes();
                        updateSidebarStats();
                        renderHeatmap();
                    }
                    var mc = document.getElementById('nianChatMessages');
                    var m = document.createElement('div');
                    m.className = 'nian-message assistant';
                    m.innerHTML = '<div class="nian-message-text">已记住！📝</div>';
                    mc.appendChild(m);
                    scrollToBottom();
                }
                document.getElementById('nianChatInput').value = '';
                return;
            }

            // 引用笔记: append referenced note as context
            if (referencedNote) {
                var refContent = plainNoteText(referencedNote.content).trim();
                message = message + '\n\n[引用笔记]\n' + refContent;
                clearNoteReference();
            }

            var messagesContainer = document.getElementById('nianChatMessages');

            // save user message to conversation history
            var conv = getCurrentConv();
            if (conv) {
                conv.messages.push({ role: 'user', content: message });
                conv.updatedAt = new Date().toISOString();
                // auto-title
                if (conv.messages.length <= 3 && conv.title === '新的对话') {
                    var firstMsg = '';
                    for (var mi = 0; mi < conv.messages.length; mi++) {
                        if (conv.messages[mi].role === 'user') {
                            // 标题只取用户真正说的话，剥掉尾巴上的引用笔记正文
                            firstMsg = splitRefNote(conv.messages[mi].content || '').text;
                            break;
                        }
                    }
                    firstMsg = (firstMsg || '').replace(/\s+/g, ' ').trim();
                    if (firstMsg.length > 20) firstMsg = firstMsg.substring(0, 20) + '...';
                    if (firstMsg) conv.title = firstMsg;
                }
                saveConversations();
            }

            var userMsg = document.createElement('div');
            userMsg.className = 'nian-message user';
            renderUserMessageEl(userMsg, message);
            messagesContainer.appendChild(userMsg);

            document.getElementById('nianChatInput').value = '';
            var ta = document.getElementById('nianChatInput');
            ta.style.height = '';
            ta.style.height = ta.scrollHeight + 'px';
            scrollToBottom();

            // Agent 路径（有 skills 注册时）——串行队列，防止并发错乱
            if (nianAgent && nianAgent.skills && Object.keys(nianAgent.skills).length > 0) {
                enqueueAgentMessage(message);
                return;
            }

            // 原路径（无 Agent/Skills 时）
            nianMessages.push({ role: 'user', content: message });

            var config = null;
            try { config = DataService.settings.load(); } catch(e) {}

            if (config && config.apiUrl && config.apiKey) {
                callAIAPI(message, config);
            } else {
                var typingId = showTypingIndicator();
                setTimeout(function() {
                    hideTypingIndicator(typingId);
                    var assistantMsg = document.createElement('div');
                    assistantMsg.className = 'nian-message assistant';
                    assistantMsg.innerHTML = '<div class="nian-message-text">请先在「设置 → AI 设置」中配置 API 地址和密钥，即可开启 AI 对话。</div>';
                    messagesContainer.appendChild(assistantMsg);
                    scrollToBottom();
                }, 800);
            }
        }
        // ─── Agent 对话串行队列：防止并发请求导致上下文错乱 ───
        var agentBusy = false;
        var agentQueue = [];

        function enqueueAgentMessage(message) {
            agentQueue.push(message);
            pumpAgentQueue();
        }

        function pumpAgentQueue() {
            if (agentBusy || agentQueue.length === 0 || !nianAgent) return;
            agentBusy = true;
            var message = agentQueue.shift();
            sendViaAgent(message).then(function() {
                agentBusy = false;
                pumpAgentQueue();
            }, function() {
                agentBusy = false;
                pumpAgentQueue();
            });
        }

        function sendViaAgent(message) {
            var messagesContainer = document.getElementById('nianChatMessages');
            var typingId = showTypingIndicator();

            // 执行过程步骤条（工具调用可见）
            var stepsEl = null;
            function ensureStepsEl() {
                if (stepsEl) return stepsEl;
                stepsEl = document.createElement('div');
                stepsEl.className = 'agent-steps';
                stepsEl.style.cssText = 'margin:6px 0 2px;padding:6px 10px;background:rgba(232,93,4,0.05);border-radius:10px;font-size:12px;color:#8a5a33;line-height:1.7;font-family:\'Noto Sans SC\',sans-serif';
                messagesContainer.appendChild(stepsEl);
                scrollToBottom();
                return stepsEl;
            }
            function addStepRow(icon, text, statusText) {
                var el = ensureStepsEl();
                var row = document.createElement('div');
                row.innerHTML = '<span style="margin-right:6px">' + icon + '</span><span>' + text + '</span>' + (statusText ? '<span style="margin-left:6px;color:#999">' + statusText + '</span>' : '');
                el.appendChild(row);
                scrollToBottom();
                return row;
            }

            // 若 agent 上下文为空但当前对话有历史（刷新/切换后），先限长重建（含摘要），避免失忆
            var conv = getCurrentConv();
            if (nianAgent && nianAgent.messages && nianAgent.messages.length === 0 && conv && conv.messages && conv.messages.length > 0) {
                nianAgent.setHistory(conv.messages, conv.summary);
            }

            var beforeSummaryCount = nianAgent ? (nianAgent.summaryCount || 0) : 0;

            // 执行过程事件 → 步骤条
            nianAgent.onStep = function(step) {
                try {
                    if (step.type === 'tool_call') {
                        ensureStepsEl();
                        addStepRow('⚙️', escapeHtml(step.name), '执行中…');
                    } else if (step.type === 'tool_result') {
                        var rows = stepsEl ? stepsEl.querySelectorAll('div') : [];
                        var row = rows[rows.length - 1];
                        if (row) {
                            var mark = step.ok ? '✓' : '✗';
                            var color = step.ok ? '#2e7d32' : '#c0392b';
                            row.innerHTML = '<span style="margin-right:6px">' + mark + '</span><span>' + escapeHtml(step.name) + '</span>' +
                                '<span style="margin-left:6px;color:' + color + '">' + (step.ok ? '成功' : '失败') + '</span>' +
                                '<div style="color:#999;margin-top:2px;word-break:break-all">' + escapeHtml(step.summary || '') + '</div>';
                        }
                    } else if (step.type === 'summary') {
                        addStepRow('🧠', '更早的对话已总结', '');
                    } else if (step.type === 'llm_retry') {
                        addStepRow('🔄', '网络波动，自动重试…', '');
                    }
                } catch(e) {}
            };

            // 本轮执行日志 → Win 后台
            nianAgent.onLog = function(log) {
                log.convId = currentConvId;
                sendTelemetry(log);
            };

            var systemPrompt = buildNianSystemPrompt(message);

            // RAG：把「用户此刻说的话」向量化，唤起相关回忆注入（失败静默回退，已注入的回忆段兜底）
            var promptReady = Promise.resolve(systemPrompt);
            if (typeof MemoryService !== 'undefined' && typeof MemoryService.retrieveMoments === 'function') {
                promptReady = MemoryService.retrieveMoments(message, 4, systemPrompt).then(function(ragText) {
                    return ragText ? systemPrompt + ragText : systemPrompt;
                });
            }
            return promptReady.then(function(finalPrompt) {
                return nianAgent.process(message, finalPrompt);
            }).then(function(text) {
                hideTypingIndicator(typingId);

                // 小满回复中提到了某段回忆 → 记一次提起（防炒冷饭）
                markRecalledMoments(text);
                // 自动静默更新：从本轮对话中提取值得记住的时刻（节流）
                silentExtractFromChat(message, text);

                // save assistant message to conversation history
                var conv = getCurrentConv();
                if (conv) {
                    conv.messages.push({ role: 'assistant', content: text });
                    conv.updatedAt = new Date().toISOString();
                    // 持久化对话摘要，刷新/切对话后仍可恢复
                    if (nianAgent && typeof nianAgent.summary === 'string' && nianAgent.summary) {
                        conv.summary = nianAgent.summary;
                    }
                    saveConversations();
                }

                // 本轮发生了历史总结 → 给用户一点反馈
                if (nianAgent && (nianAgent.summaryCount || 0) > beforeSummaryCount) {
                    showToast('更早的对话已总结压缩，继续聊吧');
                }

                // 让 renderThinkContent 处理 <think> 标签
                var assistantMsg = document.createElement('div');
                assistantMsg.className = 'nian-message assistant';
                assistantMsg.innerHTML = '<div class="nian-message-text">' + renderThinkContent(text) + '</div>';
                messagesContainer.appendChild(assistantMsg);
                scrollToBottom();
            }).catch(function(err) {
                hideTypingIndicator(typingId);
                var assistantMsg = document.createElement('div');
                assistantMsg.className = 'nian-message assistant';
                assistantMsg.innerHTML = '<div class="nian-message-text">' + escapeHtml(NativeHttp.explainError(err)) + '</div>';
                messagesContainer.appendChild(assistantMsg);
                scrollToBottom();
            });
        }
        function appendMessage(text, isUser) {
            var messagesContainer = document.getElementById('nianChatMessages');
            var msg = document.createElement('div');
            msg.className = 'nian-message ' + (isUser ? 'user' : 'assistant');
            msg.innerHTML = '<div class="nian-message-text">' + escapeHtml(text) + '</div>';
            messagesContainer.appendChild(msg);
            scrollToBottom();
        }

        function callAIAPI(message, config) {
            var messagesContainer = document.getElementById('nianChatMessages');

            var typingId = showTypingIndicator();

            var systemPrompt = buildNianSystemPrompt(message);

            var url = NativeHttp.chatEndpoint(config.apiUrl);

            var assistantMsg = document.createElement('div');
            assistantMsg.className = 'nian-message assistant';
            assistantMsg.innerHTML = '<div class="nian-message-text"></div>';

            hideTypingIndicator(typingId);
            messagesContainer.appendChild(assistantMsg);
            scrollToBottom();

            var textEl = assistantMsg.querySelector('.nian-message-text');
            var fullText = '';

            var apiMessages = [{ role: 'system', content: systemPrompt }];
            // keep last 20 messages to stay within context window
            var recent = nianMessages.slice(-20);
            for (var mi = 0; mi < recent.length; mi++) {
                apiMessages.push(recent[mi]);
            }

            var payload = {
                model: config.model,
                messages: apiMessages,
                max_tokens: 500,
                temperature: 0.7
            };

            // Android 端：原生桥不支持流式，改用一次性请求；浏览器端：保留流式输出
            if (typeof NativeHttp !== 'undefined' && typeof AndroidHttp !== 'undefined') {
                NativeHttp.postJson(url, { Authorization: 'Bearer ' + config.apiKey }, payload)
                .then(function(data) {
                    var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                    if (!text) throw new Error('AI 返回为空');
                    textEl.innerHTML = renderThinkContent(text);
                    var clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                    if (clean) {
                        nianMessages.push({ role: 'assistant', content: clean });
                    }
                    scrollToBottom();
                })
                .catch(function(err) {
                    textEl.innerHTML = escapeHtml(NativeHttp.explainError(err, url));
                    scrollToBottom();
                });
                return;
            }

            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + config.apiKey
                },
                body: JSON.stringify(payload)
            })
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';

                function readChunk() {
                    reader.read().then(function(result) {
                        if (result.done) {
                            textEl.innerHTML = renderThinkContent(fullText);
                            var clean = fullText.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                            if (clean) {
                                nianMessages.push({ role: 'assistant', content: clean });
                            }
                            scrollToBottom();
                            return;
                        }
                        var chunk = decoder.decode(result.value, {stream: true});
                        buffer += chunk;
                        var lines = buffer.split('\n');
                        buffer = lines.pop();
                        for (var i = 0; i < lines.length; i++) {
                            var line = lines[i].trim();
                            if (line.startsWith('data: ')) {
                                var data = line.substring(6);
                                if (data === '[DONE]') continue;
                                try {
                                    var parsed = JSON.parse(data);
                                    var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
                                    if (delta) {
                                        fullText += delta;
                                        textEl.innerHTML = renderThinkContent(fullText);
                                        scrollToBottom();
                                    }
                                } catch(e) {}
                            }
                        }
                        readChunk();
                    });
                }
                readChunk();
            })
            .catch(function(err) {
                textEl.innerHTML = escapeHtml(NativeHttp.explainError(err, url));
                scrollToBottom();
            });
        }

        function renderThinkContent(text) {
            var result = '';
            var lastIndex = 0;
            var regex = /<think>([\s\S]*?)<\/think>/g;
            var match;
            while ((match = regex.exec(text)) !== null) {
                result += renderMarkdown(text.substring(lastIndex, match.index));
                result += '<div class="think-block"><div class="think-toggle" onclick="toggleThink(this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>思考过程</div><div class="think-content">' + renderMarkdown(match[1]) + '</div></div>';
                lastIndex = match.index + match[0].length;
            }
            result += renderMarkdown(text.substring(lastIndex));
            return result;
        }

        function toggleThink(el) {
            el.classList.toggle('open');
            var content = el.nextElementSibling;
            if (content) content.classList.toggle('open');
        }

        function showTypingIndicator(isInsight) {
            var messagesContainer = document.getElementById('nianChatMessages');
            var id = 'typing-' + Date.now();
            var typingMsg = document.createElement('div');
            typingMsg.className = 'nian-message assistant nian-message-typing';
            typingMsg.id = id;
            // 洞察场景：不用打字点动画，显示纯文字"分析中"，避免误导为"思考"
            if (isInsight) {
                typingMsg.innerHTML = '<div class="nian-message-text" style="color:var(--text-muted);font-size:13px">AI 分析中…</div>';
            } else {
                typingMsg.innerHTML = '<div class="nian-message-text">' +
                    '<div class="nian-message-typing-dot"></div>' +
                    '<div class="nian-message-typing-dot"></div>' +
                    '<div class="nian-message-typing-dot"></div>' +
                '</div>';
            }
            messagesContainer.appendChild(typingMsg);
            scrollToBottom();
            return id;
        }

        function hideTypingIndicator(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        }

        function scrollToBottom() {
            var container = document.getElementById('nianChatMessages');
            container.scrollTop = container.scrollHeight;
        }

        function escapeHtml(text) {
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function renderMarkdown(text) {
            if (!text) return '';
            var html = escapeHtml(text);

            // 围栏代码块
            html = html.replace(/```(\w*)\r?\n([\s\S]*?)```/g, function(m, lang, code) {
                return '<pre><code>' + code.trim() + '</code></pre>';
            });

            // 行内代码
            html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

            // 标题
            html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
            html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
            html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

            // 分割线
            html = html.replace(/^(---|\*\*\*)$/gm, '<hr>');

            // 引用块（匹配转义后的 &gt;）
            html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

            // 加粗
            html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

            // 斜体
            html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

            // 链接
            html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(m, text, url) {
                if (/^javascript:/i.test(url)) return m;
                return '<a href="' + url + '" target="_blank" rel="noopener">' + text + '</a>';
            });

            // 图片
            html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
                '<img src="$2" alt="$1" loading="lazy">');

            // 无序列表
            html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
            html = html.replace(/(<li>.*<\/li>\n?)+/g, function(m) {
                return '<ul>' + m + '</ul>';
            });

            // 有序列表
            html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
            html = html.replace(/(?:<li>.*<\/li>\n?)+/g, function(m, offset, str) {
                var prefix = str.substring(0, offset);
                var ulOpens = (prefix.match(/<ul>/g) || []).length;
                var ulCloses = (prefix.match(/<\/ul>/g) || []).length;
                if (ulOpens > ulCloses) return m;
                return '<ol>' + m + '</ol>';
            });

            html = html.replace(/<li><\/li>/g, '');

            // 段落包裹
            var paragraphs = html.split(/\n\n+/);
            html = paragraphs.map(function(p) {
                p = p.trim();
                if (!p) return '';
                if (p.match(/^<(h[123]|ul|ol|pre|blockquote|hr)/)) return p;
                if (p.match(/^<li/)) return p;
                p = p.replace(/\n/g, '<br>');
                return '<p>' + p + '</p>';
            }).join('');

            return html;
        }

        function toggleFab() {
            var fab = document.getElementById('fab');
            var fabLeft = document.getElementById('fabLeft');
            var fabRight = document.getElementById('fabRight');
            fab.classList.toggle('open');
            fabLeft.classList.toggle('open');
            fabRight.classList.toggle('open');
        }

        function closeFab() {
            document.getElementById('fab').classList.remove('open');
            document.getElementById('fabLeft').classList.remove('open');
            document.getElementById('fabRight').classList.remove('open');
        }

        var editingNoteIndex = -1;

        function editNote(noteId) {
            closeAllNoteMenus();
            document.querySelectorAll('.note-card-wrapper.note-selected').forEach(function(w) {
                w.classList.remove('note-selected');
            });
            for (var i = 0; i < notes.length; i++) {
                if (notes[i].id === noteId) {
                    openEditor(i);
                    return;
                }
            }
        }

        function openEditor(index) {
            closeFab();
            closeSidebar();
            editorImages = [];
            document.getElementById('editorOverlay').classList.add('open');
            document.getElementById('editor').classList.add('open');
            if (index >= 0) {
                editingNoteIndex = index;
                document.getElementById('editorTitle').textContent = '编辑笔记';
                var content = notes[index].content;
                if (content.indexOf('--isHTML ') === 0) {
                    content = content.substring(9);
                    var imgRegex = /<img[^>]*src="([^"]*)"[^>]*>/g;
                    var match;
                    while ((match = imgRegex.exec(content)) !== null) {
                        var src = match[1];
                        var imageId = '';
                        var idMatch = match[0].match(/data-image-id="([^"]*)"/);
                        if (idMatch) imageId = idMatch[1];

                        if (src.startsWith('file://')) {
                            editorImages.push({ id: imageId, path: src.replace('file://', ''), base64: '' });
                        } else {
                            editorImages.push({ id: imageId, path: '', base64: src });
                        }
                    }
                    content = content.replace(/<img[^>]*>/g, '').replace(/<br><br>/g, '<br>').replace(/<br>$/, '').trim();
                    content = content.replace(/<div><br><\/div>/g, '').replace(/^<br>/, '').replace(/<br>$/, '');
                } else {
                    var imgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
                    var match;
                    while ((match = imgRegex.exec(content)) !== null) {
                        var src = match[1];
                        var imageId = '';
                        if (src.startsWith('file://')) {
                            editorImages.push({ id: imageId, path: src.replace('file://', ''), base64: '' });
                        } else {
                            editorImages.push({ id: imageId, path: '', base64: src });
                        }
                    }
                    content = content.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\n\n+/g, '\n').trim();
                    content = content ? content.replace(/\n/g, '<br>') : '';
                }
                document.getElementById('noteContent').innerHTML = content;
                updateDisplay();
            } else {
                editingNoteIndex = -1;
                document.getElementById('editorTitle').textContent = '新笔记';
                document.getElementById('noteContent').innerHTML = '';
            }
            adjustEditorForKeyboard();
            setTimeout(function() {
                document.getElementById('noteContent').focus();
            }, 100);
            setTimeout(function() {
                adjustEditorForKeyboard();
            }, 350);
        }

        function closeEditor() {
            document.getElementById('editor').classList.remove('open');
            document.getElementById('editorOverlay').classList.remove('open');
            document.getElementById('noteContent').innerHTML = '';
            editingNoteIndex = -1;
            document.getElementById('editor').style.height = '';
            document.getElementById('editor').style.bottom = '';
            document.getElementById('editor').style.maxHeight = '';
            boldActive = false;
            underlineActive = false;
            editorImages = [];
            document.getElementById('tbBold').classList.remove('active');
            document.getElementById('tbUnderline').classList.remove('active');
        }

        function adjustEditorForKeyboard() {
            var editor = document.getElementById('editor');
            if (!editor.classList.contains('open')) return;
            var keyboardH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0;
            var topSafe = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top')) || 0;
            var vh = window.innerHeight;
            var minH = vh * 0.25;
            var maxH = vh - keyboardH - topSafe;

            if (keyboardH > 0) {
                editor.style.bottom = keyboardH + 'px';
            } else {
                editor.style.bottom = '';
            }

            var textarea = document.getElementById('noteContent');
            var currentH = parseFloat(editor.style.height) || minH;
            var lineH = 28.8;

            var strip = document.getElementById('editorImageStrip');
            var stripH = strip.children.length > 0 ? strip.offsetHeight : 0;
            var prevStripH = parseFloat(editor.getAttribute('data-strip-h')) || 0;
            currentH = currentH - prevStripH + stripH;
            editor.setAttribute('data-strip-h', stripH);

            if (textarea.scrollHeight > textarea.clientHeight + 4 && currentH < maxH) {
                currentH += lineH;
            }
            if (currentH < minH) currentH = minH;
            if (currentH > maxH) currentH = maxH;

            editor.style.height = currentH + 'px';
            editor.style.maxHeight = (maxH + stripH) + 'px';
        }

        function updateImageStrip() {
            var strip = document.getElementById('editorImageStrip');
            if (!editorImages.length) {
                strip.innerHTML = '';
                return;
            }
            var html = '';
            for (var i = 0; i < editorImages.length; i++) {
                var img = editorImages[i];
                var src = img.base64 || '';
                var loadingHtml = img.loading ? '<div style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;background:#f0f0f0;"><span style="color:#999;font-size:11px;">处理中...</span></div>' : '';
                html += '<div class="editor-image-item">' +
                    (src ? '<img src="' + src + '">' : '') +
                    loadingHtml +
                    '<div class="editor-image-del" onclick="event.stopPropagation();removeEditorImage(' + i + ')">✕</div>' +
                    '</div>';
            }
            strip.innerHTML = html;
        }

        function removeEditorImage(index) {
            editorImages.splice(index, 1);
            updateImageStrip();
            adjustEditorForKeyboard();
        }

        function getCaretOffset(el) {
            var sel = window.getSelection();
            if (sel.rangeCount === 0) return 0;
            var range = sel.getRangeAt(0);
            var preRange = range.cloneRange();
            preRange.selectNodeContents(el);
            preRange.setEnd(range.endContainer, range.endOffset);
            return preRange.toString().length;
        }

        function restoreCaret(el, offset) {
            var sel = window.getSelection();
            var range = document.createRange();
            var charIndex = 0;
            var nodeStack = [el];
            var node, found = false;
            while (!found && (node = nodeStack.pop())) {
                if (node.nodeType === 3) {
                    var nextCharIndex = charIndex + node.length;
                    if (offset >= charIndex && offset <= nextCharIndex) {
                        range.setStart(node, offset - charIndex);
                        range.collapse(true);
                        found = true;
                    }
                    charIndex = nextCharIndex;
                } else if (node.nodeType === 1) {
                    if (node.nodeName === 'BR') { charIndex += 1; }
                    else { var i = node.childNodes.length; while (i--) { nodeStack.push(node.childNodes[i]); } }
                }
            }
            if (!found && el.lastChild) { range.setStartAfter(el.lastChild); range.collapse(true); }
            sel.removeAllRanges();
            sel.addRange(range);
        }

        function handleEditorPaste(e) {
            e.preventDefault();
            var text = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, text);
        }

        function updateDisplay() {
            var text = document.getElementById('noteContent').innerText;
            checkTagSuggestions(text);
            updateImageStrip();
            adjustEditorForKeyboard();
        }

        function getExistingTags() {
            var allTags = [];
            notes.forEach(function(n) {
                var content = n.content;
                if (content.indexOf('--isHTML ') === 0) content = content.substring(9);
                var matches = content.match(/#([^\s<]+)/g) || [];
                matches.forEach(function(m) {
                    var tagName = m.substring(1);
                    if (allTags.indexOf(tagName) === -1) allTags.push(tagName);
                });
            });
            return allTags;
        }

        function insertHashAndSuggest() {
            var el = document.getElementById('noteContent');
            el.focus();
            document.execCommand('insertText', false, '#');
            updateDisplay();
        }

        function checkTagSuggestions(text) {
            var tagSuggestionsEl = document.getElementById('tagSuggestions');
            var lastHash = text.lastIndexOf('#');
            if (lastHash === -1) { tagSuggestionsEl.classList.remove('show'); return; }
            var afterHash = text.substring(lastHash + 1);
            if (afterHash.includes(' ') || afterHash.includes('\n')) { tagSuggestionsEl.classList.remove('show'); return; }
            var existingTags = getExistingTags();

            if (afterHash.length === 0) {
                if (existingTags.length > 0) {
                    tagSuggestionsEl.innerHTML = existingTags.map(function(t) {
                        return '<div class="tag-suggestion-item" onclick="insertTag(\'' + t + '\')">' + t + '</div>';
                    }).join('');
                    tagSuggestionsEl.classList.add('show');
                } else {
                    tagSuggestionsEl.classList.remove('show');
                }
                return;
            }

            var filtered = existingTags.filter(function(t) { return t.toLowerCase().startsWith(afterHash.toLowerCase()); });
            if (filtered.length === 0 && afterHash.length > 0) {
                tagSuggestionsEl.innerHTML = '<div class="tag-suggestion-item new-tag" onclick="createNewTag(\'' + afterHash + '\')">创建 "' + afterHash + '"</div>';
                tagSuggestionsEl.classList.add('show');
            } else if (filtered.length > 0) {
                tagSuggestionsEl.innerHTML = filtered.map(function(t) {
                    return '<div class="tag-suggestion-item" onclick="insertTag(\'' + t + '\')">' + t + '</div>';
                }).join('');
                tagSuggestionsEl.classList.add('show');
            } else {
                tagSuggestionsEl.classList.remove('show');
            }
        }

        function insertTag(tag) {
            var el = document.getElementById('noteContent');
            var text = el.innerText;
            var offset = getCaretOffset(el);
            var lastHash = text.substring(0, offset).lastIndexOf('#');
            if (lastHash === -1) return;
            var newText = text.substring(0, lastHash) + '#' + tag + ' ' + text.substring(offset);
            var newOffset = lastHash + 1 + tag.length + 1;
            el.innerHTML = newText.replace(/\n/g, '<br>');
            restoreCaret(el, newOffset);
            el.focus();
            document.getElementById('tagSuggestions').classList.remove('show');
        }

        function createNewTag(tag) { insertTag(tag); }

        var boldActive = false;
        var underlineActive = false;
        var editorImages = [];

        function insertFormat(type) {
            var el = document.getElementById('noteContent');
            el.focus();
            if (type === 'ul') document.execCommand('insertUnorderedList');
            else if (type === 'ol') document.execCommand('insertOrderedList');
            updateDisplay();
        }

        function toggleBold() {
            document.execCommand('bold');
            var btn = document.getElementById('tbBold');
            boldActive = !boldActive;
            if (boldActive) btn.classList.add('active'); else btn.classList.remove('active');
            document.getElementById('noteContent').focus();
            updateDisplay();
        }

        function toggleUnderline() {
            document.execCommand('underline');
            var btn = document.getElementById('tbUnderline');
            underlineActive = !underlineActive;
            if (underlineActive) btn.classList.add('active'); else btn.classList.remove('active');
            document.getElementById('noteContent').focus();
            updateDisplay();
        }

        function handleEditorListKey(e) {
            if (e.key === 'Enter' && !e.shiftKey && (document.queryCommandState('insertUnorderedList') || document.queryCommandState('insertOrderedList'))) {
                setTimeout(function() { updateDisplay(); }, 10);
            }
        }

        function compressImage(file, maxSize, quality) {
            maxSize = maxSize || 1280;
            quality = quality || 0.7;
            return new Promise(function(resolve) {
                var reader = new FileReader();
                reader.onload = function(ev) {
                    var img = new Image();
                    img.onload = function() {
                        var w = img.width, h = img.height;
                        if (w > maxSize || h > maxSize) {
                            if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                            else { w = Math.round(w * maxSize / h); h = maxSize; }
                        }
                        var canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        var ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, w, h);
                        resolve(canvas.toDataURL('image/jpeg', quality));
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            });
        }

        function handleImagePick(e) {
            var files = e.target.files;
            if (!files.length) return;
            if (files.length + editorImages.length > 9) { showToast('最多选择9张图片'); e.target.value = ''; return; }
            var total = files.length;
            for (var i = 0; i < files.length; i++) {
                (function(file) {
                    var imageId = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                    editorImages.push({
                        id: imageId,
                        base64: '',
                        path: '',
                        loading: true
                    });
                    var newIndex = editorImages.length - 1;
                    updateImageStrip();
                    compressImage(file, 1280, 0.7).then(function(compressed) {
                        editorImages[newIndex].base64 = compressed;
                        editorImages[newIndex].loading = false;
                        updateImageStrip();
                        adjustEditorForKeyboard();
                    });
                })(files[i]);
            }
            e.target.value = '';
        }

        function saveNote() {
            var editorEl = document.getElementById('noteContent');
            var content = editorEl.innerHTML.trim();
            if (!content && !editorImages.length) {
                alert('请输入内容');
                return;
            }
            // 时间戳 + 随机后缀，避免同毫秒保存覆盖
            var noteId = editingNoteIndex >= 0 ? notes[editingNoteIndex].id : ('note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
            var contentEl = document.getElementById('noteContent');
            if (editorImages.length) {
                content = content.replace(/<br\s*\/?>$/i, '').replace(/\n$/, '').trim();

                // 已存在（编辑旧图，id 已记录且 base64 是 URL/空）的图片不重新上传，
                // 只上传真正的新 base64 图，避免每次编辑产生垃圾解码和重复文件
                var toUpload = [];
                var indexMap = [];
                for (var ui = 0; ui < editorImages.length; ui++) {
                    var im = editorImages[ui];
                    if (im.base64 && im.base64.indexOf('data:image') === 0) {
                        toUpload.push(im.base64);
                        indexMap.push(ui);
                    } else {
                        // 无新数据：保留原 id（旧图继续用原文件）
                        editorImages[ui].base64 = '';
                    }
                }

                if (toUpload.length === 0) {
                    var keepHtml = editorImages.map(function(img) {
                        var src = '';
                        if (img.id && (typeof AndroidImage !== 'undefined')) {
                            src = 'https://appassets.androidplatform.net/images/' + img.id + '.jpg';
                        } else if (img.base64) {
                            src = img.base64;
                        }
                        return '<img src="' + src + '" alt="image" onclick="openImagePreview(\'' + img.id + '\')" onerror="onImageLoadError(this)" style="max-width:100%;border-radius:8px;margin:2px 1px;cursor:pointer" data-image-id="' + img.id + '">';
                    }).join('');
                    content = '--isHTML ' + content + keepHtml;
                    finishSaveNote(content, noteId);
                    return;
                }

                ImageService.saveImages(
                    toUpload,
                    noteId
                ).then(function(results) {
                    results.forEach(function(result, idx) {
                        if (result.id) {
                            var target = indexMap[idx];
                            if (target !== undefined && target < editorImages.length) {
                                editorImages[target].id = result.id;
                                editorImages[target].path = result.path;
                            }
                        }
                    });
                    var imagesHtml = editorImages.map(function(img) {
                        // WebView 端：https://appassets.androidplatform.net/images/{id}.jpg
                        //   → MainActivity.WebViewAssetLoader.InternalStoragePathHandler 拦截
                        //   → 从 filesDir/images/{id}.jpg 流式返回
                        // 浏览器端：浏览器无 WebViewAssetLoader → fallback 到 base64
                        var src = '';
                        if (img.id && (typeof AndroidImage !== 'undefined')) {
                            src = 'https://appassets.androidplatform.net/images/' + img.id + '.jpg';
                        } else if (img.base64) {
                            src = img.base64;
                        }
                        return '<img src="' + src + '" alt="image" onclick="openImagePreview(\'' + img.id + '\')" onerror="onImageLoadError(this)" style="max-width:100%;border-radius:8px;margin:2px 1px;cursor:pointer" data-image-id="' + img.id + '">';
                    }).join('');
                    content = '--isHTML ' + content + imagesHtml;

                    finishSaveNote(content, noteId);
                });
            } else {
                finishSaveNote(content, noteId);
            }
        }

        function finishSaveNote(content, noteId) {
            if (editingNoteIndex >= 0) {
                notes[editingNoteIndex].content = content;
                notes[editingNoteIndex].updatedAt = new Date().toISOString();
                persistNotes();
                updateSidebarStats();
                renderHeatmap();
                showToast('笔记已更新');
                closeEditor();
                if (currentPage === 'notes') {
                    renderNotes(currentTagFilter);
                    setTimeout(loadNoteImages, 150);
                }
            } else {
                var note = {
                    id: noteId,
                    content: content,
                    createdAt: new Date().toISOString()
                };
                notes.unshift(note);
                persistNotes();
                updateSidebarStats();
                renderHeatmap();
                showToast('笔记已保存');
                closeEditor();
                if (currentPage === 'notes') {
                    renderNotes(currentTagFilter);
                    setTimeout(loadNoteImages, 150);
                }
            }
            // 异步提取记忆（不阻塞保存流程）
            extractMemoryFromNote(content);
        }

        // 记忆提取节流：两次提取至少间隔 30s，避免快速连续保存笔记时打爆 API
        var lastMemoryExtractAt = 0;

        function extractMemoryFromNote(rawContent) {
            if (typeof AndroidMemory === 'undefined' || !AndroidMemory) return;
            var now = Date.now();
            if (now - lastMemoryExtractAt < 30000) return;
            lastMemoryExtractAt = now;

            var plain = rawContent;
            if (plain.indexOf('--isHTML ') === 0) plain = plain.substring(9);
            plain = plain.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
            if (plain.length < 10) return;

            var config;
            try { config = DataService.settings.load(); } catch(e) {}
            if (!config || !config.apiUrl || !config.apiKey) return;

            var url = NativeHttp.chatEndpoint(config.apiUrl);
            var headers = { Authorization: 'Bearer ' + config.apiKey };

            // Android 走原生桥（无 CORS），浏览器走 XHR
            // v4：提取「时刻」（标题 § 原话 § 情绪），写入 moments 而非事实列表
            NativeHttp.postJson(url, headers, {
                model: config.model || 'gpt-4o',
                messages: [
                    { role: 'system', content: (typeof MemoryService !== 'undefined' && MemoryService.TASK_PROMPTS)
                        ? MemoryService.TASK_PROMPTS.extractSystem
                        : '你是记忆提取助手。从日记中提取值得记住的时刻，每行输出「标题 § 原话(不超过30字) § 情绪」。情绪只能是：开心/平静/期待/感动/焦虑/难过/疲惫/生气/孤单/平常。没有值得记住的时刻则回复"无"。不要输出思考过程。' },
                    { role: 'user', content: '从以下日记中提取时刻：\n\n' + plain }
                ],
                temperature: 0.3,
                max_tokens: 500
            }).then(function(data) {
                var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                if (!text || text.trim().length < 5) return;

                // 解析时刻行 → 写入 moments（统一走 MemoryService：去重 + 上限）
                if (writeMomentsFromExtraction(text)) {
                    // 触发回忆信检查
                    checkDreaming();
                }
            }, function() {
                // 提取失败静默忽略，不影响用户
            });
        }

        // 解析笔记提取结果（标题 § 原话 § 情绪）写入情节记忆（v5 episodes）
        function writeMomentsFromExtraction(text) {
            try {
                if (typeof MemoryService === 'undefined' || typeof MemoryService.addMemory !== 'function') return false;
                var emoMap = { '开心': '开心', '平静': '平静', '期待': '期待', '感动': '开心', '焦虑': '焦虑', '难过': '低落', '疲惫': '疲惫', '生气': '愤怒', '孤单': '低落', '平常': '平静' };
                var added = false;
                var lines = String(text).split(/\r?\n/);
                for (var li = 0; li < lines.length; li++) {
                    var line = lines[li].trim();
                    if (!line || line === '无') continue;
                    if (line.indexOf('§') === -1) continue;
                    var parts = line.split('§');
                    var excerpt = (parts[1] || '').trim();
                    if (!excerpt) continue;
                    var label = (parts[2] || '').trim();
                    var r = MemoryService.addMemory('episode', {
                        title: (parts[0] || '').trim(),
                        summary: excerpt,
                        occurredAt: new Date().toISOString(),
                        emotion: emoMap[label] || '其他',
                        intensity: 0.5,
                        context: '来自笔记',
                        tags: ['笔记'],
                        source: 'note'
                    });
                    if (r && (r.action === 'created' || r.action === 'contextual')) added = true;
                }
                return added;
            } catch(e) { return false; }
        }

        // ─── 自动记忆提取：每轮对话结束后后台提取事实/偏好/情节/语义，冲突进入待确认。
        // 串行队列，避免并发写同一份记忆；失败静默，不打扰对话 ───
        var memoryExtractQueue = [];
        var memoryExtracting = false;

        function silentExtractFromChat(userMessage, assistantText) {
            try {
                if (typeof MemoryEngine === 'undefined' || typeof MemoryService === 'undefined') return;
                if (!userMessage || String(userMessage).trim().length < 2) return;
                var config;
                try { config = DataService.settings.load(); } catch(e) {}
                if (!config || !config.apiUrl || !config.apiKey) return;
                memoryExtractQueue.push({ user: String(userMessage), assistant: String(assistantText || '') });
                pumpMemoryExtract();
            } catch(e) {}
        }

        function pumpMemoryExtract() {
            if (memoryExtracting || !memoryExtractQueue.length || typeof MemoryEngine === 'undefined') return;
            memoryExtracting = true;
            var job = memoryExtractQueue.shift();
            var finish = function() {
                memoryExtracting = false;
                setTimeout(pumpMemoryExtract, 200);
            };
            MemoryEngine.processTurn({ userMessage: job.user, assistantText: job.assistant }).then(function(r) {
                finish();
                if (!r || !r.ok) return;
                var n = r.created.facts + r.created.preferences + r.created.episodes + r.created.semantic;
                if (n > 0 && typeof showToast === 'function') showToast('记住了 ' + n + ' 条关于你的事');
                if (r.questions && r.questions.length) appendMemoryConfirm(r.questions[0]);
                // L2 摘要记忆：每 8 轮对话总结一次
                try {
                    var turnCount = parseInt(localStorage.getItem('nian_mem_turns') || '0', 10) + 1;
                    localStorage.setItem('nian_mem_turns', String(turnCount));
                    if (turnCount % 8 === 0 && typeof MemoryEngine.makeSummary === 'function') {
                        MemoryEngine.makeSummary().then(function(sum) {
                            if (sum && typeof showToast === 'function') showToast('已更新近况摘要');
                        });
                    }
                } catch(e) {}
            }, finish);
        }

        // 冲突确认：以一条温和的追问出现在对话里；用户下一轮回复会被提取引擎识别为 resolution
        function appendMemoryConfirm(question) {
            try {
                var container = document.getElementById('nianChatMessages');
                if (!container || !question) return;
                var msg = document.createElement('div');
                msg.className = 'nian-message assistant memory-confirm';
                msg.innerHTML = '<div class="nian-message-text" style="border-left:3px solid #c9a227;padding-left:10px;color:#8a5a33">' +
                    escapeHtml(question) + '</div>';
                container.appendChild(msg);
                scrollToBottom();
            } catch(e) {}
        }

        // ─── Dreaming: 自动记忆整理 ───
        var isDreamingRunning = false;

        function checkDreaming() {
            try {
                var s = DataService.settings.load() || {};
                var totalNotes = notes.length;
                var lastCount = s.noteCountAtLastDream || 0;
                var lastDreamAt = s.lastDreamAt || 0;
                var newNotes = totalNotes - lastCount;
                var oneWeek = 7 * 24 * 60 * 60 * 1000;

                if (newNotes >= 10) {
                    runDreaming();
                } else if (newNotes >= 3 && (Date.now() - lastDreamAt) >= oneWeek) {
                    runDreaming();
                }
            } catch(e) {}
        }

        function runDreaming() {
            if (isDreamingRunning) return;
            isDreamingRunning = true;

            var done = function(msg) {
                isDreamingRunning = false;
                showToast(msg || '回忆信已完成');
            };

            if (typeof AndroidMemory === 'undefined' || !AndroidMemory) { done(); return; }
            if (typeof MemoryService === 'undefined' || typeof sendProactiveMailSkill === 'undefined') {
                done('记忆系统不可用');
                return;
            }

            // 1) 本地归档超龄时刻（不耗 LLM）
            try {
                var mem = MemoryService.load();
                if (mem && MemoryService.archiveOldMoments(mem)) MemoryService.save(mem);
            } catch(e) {}

            // 2) 取最近情节记忆，LLM 写一封有温度的回忆信（回忆仪式）
            var memForDream = MemoryService.load() || {};
            var dreamEpisodes = (memForDream.episodes || []).filter(function(e) {
                return e && e.status === 'active' && e.summary;
            }).sort(function(a, b) {
                return String(b.occurredAt || b.createdAt) < String(a.occurredAt || a.createdAt) ? -1 : 1;
            }).slice(0, 20);
            if (!dreamEpisodes.length) {
                resetDreamCounter();
                done('还没有值得写信的回忆');
                return;
            }

            var config;
            try { config = DataService.settings.load(); } catch(e) {}
            if (!config || !config.apiUrl || !config.apiKey) { done('请先配置 AI 参数'); return; }

            var lines = dreamEpisodes.map(function(e, idx) {
                var t = MemoryService.relativeTime(e.occurredAt || e.createdAt);
                return (idx + 1) + '. ' + (t ? t + ' ' : '') + (e.emotion ? '（' + e.emotion + '）' : '') +
                    (e.title ? e.title + '：' : '') + (e.summary || '');
            }).join('\n');

                // 3) 定期压缩沉淀：近期时刻 → LLM 提炼为「•」概要行 → 并入 files.memory（概要记忆层）
            try {
                var msoul = (mem && mem.files && mem.files.soul) || '';
                var muser = (mem && mem.files && mem.files.user) || '';
                var condensePrompt = (MemoryService.TASK_PROMPTS && MemoryService.TASK_PROMPTS.dreamSystem)
                    ? MemoryService.TASK_PROMPTS.dreamSystem(msoul, muser)
                    : '你是一个记忆整理助手。把用户的关键状态信息提炼为「•」开头的事实行，合并重复，删除琐碎，保留情绪、偏好、目标、关系。';
                var url = NativeHttp.chatEndpoint(config.apiUrl);
                NativeHttp.postJson(url, { Authorization: 'Bearer ' + config.apiKey }, {
                    model: config.model || 'gpt-4o',
                    messages: [
                        { role: 'system', content: condensePrompt },
                        { role: 'user', content: '请把这些时刻提炼为用户的关键状态信息（情绪倾向、偏好、目标进展、关系、健康）：\n\n' + lines }
                    ],
                    temperature: 0.3,
                    max_tokens: 600
                }).then(function(data) {
                    var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                    if (text) {
                        text = text.replace(/ thinking[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                        if (text.length > 5 && text !== 'KEEP' && typeof MemoryService !== 'undefined') {
                            // 并入概要层（去重 + 上限由 appendMemory 保证）
                            MemoryService.appendMemory(text);
                        }
                    }
                }, function() {});
            } catch(e) {}

            // 4) 回忆仪式：LLM 写一封有温度的回忆信，送到信箱
            showToast('正在写回忆信…');
            generateWarmText(MemoryService.TASK_PROMPTS.letterSystem,
                '以下是你最近和用户一起经历的时刻：\n\n' + lines + '\n\n请给用户写一封回忆信。'
            ).then(function(text) {
                resetDreamCounter();
                if (text) {
                    var subject = '小满的' + (new Date().getMonth() + 1) + '月回忆信';
                    try {
                        sendProactiveMailSkill.execute({ subject: subject, message: text });
                        done('回忆信已送到信箱');
                    } catch(e) { done('写信失败'); }
                } else {
                    done('回忆信生成失败，稍后再试');
                }
            });
        }

        function resetDreamCounter() {
            try {
                var s = DataService.settings.load() || {};
                s.noteCountAtLastDream = notes.length;
                s.lastDreamAt = Date.now();
                DataService.settings.save(s);
            } catch(e) {}
        }

        // LLM 生成温暖文本（回忆信/关怀信共用）。失败或未配置返回 null。
        function generateWarmText(systemPrompt, userContent) {
            return new Promise(function(resolve) {
                var config;
                try { config = DataService.settings.load(); } catch(e) {}
                if (!config || !config.apiUrl || !config.apiKey) { resolve(null); return; }
                var url = NativeHttp.chatEndpoint(config.apiUrl);
                NativeHttp.postJson(url, { Authorization: 'Bearer ' + config.apiKey }, {
                    model: config.model || 'gpt-4o',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userContent }
                    ],
                    temperature: 0.8,
                    max_tokens: 600
                }).then(function(data) {
                    var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                    if (text) {
                        text = text.replace(/ thinking[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                    }
                    resolve(text || null);
                }, function() { resolve(null); });
            });
        }

        // 对话完成后，检查小满的回复是否提到了某段回忆 → 记一次提起（防止反复炒冷饭）
        function markRecalledMoments(assistantText) {
            try {
                if (typeof MemoryService === 'undefined' || !assistantText) return;
                var mem = MemoryService.load();
                if (!mem || !Array.isArray(mem.episodes) || !mem.episodes.length) return;
                var ids = [];
                for (var mi = 0; mi < mem.episodes.length; mi++) {
                    var e = mem.episodes[mi];
                    if (!e || e.status !== 'active' || !e.summary) continue;
                    var ex = String(e.summary).trim();
                    if (!ex) continue;
                    var frag = ex.length > 8 ? ex.substring(0, 8) : ex;
                    if (frag.length >= 4 && assistantText.indexOf(frag) !== -1) ids.push(e.id);
                }
                if (ids.length) MemoryService.markRecalledEpisodes(ids);
            } catch(e) {}
        }

        // ─── 情绪感知关怀：最近 3 天负面时刻 ≥2 且 24h 内未关怀过 → 小满主动写关心信 ───
        function scanMoodCare() {
            try {
                if (typeof MemoryService === 'undefined') return;
                if (typeof sendProactiveMailSkill === 'undefined') return;
                var s = DataService.settings.load() || {};
                var last = parseInt(s.lastMoodCareAt, 10) || 0;
                if (last && (Date.now() - last) < 24 * 60 * 60 * 1000) return;

                var memCare = MemoryService.load() || {};
                var cutoff = Date.now() - 3 * 86400000;
                var recent = (memCare.episodes || []).filter(function(e) {
                    if (!e || e.status !== 'active') return false;
                    var t = new Date(e.occurredAt || e.createdAt).getTime();
                    return t && t >= cutoff;
                });
                var negatives = recent.filter(function(e) {
                    return ['低落', '焦虑', '愤怒', '疲惫'].indexOf(e.emotion) !== -1;
                });
                if (negatives.length < 2) return;

                var lines = negatives.map(function(e, idx) {
                    var t = MemoryService.relativeTime(e.occurredAt || e.createdAt);
                    return (idx + 1) + '. ' + (t ? t + ' ' : '') + (e.summary || e.title || '');
                }).join('\n');

                var fallback = '这几天看到你的记录，好像有些辛苦。想说的话都可以说给我听，我会一直在。';
                generateWarmText(MemoryService.TASK_PROMPTS.careSystem,
                    '用户最近几天的状态（可能不太好）：\n\n' + lines
                ).then(function(text) {
                    try {
                        sendProactiveMailSkill.execute({ subject: '小满想看看你', message: text || fallback });
                    } catch(e) {}
                    try {
                        var st = DataService.settings.load() || {};
                        st.lastMoodCareAt = String(Date.now());
                        DataService.settings.save(st);
                    } catch(e) {}
                });
            } catch(e) {}
        }

function shareNote(encodedContent) {

        function manualTriggerDreaming() {
            if (typeof runDreaming === 'function') {
                showToast('开始整理记忆...');
                runDreaming();
                setTimeout(loadMemorySettings, 1000);
            } else {
                showToast('记忆系统不可用');
            }
        }

            var text = decodeURIComponent(encodedContent);
            if (text.indexOf('--isHTML ') === 0) text = text.substring(9);
            text = text.replace(/<img[^>]*>/g, '');
            text = text.replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '');
            text = text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            text = text.trim();
            // 移动端有 AndroidShare bridge（走系统分享面板）
            if (typeof AndroidShare !== 'undefined') {
                AndroidShare.share(text);
                closeAllNoteMenus();
                return;
            }
            // 浏览器 fallback：优先 navigator.share，否则复制
            if (navigator.share) {
                navigator.share({ text: text }).catch(function() {});
            } else if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function() {
                    showToast('内容已复制');
                }, function() {
                    showToast('复制失败');
                });
            } else {
                var textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast('内容已复制');
            }
            closeAllNoteMenus();
        }

        function openInsight() {
            closeExplore();
            if (typeof AndroidStorage !== 'undefined') {
                window.location.href = 'insight/insight.html';
            } else {
                window.location.href = 'app/src/main/assets/insight/insight.html';
            }
        }

        function openInsightSheet(noteId) {
            pendingInsightNoteId = noteId;
            insightMethods = getInsightMethods();
            var list = document.getElementById('insightMethodList');
            list.innerHTML = insightMethods.map(function(m) {
                return '<div class="insight-method-item" onclick="startInsight(\'' + noteId + '\', \'' + m.id + '\')">' +
                    '<div class="insight-method-name">' + m.name + '</div>' +
                    '<div class="insight-method-desc">' + (m.desc || '') + '</div>' +
                    '</div>';
            }).join('');
            document.getElementById('insightSheet').classList.add('open');
            document.getElementById('insightSheetOverlay').classList.add('open');
            closeAllNoteMenus();
        }

        function closeInsightSheet() {
            document.getElementById('insightSheet').classList.remove('open');
            document.getElementById('insightSheetOverlay').classList.remove('open');
        }

        // ─── AI 配图弹窗 ───
        var _imageGenNoteId = null;
        var _imageGenStyle = 'illustration';
        var _imageGenResultImageId = null;
        var _imageGenResultSrc = null;
        var IMAGE_GEN_STYLES = [
            { id: 'illustration', name: '插画风', thumb: 'styles/illustration_thumb.jpg' },
            { id: 'watercolor', name: '水彩风', thumb: 'styles/watercolor_thumb.jpg' },
            { id: 'realistic', name: '写实风', thumb: 'styles/realistic_thumb.jpg' },
            { id: 'healing', name: '治愈系', thumb: 'styles/healing_thumb.jpg' },
            { id: 'minimal', name: '极简风', thumb: 'styles/minimal_thumb.jpg' }
        ];
        // 设置风格预览图（覆盖默认缩略图，可传入完整 URL）
        window.setImageGenStyleThumbs = function(thumbs) {
            for (var i = 0; i < IMAGE_GEN_STYLES.length; i++) {
                if (thumbs[IMAGE_GEN_STYLES[i].id]) {
                    IMAGE_GEN_STYLES[i].thumb = thumbs[IMAGE_GEN_STYLES[i].id];
                }
            }
        };
        // 拼完整预览图 URL：Android 走 WebViewAssetLoader，浏览器走相对路径
        function styleThumbSrc(s) {
            if (!s.thumb) return '';
            if (/^(https?:|data:)/.test(s.thumb)) return s.thumb;
            if (typeof AndroidImage !== 'undefined') {
                return 'https://appassets.androidplatform.net/assets/' + s.thumb;
            }
            return s.thumb;
        }
        function openImageGenSheet(noteId) {
            _imageGenNoteId = noteId;
            _imageGenStyle = 'illustration';
            _imageGenResultImageId = null;
            _imageGenResultSrc = null;
            var container = document.getElementById('imageGenStyles');
            container.innerHTML = IMAGE_GEN_STYLES.map(function(s) {
                var active = s.id === 'illustration' ? ' active' : '';
                var src = styleThumbSrc(s);
                var thumbHtml = src
                    ? '<img src="' + src + '" alt="' + s.name + '" onerror="this.parentNode.innerHTML=\'<span style=&quot;font-size:28px;opacity:0.3&quot;>🎨</span>\'">'
                    : '<span style="font-size:28px;opacity:0.3">🎨</span>';
                return '<div class="image-gen-style-card' + active + '" data-style="' + s.id + '" onclick="selectImageGenStyle(\'' + s.id + '\')">' +
                    '<div class="image-gen-style-thumb">' + thumbHtml + '</div>' +
                    '<div class="image-gen-style-name">' + s.name + '</div>' +
                    '</div>';
            }).join('');
            document.getElementById('imageGenResult').classList.remove('show');
            document.getElementById('imageGenResult').innerHTML = '';
            document.getElementById('imageGenStatus').textContent = '';
            document.getElementById('imageGenBtn').textContent = '生成配图';
            document.getElementById('imageGenBtn').disabled = false;
            document.getElementById('imageGenSheet').classList.add('open');
            document.getElementById('imageGenOverlay').classList.add('open');
            closeAllNoteMenus();
        }
        function closeImageGenSheet() {
            _imageGenNoteId = null;
            _imageGenResultImageId = null;
            _imageGenResultSrc = null;
            var resultEl = document.getElementById('imageGenResult');
            if (resultEl) { resultEl.classList.remove('show'); resultEl.innerHTML = ''; }
            document.getElementById('imageGenSheet').classList.remove('open');
            document.getElementById('imageGenOverlay').classList.remove('open');
        }
        window.selectImageGenStyle = function(id) {
            _imageGenStyle = id;
            document.querySelectorAll('.image-gen-style-card').forEach(function(el) {
                el.classList.remove('active');
            });
            var card = document.querySelector('.image-gen-style-card[data-style="' + id + '"]');
            if (card) card.classList.add('active');
        };
        // 下载生成的配图
        window.downloadGeneratedImage = function() {
            var src = _imageGenResultSrc;
            if (!src) return;
            // Android 端：打开系统浏览器下载（等下，WebView 内 http 会被拦截转系统浏览器）
            // 图片是 https://appassets.androidplatform.net/... 或 data:base64
            // 最简单：在新窗口打开图片
            window.open(src, '_blank');
        };
        // 配图成功后：从存储刷新内存笔记数组（skill 是唯一写 content 的地方）
        function refreshNoteAfterImageGen(noteId) {
            var fresh = loadNotes();
            for (var i = 0; i < notes.length; i++) {
                if (notes[i].id !== noteId) continue;
                for (var f = 0; f < fresh.length; f++) {
                    if (fresh[f].id === noteId) {
                        notes[i].content = fresh[f].content;
                        break;
                    }
                }
                return;
            }
        }
        window.generateNoteImage = function() {
            if (!_imageGenNoteId) return;
            var btn = document.getElementById('imageGenBtn');
            var status = document.getElementById('imageGenStatus');
            btn.textContent = '生成中…';
            btn.disabled = true;
            status.textContent = 'AI 正在根据笔记内容创作配图…';
            status.className = 'image-gen-status';
            var skill = typeof window.generateNoteImageSkill !== 'undefined' ? window.generateNoteImageSkill : null;
            if (skill) {
                skill.execute({ noteId: _imageGenNoteId, style: _imageGenStyle }).then(function(result) {
                    if (result && result.success) {
                        status.textContent = '配图已生成，已挂到笔记';
                        status.className = 'image-gen-status';
                        btn.textContent = '重新生成';
                        btn.disabled = false;
                        // 生成结果直接展示在弹窗下方
                        _imageGenResultImageId = result.imageId || '';
                        _imageGenResultSrc = (typeof AndroidImage !== 'undefined' && result.imageId)
                            ? 'https://appassets.androidplatform.net/images/' + result.imageId + '.jpg'
                            : (result.imageSrc || '');
                        var resultEl = document.getElementById('imageGenResult');
                        if (_imageGenResultSrc) {
                            resultEl.innerHTML =
                                '<img src="' + _imageGenResultSrc + '" alt="配图">' +
                                '<div class="image-gen-result-actions">' +
                                '<button class="image-gen-download-btn" onclick="downloadGeneratedImage()">下载</button>' +
                                '<button class="image-gen-redo-btn" onclick="generateNoteImage()">换一张</button>' +
                                '</div>';
                            resultEl.classList.add('show');
                        }
                        refreshNoteAfterImageGen(_imageGenNoteId);
                        persistNotes();
                        if (currentPage === 'notes') {
                            renderNotes(currentTagFilter);
                            setTimeout(loadNoteImages, 150);
                        }
                    } else {
                        btn.textContent = '生成配图';
                        btn.disabled = false;
                        status.textContent = result && result.error ? result.error : '配图生成失败';
                        status.className = 'image-gen-status error';
                    }
                });
            } else {
                btn.textContent = '生成配图';
                btn.disabled = false;
                status.textContent = '配图功能不可用';
                status.className = 'image-gen-status error';
            }
        };
        // skill 侧钩子（agent 对话中直接配图时）：刷新内存数组 + 重渲染
        window.__onNoteImageGenerated = function(noteId, imageId) {
            try {
                refreshNoteAfterImageGen(noteId);
                persistNotes();
                if (currentPage === 'notes') {
                    renderNotes(currentTagFilter);
                    setTimeout(loadNoteImages, 150);
                }
            } catch(e) {}
        };

        function startInsight(noteId, methodId) {
            closeInsightSheet();
            if (typeof AndroidStorage !== 'undefined') {
                window.location.href = 'insight/insight.html?noteId=' + encodeURIComponent(noteId) + '&methodId=' + encodeURIComponent(methodId);
            } else {
                window.location.href = 'app/src/main/assets/insight/insight.html?noteId=' + encodeURIComponent(noteId) + '&methodId=' + encodeURIComponent(methodId);
            }
        }

        function showToast(message) {
            var toast = document.getElementById('toast');
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(function() {
                toast.classList.remove('show');
            }, 2000);
            document.querySelectorAll('.note-menu').forEach(function(m) { m.classList.remove('open'); });
            document.querySelectorAll('.note-card-wrapper.menu-open').forEach(function(w) { w.classList.remove('menu-open'); });
        }

        function updateSidebarStats() {
            document.getElementById('statNotes').textContent = notes.length;
            var allTags = new Set();
            notes.forEach(function(note) {
                var tags = note.content.match(/#([^\s]+)/g) || [];
                tags.forEach(function(t) { allTags.add(t.substring(1)); });
            });
            document.getElementById('statTags').textContent = allTags.size;
            var uniqueDays = new Set(notes.map(function(n) { return n.createdAt.substring(0, 10); }));
            document.getElementById('statDays').textContent = uniqueDays.size;
        }

        function renderHeatmap() {
            var grid = document.getElementById('heatmapGrid');
            var now = new Date();
            var cells = [];
            for (var i = 83; i >= 0; i--) {
                var date = new Date(now);
                date.setDate(date.getDate() - i);
                var dateStr = date.toISOString().substring(0, 10);
                var count = notes.filter(function(n) { return n.createdAt.substring(0, 10) === dateStr; }).length;
                var level = '';
                if (count === 1) level = 'l1';
                else if (count === 2) level = 'l2';
                else if (count >= 3) level = 'l3';
                cells.push('<div class="sidebar-heatmap-cell ' + level + ' ' + (count > 0 ? 'has-notes' : '') + '"></div>');
            }
            grid.innerHTML = cells.join('');
            var monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
            document.getElementById('heatmapMonths').textContent = monthNames[now.getMonth()];
        }

        document.addEventListener('click', function(e) {
            var dropdown = document.getElementById('headerTagDropdownMenu');
            var dropdownBtn = document.querySelector('.header-tag-dropdown-btn');
            if (dropdown && dropdownBtn && !dropdown.contains(e.target) && !dropdownBtn.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });

        renderNotes();
        setTimeout(loadNoteImages, 100);   // 旧笔记的图片：启动时按需通过 AndroidImage 转 data URL
        createSearchElements();
        createTagDropdown();
        renderHeatmap();
        updateSidebarStats();

        document.getElementById('nianChatInput').addEventListener('focus', function() {
            setTimeout(function() {
                scrollToBottom();
            }, 300);
        });

        var currentSettingsSub = null;

        function openSettings() {
            closeSidebar();
            document.getElementById('settingsPanel').classList.add('open');
            document.getElementById('settingsOverlay').classList.add('open');
            document.getElementById('settingsBackBtn').onclick = closeSettings;
            document.getElementById('settingsTitle').textContent = '设置';
            document.getElementById('settingsMenu').style.display = '';
            document.querySelectorAll('.settings-sub').forEach(function(el) { el.classList.remove('active'); });
            currentSettingsSub = null;
        }

        function closeSettings() {
            document.getElementById('settingsPanel').classList.remove('open');
            document.getElementById('settingsOverlay').classList.remove('open');
            document.querySelectorAll('.settings-sub').forEach(function(el) { el.classList.remove('active'); });
            document.getElementById('settingsMenu').style.display = '';
            currentSettingsSub = null;
        }

        function openSettingsSub(sub) {
            document.getElementById('settingsMenu').style.display = 'none';
            document.querySelectorAll('.settings-sub').forEach(function(el) { el.classList.remove('active'); });
            var subEl = document.getElementById('settingsSub' + sub.charAt(0).toUpperCase() + sub.slice(1));
            if (subEl) subEl.classList.add('active');
            currentSettingsSub = sub;
            var labelMap = { ai: 'AI 设置', import: '导入/导出', prefs: '偏好设置', memory: '记忆管理', prompts: '提示词管理' };
            document.getElementById('settingsTitle').textContent = labelMap[sub] || '设置';
            document.getElementById('settingsBackBtn').onclick = backToSettingsMenu;
            if (sub === 'ai') loadAISettings();
            if (sub === 'prompts') loadPromptSettings();
            if (sub === 'memory') loadMemorySettings();
        }

        function backToSettingsMenu() {
            document.querySelectorAll('.settings-sub').forEach(function(el) { el.classList.remove('active'); });
            document.getElementById('settingsMenu').style.display = '';
            document.getElementById('settingsTitle').textContent = '设置';
            document.getElementById('settingsBackBtn').onclick = closeSettings;
            currentSettingsSub = null;
        }

        function loadAISettings() {
            var data = DataService.settings.load();
            if (data) {
                if (data.apiUrl) document.getElementById('aiApiUrl').value = data.apiUrl;
                if (data.apiKey) document.getElementById('aiApiKey').value = data.apiKey;
                if (data.model) document.getElementById('aiModel').value = data.model;
                var budgetEl = document.getElementById('aiContextBudget');
                if (budgetEl && data.contextBudgetTokens) budgetEl.value = data.contextBudgetTokens;
                var ragMap = [['aiEmbeddingUrl','embeddingApiUrl'],['aiEmbeddingKey','embeddingApiKey'],['aiEmbeddingModel','embeddingModel'],['aiRerankUrl','rerankApiUrl'],['aiRerankModel','rerankModel']];
                for (var ri = 0; ri < ragMap.length; ri++) {
                    var rel = document.getElementById(ragMap[ri][0]);
                    if (rel && data[ragMap[ri][1]]) rel.value = data[ragMap[ri][1]];
                }
                if (data.imageModel) document.getElementById('aiImageModel').value = data.imageModel;
                if (data.imageApiUrl) document.getElementById('aiImageApiUrl').value = data.imageApiUrl;
                if (data.imageApiKey) document.getElementById('aiImageApiKey').value = data.imageApiKey;
            }
        }

        function saveAISettings() {
            var apiUrl = document.getElementById('aiApiUrl').value.trim();
            var apiKey = document.getElementById('aiApiKey').value.trim();
            var model = document.getElementById('aiModel').value;
            var contextBudgetEl = document.getElementById('aiContextBudget');
            var contextBudget = contextBudgetEl ? contextBudgetEl.value.trim() : '';
            var embeddingUrl = document.getElementById('aiEmbeddingUrl') ? document.getElementById('aiEmbeddingUrl').value.trim() : '';
            var embeddingKey = document.getElementById('aiEmbeddingKey') ? document.getElementById('aiEmbeddingKey').value.trim() : '';
            var embeddingModel = document.getElementById('aiEmbeddingModel') ? document.getElementById('aiEmbeddingModel').value.trim() : '';
            var rerankUrl = document.getElementById('aiRerankUrl') ? document.getElementById('aiRerankUrl').value.trim() : '';
            var rerankModel = document.getElementById('aiRerankModel') ? document.getElementById('aiRerankModel').value.trim() : '';
            var imageModel = document.getElementById('aiImageModel').value.trim();
            var imageApiUrl = document.getElementById('aiImageApiUrl').value.trim();
            var imageApiKey = document.getElementById('aiImageApiKey').value.trim();
            var statusEl = document.getElementById('aiSettingsStatus');

            if (!apiUrl || !apiKey) {
                statusEl.textContent = '请填写 API 地址和密钥';
                statusEl.className = 'settings-status error';
                return;
            }

            var budgetNum = 0;
            if (contextBudget) {
                budgetNum = parseInt(contextBudget, 10);
                if (!isFinite(budgetNum) || budgetNum < 1000) {
                    statusEl.textContent = '上下文预算至少填 1000 tokens';
                    statusEl.className = 'settings-status error';
                    return;
                }
                if (budgetNum > 1000000) budgetNum = 1000000;
            }

            // 合并保存，避免覆盖 insightPrompts / proactiveMails / lastDreamAt 等其他设置
            var settings = DataService.settings.load() || {};
            settings.apiUrl = apiUrl;
            settings.apiKey = apiKey;
            settings.model = model;
            if (budgetNum) settings.contextBudgetTokens = budgetNum;
            else delete settings.contextBudgetTokens;
            if (embeddingUrl) settings.embeddingApiUrl = embeddingUrl; else delete settings.embeddingApiUrl;
            if (embeddingKey) settings.embeddingApiKey = embeddingKey; else delete settings.embeddingApiKey;
            if (embeddingModel) settings.embeddingModel = embeddingModel; else delete settings.embeddingModel;
            if (rerankUrl) settings.rerankApiUrl = rerankUrl; else delete settings.rerankApiUrl;
            if (rerankModel) settings.rerankModel = rerankModel; else delete settings.rerankModel;
            if (imageModel) settings.imageModel = imageModel;
            else delete settings.imageModel;
            if (imageApiUrl) settings.imageApiUrl = imageApiUrl;
            else delete settings.imageApiUrl;
            if (imageApiKey) settings.imageApiKey = imageApiKey;
            else delete settings.imageApiKey;
            try {
                DataService.settings.save(settings);
                if (nianAgent && nianAgent.reloadConfig) nianAgent.reloadConfig();
                if (window.NoteRAG && document.getElementById('noteRagStatus')) {
                    var st = NoteRAG.stats(notes);
                    document.getElementById('noteRagStatus').textContent = st.enabled
                        ? ('已索引 ' + st.indexed + ' / ' + st.total + ' 条，模型 ' + st.model)
                        : '未配置 Embedding Key，当前退回 BM25 + LLM 重排';
                }
                statusEl.textContent = '设置已保存' + (budgetNum ? '（上下文预算 ' + budgetNum + ' tokens）' : '');
                statusEl.className = 'settings-status success';
                setTimeout(function() {
                    statusEl.className = 'settings-status';
                    statusEl.textContent = '';
                }, 2000);
            } catch(e) {
                statusEl.textContent = '保存失败';
                statusEl.className = 'settings-status error';
            }
        }

        function rebuildNoteRagIndex() {
            var el = document.getElementById('noteRagStatus');
            if (!window.NoteRAG) { if (el) el.textContent = 'NoteRAG 未加载'; return; }
            if (!NoteRAG.enabled()) { if (el) el.textContent = '请先填写 SiliconFlow API Key 并保存'; return; }
            if (el) el.textContent = '索引中… 0 / ' + notes.length;
            NoteRAG.rebuildIndex(notes, function(done, total) {
                if (el) el.textContent = '索引中… ' + done + ' / ' + total;
            }).then(function(r) {
                if (el) el.textContent = (r && r.ok)
                    ? ('索引完成：' + r.indexed + ' / ' + r.total + ' 条')
                    : ('索引失败：' + ((r && r.error) || '未知错误'));
            }, function(e) {
                if (el) el.textContent = '索引失败：' + (e && e.message ? e.message : e);
            });
        }
        window.rebuildNoteRagIndex = rebuildNoteRagIndex;

        // 测试 AI 连接：发送一条简单消息，显示结果/错误，帮助诊断配置问题
        function testAIConnection() {
            var statusEl = document.getElementById('aiTestStatus');
            var apiUrl = document.getElementById('aiApiUrl').value.trim();
            var apiKey = document.getElementById('aiApiKey').value.trim();
            var model = document.getElementById('aiModel').value.trim() || 'gpt-4o';
            if (!apiUrl || !apiKey) {
                statusEl.textContent = '请先填写 API 地址和密钥';
                statusEl.className = 'settings-status error';
                return;
            }
            statusEl.textContent = '正在测试…';
            statusEl.className = 'settings-status';
            // 地址容错：裸域名自动补 /v1，粘了完整端点也不会重复拼接
            var url = NativeHttp.chatEndpoint(apiUrl);
            var payload = { model: model, messages: [{ role: 'user', content: '你好' }], max_tokens: 64 };
            NativeHttp.postJson(url, { Authorization: 'Bearer ' + apiKey }, payload).then(function(data) {
                var choice = data.choices && data.choices[0];
                if (choice) {
                    var msg = choice.message || {};
                    var text = msg.content || msg.reasoning_content || '';
                    statusEl.textContent = '连接成功！' + (text ? '模型回复：' + text.substring(0, 60) : '（模型已响应）');
                    statusEl.className = 'settings-status success';
                } else {
                    statusEl.textContent = '连上了，但返回成空。多半是模型名不对：' + model + '（实际请求 ' + url + '）';
                    statusEl.className = 'settings-status success';
                }
            }, function(e) {
                statusEl.textContent = NativeHttp.explainError(e, url);
                statusEl.className = 'settings-status error';
            });
        }

                        var PROMPT_DEFAULTS = [
            {
                        "id": "affirmation",
                        "name": "每日肯定",
                        "desc": "每日积极肯定",
                        "category": "global",
                        "systemPrompt": "你是一个积极心理学顾问。请基于用户提供的文本内容，生成一条个性化的「每日肯定」声明。\n\n规则：\n1. 从文本中识别用户当前面临的挑战或需要的心理支持\n2. 创作 3-5 条积极的、肯定性的自我陈述\n3. 每条声明需具体、可内化，避免空泛的鸡汤\n4. 使用第一人称「我」的句式，便于用户直接朗读或默念\n5. 输出格式：使用简洁的中文，每条独立成行，不要使用任何思考标签或元标签"
            },
            {
                        "id": "meaning",
                        "name": "意义雷达",
                        "desc": "发现深层意义",
                        "category": "global",
                        "systemPrompt": "你是一个意义探索向导。请对用户提供的文本内容进行「意义雷达」扫描。\n\n规则：\n1. 从文本中识别出对用户可能有深层意义的内容\n2. 从以下维度分析意义：个人成长、关系连接、社会贡献、自我实现\n3. 指出这些意义如何与用户的人生叙事相联系\n4. 输出格式：使用简洁的中文，分维度呈现，不要使用任何思考标签或元标签\n5. 帮助用户看到日常记录中的深层价值"
            },
            {
                        "id": "default",
                        "name": "默认洞察",
                        "desc": "通用深度分析",
                        "category": "single",
                        "systemPrompt": "你是一个深度洞察分析师。请对用户提供的笔记内容进行全面而深入的分析。\n\n规则：\n1. 先概括笔记的核心内容和情绪基调\n2. 识别其中隐含的需求、模式或矛盾\n3. 从至少两个维度（如情绪、认知、行为、关系）进行解读\n4. 给出 2-3 个有启发性的问题或行动方向\n5. 输出格式：使用简洁的中文，结构化呈现，不要使用任何思考标签或元标签"
            },
            {
                        "id": "value",
                        "name": "价值澄清",
                        "desc": "梳理核心价值观",
                        "category": "single",
                        "systemPrompt": "你是一个价值观梳理顾问。请对用户提供的文本内容进行「价值澄清」分析。\n\n规则：\n1. 从文本中识别出用户表达或隐含的价值观\n2. 指出这些价值观之间的和谐与冲突之处\n3. 分析当前行为与价值观是否一致\n4. 给出价值观整合的建议\n5. 输出格式：使用简洁的中文，分点呈现，不要使用任何思考标签或元标签"
            },
            {
                        "id": "reverse",
                        "name": "逆向思考",
                        "desc": "反向思维训练",
                        "category": "single",
                        "systemPrompt": "你是一个逆向思维训练师。请对用户提供的文本内容进行「逆向思考」分析。\n\n规则：\n1. 对内容中的主要观点进行反向假设\n2. 如果目标是相反的，会有什么不同的行动？\n3. 找出正反两个方向的共同盲点\n4. 给出逆向思考带来的新洞察\n5. 输出格式：使用简洁的中文，分点呈现，不要使用任何思考标签或元标签"
            },
            {
                        "id": "second",
                        "name": "二阶思考",
                        "desc": "连锁效应分析",
                        "category": "single",
                        "systemPrompt": "你是一个二阶效应分析师。请对用户提供的文本内容进行「二阶思考」分析。\n\n规则：\n1. 分析如果按照当前思路行事，可能产生的直接结果（一阶效应）\n2. 进一步分析一阶效应之后会引发的连锁反应（二阶效应）\n3. 特别关注那些反直觉的、延迟出现的间接影响\n4. 给出如何利用或防范二阶效应的建议\n5. 输出格式：使用简洁的中文，分层次呈现，不要使用任何思考标签或元标签"
            },
            {
                        "id": "cbt",
                        "name": "CBT疗法",
                        "desc": "认知行为疗法",
                        "category": "single",
                        "systemPrompt": "你是一个认知行为疗法（CBT）咨询师。请基于用户提供的文本内容，从CBT视角进行分析和回应。\n\n规则：\n1. 识别文本中的自动化思维、认知扭曲（如灾难化、非黑即白、过度概括等）\n2. 指出触发事件→自动思维→情绪反应→行为结果的链条\n3. 提供替代性的理性认知和具体的行为实验建议\n4. 使用温和但理性的语气，帮助用户看到思维与情绪的关联\n5. 输出格式：使用简洁的中文，分点呈现，不要使用任何思考标签或元标签"
            },
            {
                        "id": "mbti",
                        "name": "MBTI分析",
                        "desc": "性格类型洞察",
                        "category": "single",
                        "systemPrompt": "你是一个MBTI性格分析专家。请基于用户提供的文本内容，推断用户的性格倾向并进行分析。\n\n规则：\n1. 从文本中寻找信息处理方式、决策偏好、社交风格、时间观念等线索\n2. 基于四个维度（E/I、S/N、T/F、J/P）进行倾向性推断\n3. 指出该性格类型的优势、盲点和成长方向\n4. 给出与该性格类型适配的自我提升建议\n5. 输出格式：使用简洁的中文，分点呈现，不要使用任何思考标签或元标签。注意：分析时说明这只是基于单一文本的推测，仅供参考"
            },
            {
                        "id": "why",
                        "name": "5Why追问",
                        "desc": "连续追问直达本质",
                        "category": "single",
                        "systemPrompt": "你是一个思维引导教练。请对用户提供的文本内容进行「5why追问」式的深度分析。\n\n规则：\n1. 针对内容中的关键问题或矛盾点，连续追问「为什么」，逐层深入\n2. 每一层追问后，给出你的分析推断\n3. 最终归纳出根本原因或核心洞察\n4. 输出格式：使用简洁的中文，分层次呈现，不要使用任何思考标签或元标签\n5. 如果内容中没有明显的问题，请找出值得深挖的切入点"
            },
            {
                        "id": "blindspot",
                        "name": "盲区探索",
                        "desc": "发现认知盲区",
                        "category": "single",
                        "systemPrompt": "你是一个认知偏差分析专家。请对用户提供的文本内容进行「盲区探索」分析。\n\n规则：\n1. 识别文本中可能存在的认知盲区、思维定势、或者作者未察觉的假设\n2. 从多个对立视角进行挑战\n3. 给出这些盲区可能导致的决策风险或理解偏差\n4. 输出格式：使用简洁的中文，分点呈现，不要使用任何思考标签或元标签\n5. 保持建设性，指出盲区的同时提供突破思路"
            },
            {
                        "id": "counterintuitive",
                        "name": "反直觉洞察",
                        "desc": "反常识思考",
                        "category": "single",
                        "systemPrompt": "你是一个反常识思考专家。请对用户提供的文本内容生成反直觉洞见。\n\n规则：\n1. 找出内容中看似合理但可能错误的假设\n2. 提出至少3个违反直觉但有理有据的观点\n3. 每个反直觉观点都要给出推理依据\n4. 输出格式：使用简洁的中文，每条洞见独立成段，不要使用任何思考标签或元标签\n5. 重点在于「反直觉但正确」，而非故作惊人之语"
            },
            {
                        "id": "extend",
                        "name": "主题延伸",
                        "desc": "主题关联与延伸",
                        "category": "deep",
                        "systemPrompt": "你是一个思想拓展师。请对用户提供的文本内容进行「主题延伸」分析。\n\n规则：\n1. 提炼文本的核心主题或关键词\n2. 将该主题延伸到更广阔的领域\n3. 提出2-3个该主题下值得进一步探索的子方向或问题\n4. 输出格式：使用简洁的中文，分点呈现，不要使用任何思考标签或元标签\n5. 帮助用户发现一个平常话题背后的丰富层次"
            },
            {
                        "id": "seneca",
                        "name": "塞涅卡",
                        "desc": "斯多葛哲学视角",
                        "category": "deep",
                        "systemPrompt": "你是一个斯多葛哲学顾问。请以塞涅卡（Seneca）的视角，对用户提供的文本内容进行哲学式的反思。\n\n规则：\n1. 从斯多葛哲学的核心原则出发：控制二分法、接纳命运、内在自由、死亡意识\n2. 用塞涅卡的风格——冷静、睿智、略带书信体的温暖——回应内容中的困扰\n3. 指出哪些焦虑来自不可控之事，哪些是可以通过内在修行改变的\n4. 引用或化用塞涅卡的名言来支持观点\n5. 输出格式：使用简洁的中文，以书信体呈现，不要使用任何思考标签或元标签"
            },
            {
                        "id": "contradiction",
                        "name": "主要矛盾",
                        "desc": "抓住核心矛盾",
                        "category": "deep",
                        "systemPrompt": "你是一个辩证思维分析师。请对用户提供的文本内容进行「主要矛盾」分析。\n\n规则：\n1. 从文本中识别出多个相互冲突的力量、需求或价值观\n2. 区分主要矛盾和次要矛盾，找出最核心的那对冲突\n3. 分析矛盾双方的关系——是对抗性的还是可以转化的\n4. 提出化解或转化主要矛盾的思路\n5. 输出格式：使用简洁的中文，分层次呈现，不要使用任何思考标签或元标签"
            },
            {
                        "id": "compound",
                        "name": "复利飞轮",
                        "desc": "复利效应思维",
                        "category": "deep",
                        "systemPrompt": "你是一个系统思维教练。请对用户提供的文本内容进行「复利飞轮」分析。\n\n规则：\n1. 从文本中识别出可以形成正向循环的微小习惯或行为\n2. 设计一个「飞轮」模型：A→B→C→A，每个环节推动下一个环节，形成增强回路\n3. 指出当前最薄弱的一环，以及突破它的具体方法\n4. 说明这个飞轮的复利效应——持续运作后可能带来的变化\n5. 输出格式：使用简洁的中文，结构化呈现，不要使用任何思考标签或元标签"
            }
];

        function getStoredPrompts() {
            try {
                var s = DataService.settings.load();
                if (s && s.insightPrompts) {
                    var stored = typeof s.insightPrompts === 'string' ? JSON.parse(s.insightPrompts) : s.insightPrompts;
                    if (Array.isArray(stored) && stored.length > 0) return stored;
                }
            } catch(e) {}
            return null;
        }

        function saveStoredPrompts(prompts) {
            try {
                var s = DataService.settings.load() || {};
                s.insightPrompts = prompts;
                DataService.settings.save(s);
            } catch(e) {}
        }

        function getInsightMethods() {
            var stored = getStoredPrompts();
            var source = stored || PROMPT_DEFAULTS;
            return source.map(function(p) {
                return { id: p.id, name: p.name, desc: p.desc, category: p.category, systemPrompt: p.systemPrompt };
            });
        }

        // 暴露给 Skills 使用
        window.getInsightMethods = getInsightMethods;

        function loadPromptSettings() {
            var stored = getStoredPrompts();
            var prompts = stored || PROMPT_DEFAULTS;

            // 按 category 分组
            var groups = { global: [], single: [], deep: [] };
            prompts.forEach(function(p) {
                var cat = groups[p.category] ? p.category : 'single';
                groups[cat].push(p);
            });

            var groupLabels = {
                global: { title: '全局洞察', subtitle: '不需要选择笔记，基于整体状态生成', count: groups.global.length },
                single: { title: '单篇洞察', subtitle: '选择一篇笔记，从不同角度深度分析', count: groups.single.length },
                deep: { title: '深度探索', subtitle: '跨笔记的深度分析与哲学反思', count: groups.deep.length }
            };

            var html = '';
            ['global', 'single', 'deep'].forEach(function(cat) {
                var items = groups[cat];
                if (items.length === 0) return;
                var info = groupLabels[cat];
                html += '<div class="prompt-category">' +
                    '<div class="prompt-category-title">' + info.title + '</div>' +
                    '<div class="prompt-category-subtitle">' + info.subtitle + '</div>' +
                    '</div>';

                items.forEach(function(p) {
                    html += '<div class="prompt-card' + (cat === 'deep' ? ' prompt-card-thinking' : '') + '" id="promptCard_' + p.id + '">' +
                        '<div class="prompt-card-header" onclick="togglePromptCard(\'' + p.id + '\')">' +
                        '<div class="prompt-card-title">' +
                        escapeHtml(p.name) +
                        '</div>' +
                        '<svg class="prompt-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
                        '</div>' +
                        '<div class="prompt-card-body">' +
                        '<div class="prompt-field">' +
                        '<div class="prompt-field-label">名称</div>' +
                        '<input class="prompt-field-input" value="' + escapeHtml(p.name).replace(/"/g, '&quot;') + '" data-prompt="' + p.id + '" data-field="name">' +
                        '</div>' +
                        '<div class="prompt-field">' +
                        '<div class="prompt-field-label">描述</div>' +
                        '<input class="prompt-field-input" value="' + escapeHtml(p.desc).replace(/"/g, '&quot;') + '" data-prompt="' + p.id + '" data-field="desc">' +
                        '</div>' +
                        '<div class="prompt-field">' +
                        '<div class="prompt-field-label">系统提示词</div>' +
                        '<textarea class="prompt-field-input prompt-field-textarea" data-prompt="' + p.id + '" data-field="systemPrompt">' + escapeHtml(p.systemPrompt) + '</textarea>' +
                        '</div></div></div>';
                });
            });

            document.getElementById('promptsListContainer').innerHTML = html;
        }

        function togglePromptCard(id) {
            var card = document.getElementById('promptCard_' + id);
            if (card) card.classList.toggle('open');
        }

        function savePromptSettings() {
            var prompts = [];
            PROMPT_DEFAULTS.forEach(function(d) {
                var name = getPromptField(d.id, 'name') || d.name;
                var desc = getPromptField(d.id, 'desc') || d.desc;
                var systemPrompt = getPromptField(d.id, 'systemPrompt') || d.systemPrompt;
                prompts.push({ id: d.id, name: name, desc: desc, systemPrompt: systemPrompt });
            });
            saveStoredPrompts(prompts);
            // update insightMethods live
            insightMethods = getInsightMethods();
            document.getElementById('promptSettingsStatus').textContent = '已保存';
            document.getElementById('promptSettingsStatus').className = 'settings-status success';
            setTimeout(function() {
                document.getElementById('promptSettingsStatus').textContent = '';
                document.getElementById('promptSettingsStatus').className = 'settings-status';
            }, 2000);
        }

        function getPromptField(id, field) {
            var el = document.getElementById('promptsListContainer').querySelector('[data-prompt="' + id + '"][data-field="' + field + '"]');
            return el ? el.value.trim() : '';
        }

        window.togglePromptCard = togglePromptCard;
        window.savePromptSettings = savePromptSettings;

        // ─── 记忆管理设置 ───
        function loadMemorySettings() {
            var overviewEl = document.getElementById('memoryOverview');
            var dreamingEl = document.getElementById('dreamingStatus');
            var identityEl = document.getElementById('memoryIdentityContent');
            var soulEl = document.getElementById('memorySoulContent');
            var userEl = document.getElementById('memoryUserContent');
            var toolsEl = document.getElementById('memoryToolsContent');
            var memoryEl = document.getElementById('memoryMemoryContent');
            var heartbeatEl = document.getElementById('memoryHeartbeatContent');

            if (typeof AndroidMemory !== 'undefined') {
                try {
                    var raw = AndroidMemory.loadAll();
                    var mem = JSON.parse(raw);
                    var files = mem.files || {};
                    var identity = files.identity || '';
                    var soul = files.soul || '';
                    var user = files.user || '';
                    var tools = files.tools || '';
                    var memory = files.memory || '';
                    var heartbeat = files.heartbeat || '';

                    overviewEl.textContent = 'identity: ' + identity.length + ' 字 | soul: ' + soul.length + ' 字 | user: ' + user.length + ' 字 | tools: ' + tools.length + ' 字 | memory: ' + memory.length + ' 字 | heartbeat: ' + heartbeat.length + ' 字';
                    if (identityEl) identityEl.textContent = identity || '(空)';
                    if (soulEl) soulEl.textContent = soul || '(空)';
                    if (userEl) userEl.textContent = user || '(空)';
                    if (toolsEl) toolsEl.textContent = tools || '(空)';
                    if (memoryEl) memoryEl.textContent = memory || '(空)';
                    if (heartbeatEl) heartbeatEl.textContent = heartbeat || '(空)';
                } catch(e) {
                    overviewEl.textContent = '读取失败';
                }
            } else {
                overviewEl.textContent = '记忆系统只在 WebView 中可用';
            }

            var dreamInfo = '未记录';
            try {
                var s = DataService.settings.load() || {};
                var lastDream = s.lastDreamAt;
                var lastCount = s.noteCountAtLastDream || 0;
                if (lastDream) {
                    var d = new Date(lastDream);
                    var dateStr = d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0');
                    dreamInfo = '上次整理: ' + dateStr + ' | 当时笔记数: ' + lastCount;
                } else {
                    dreamInfo = '尚未触发过 dreaming';
                }
            } catch(e) {}
            dreamingEl.textContent = dreamInfo;
        }

        // ─── 记忆管理 ───
        function openFullMemoryPage() {
            if (typeof AndroidStorage !== 'undefined') {
                window.location.href = 'memory/memory.html';
            } else {
                window.location.href = 'app/src/main/assets/memory/memory.html';
            }
        }

        function manualTriggerDreaming() {
            if (typeof runDreaming === 'function') {
                showToast('开始写回忆信...');
                runDreaming();
                setTimeout(loadMemorySettings, 1000);
            } else {
                showToast('记忆系统不可用');
            }
        }

        // ─── 导入 flomo HTML ───
        window.handleImportFile = function(event) {
            var file = event.target.files[0];
            if (!file) return;
            var statusEl = document.getElementById('importStatus');
            statusEl.textContent = '正在读取文件...';

            var reader = new FileReader();
            reader.onload = function(e) {
                var html = e.target.result;
                statusEl.textContent = '正在解析笔记...';

                var doc = null;
                try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (ex) {}
                var memoNodes = doc ? doc.querySelectorAll('.memo') : [];
                var imported = 0;
                var skipped = 0;

                function htmlToText(contentHtml) {
                    return String(contentHtml || '')
                        .replace(/<img[^>]*>/gi, '[图片]')
                        .replace(/<br[^>]*>/gi, '\n')
                        .replace(/<p[^>]*>/g, '').replace(/<\/p>/g, '\n')
                        .replace(/<li[^>]*>/g, '- ').replace(/<\/li>/g, '\n')
                        .replace(/<ul[^>]*>/g, '').replace(/<\/ul>/g, '')
                        .replace(/<ol[^>]*>/g, '').replace(/<\/ol>/g, '')
                        .replace(/<strong[^>]*>/g, '').replace(/<\/strong>/g, '')
                        .replace(/<[^>]+>/g, '')
                        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                        .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
                        .replace(/\n{3,}/g, '\n\n').trim();
                }

                function addImportedNote(timeStr, contentHtml) {
                    var content = htmlToText(contentHtml);
                    if (!content) { skipped++; return; }
                    var createdAt = timeStr;
                    try {
                        var d = new Date(timeStr.replace(' ', 'T'));
                        if (!isNaN(d.getTime())) createdAt = d.toISOString();
                    } catch(ex) {}
                    notes.push({ id: 'import_' + Date.now() + '_' + imported, content: content, createdAt: createdAt });
                    imported++;
                }

                if (memoNodes && memoNodes.length > 0) {
                    for (var mi = 0; mi < memoNodes.length; mi++) {
                        var memo = memoNodes[mi];
                        var timeEl = memo.querySelector('.time');
                        var contentEl = memo.querySelector('.content');
                        addImportedNote(
                            timeEl ? timeEl.textContent.trim() : '',
                            contentEl ? contentEl.innerHTML : (memo.textContent || '')
                        );
                    }
                } else {
                    // 兼容旧版 flomo 导出结构
                    var memoRegex = /<div class="memo">[\s\S]*?<div class="time">([^<]+)<\/div>[\s\S]*?<div class="content">([\s\S]*?)<\/div>/g;
                    var match;
                    while ((match = memoRegex.exec(html)) !== null) {
                        addImportedNote(match[1].trim(), match[2].trim());
                    }
                }

                persistNotes();
                updateSidebarStats();
                renderHeatmap();
                if (currentPage === 'notes') renderNotes(currentTagFilter);

                statusEl.innerHTML = '<span style="color:#34a853">导入完成</span>: ' + imported + ' 条笔记'
                    + (skipped > 0 ? ' (' + skipped + ' 条跳过)' : '');
                event.target.value = '';
            };
            reader.readAsText(file);
        }

        function openMemory() {
            if (typeof AndroidStorage !== 'undefined') {
                window.location.href = 'memory/memory.html';
            } else {
                window.location.href = 'app/src/main/assets/memory/memory.html';
            }
        }

        // ─── Window exports for new features ───
        window.insertRememberTag = insertRememberTag;
        window.openNotePicker = openNotePicker;
        window.closeNotePicker = closeNotePicker;
        window.selectNote = selectNote;
        window.clearNoteReference = clearNoteReference;
        window.enterInsightMode = enterInsightMode;
        window.exitInsightMode = exitInsightMode;
        window.openInsightPicker = openInsightPicker;
        window.closeInsightPicker = closeInsightPicker;
        window.selectInsightNote = selectInsightNote;
        window.showAllScenarios = showAllScenarios;
        window.selectInsightScenario = selectInsightScenario;
        window.executeInsight = executeInsight;
        window.goBackInsightStep = goBackInsightStep;
        window.openInsightSheet = function(noteId) { openInsightPicker(true, noteId); };
        window.closeInsightSheet = closeInsightPicker;
        window.openImageGenSheet = openImageGenSheet;
        window.closeImageGenSheet = closeImageGenSheet;
        window.toggleHistoryPanel = toggleHistoryPanel;
        window.closeHistoryPanel = closeHistoryPanel;
        window.newConversation = newConversation;
        window.showOnboarding = showOnboarding;
        window.finishOnboarding = finishOnboarding;
        window.openMemory = openMemory;
        window.switchToConversation = switchToConversation;
        window.renderNianMessages = renderNianMessages;
        window.runDreaming = runDreaming;

        // 切换对话时重置 agent 上下文（防止跨对话历史泄漏导致上下文爆满）。
        // summary 为该对话的历史摘要（可能为空），随上下文一起恢复。
        window.resetAgentContext = function(msgs, summary) {
            if (nianAgent) {
                nianAgent.reset();
                if (msgs && msgs.length) {
                    nianAgent.setHistory(msgs, summary);
                }
            }
        };


