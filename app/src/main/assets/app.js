
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
                // 先读出现有配置，合并后再保存（保护 auth token 不被覆盖）
                var existing = {};
                try {
                    var raw = hasBridge ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
                    if (raw) existing = JSON.parse(raw);
                } catch(e) {}
                var merged = Object.assign(existing, data);
                // 剥离 apiUrl/apiKey/model —— 这些由后端 + token 提供，不持久化在 settings 里
                delete merged.apiUrl;
                delete merged.apiKey;
                delete merged.model;
                if (hasBridge) {
                    AndroidSettings.saveSettings(JSON.stringify(merged));
                } else {
                    try { localStorage.setItem('nian_settings', JSON.stringify(merged)); } catch(e) {}
                }
            },
            load: function() {
                try {
                    var raw = hasBridge ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
                    var settings = raw ? JSON.parse(raw) : {};
                    // 剥离老版本残留的 apiUrl/apiKey/model —— 这些必须从后端 + token 拿，不持久化
                    delete settings.apiUrl;
                    delete settings.apiKey;
                    delete settings.model;
                    // 注入后端地址和 token（从 BuildConfig 烧入的 url + getNianToken）
                    settings.apiUrl = (window.__NianBackend && window.__NianBackend.url) || 'http://115.159.116.240:3456/v1';
                    settings.apiKey = window.getNianToken ? window.getNianToken() : '';
                    // 同步缓存到 localStorage，让 memory 页面也能读到
                    try { if (settings.apiKey) localStorage.setItem('nian_token_cache', settings.apiKey); } catch(e) {}
                    settings.model = 'deepseek-v4-flash';
                    return settings;
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
        function initAgent() {
          if (typeof NianAgent === "undefined") return;
          nianAgent = new NianAgent();
          if (typeof searchNotesSkill !== "undefined") {
            nianAgent.registerSkill(searchNotesSkill);
          }
          if (typeof listInsightModesSkill !== "undefined") {
            nianAgent.registerSkill(listInsightModesSkill);
          }
          if (typeof runInsightSkill !== "undefined") {
            nianAgent.registerSkill(runInsightSkill);
          }
          if (typeof createNoteSkill !== "undefined") {
            nianAgent.registerSkill(createNoteSkill);
          }
          if (typeof getWeatherSkill !== "undefined") {
            nianAgent.registerSkill(getWeatherSkill);
          }
          if (typeof webSearchSkill !== "undefined") {
            nianAgent.registerSkill(webSearchSkill);
          }
          if (typeof sendProactiveMailSkill !== "undefined") {
            nianAgent.registerSkill(sendProactiveMailSkill);
          }
          if (typeof updateArchiveSkill !== "undefined") {
            nianAgent.registerSkill(updateArchiveSkill);
          }
        }
        initAgent();
        // loadConversations();

        // ─── Agent 创建的笔记同步到 UI ───
        window.__agentCreateNote = function(content) {
          var note = { id: "note_" + Date.now(), content: content, createdAt: new Date().toISOString() };
          notes.unshift(note);
          persistNotes();
          updateSidebarStats();
          renderHeatmap();
          showToast('念念为你记了一条笔记');
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
    { id: "direct", name: "直接输出", desc: "一次性输出完整分析报告" },
    { id: "chat", name: "苏格拉底追问", desc: "念念像朋友一样边聊边分析，可追问、可展开" }
];
var insightPickerState = { step: 0, noteId: null, scenario: null };

function loadConversations() {
    try {
        var raw = localStorage.getItem('nian_conversations');
        conversations = raw ? JSON.parse(raw) : [];
    } catch(e) { conversations = []; }
    if (conversations.length === 0) {
        var id = 'conv_' + Date.now();
        conversations.push({ id: id, title: '新的对话', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        currentConvId = id;
        saveConversations();
    } else {
        currentConvId = conversations[0].id;
    }
    var conv = getCurrentConv();
    if (conv) nianMessages = conv.messages;
}

function saveConversations() {
    try { localStorage.setItem('nian_conversations', JSON.stringify(conversations)); } catch(e) {}
}

function getCurrentConv() {
    for (var i = 0; i < conversations.length; i++) {
        if (conversations[i].id === currentConvId) return conversations[i];
    }
    return conversations.length > 0 ? conversations[0] : null;
}

function newConversation() {
    var id = 'conv_' + Date.now();
    conversations.unshift({ id: id, title: '新的对话', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    currentConvId = id;
    nianMessages = conversations[0].messages;
    saveConversations();
    closeHistoryPanel();
    renderNianMessages();
}

function switchToConversation(id) {
    currentConvId = id;
    var conv = getCurrentConv();
    if (conv) nianMessages = conv.messages;
    renderNianMessages();
    renderHistoryList();
    saveConversations();
}

function renderNianMessages() {
    var container = document.getElementById('nianChatMessages');
    if (!container) return;
    container.innerHTML = '';
    var conv = getCurrentConv();
    if (!conv || conv.messages.length === 0) {
        var msg = document.createElement('div');
        msg.className = 'nian-message assistant';
        msg.innerHTML = '<div class="nian-message-text">你好呀！我是念念，你的 AI 日记伴侣。有什么想和我分享的吗？</div>';
        container.appendChild(msg);
        return;
    }
    for (var i = 0; i < conv.messages.length; i++) {
        var m = conv.messages[i];
        if (m.role === 'system') continue;
        var el = document.createElement('div');
        el.className = 'nian-message ' + (m.role === 'user' ? 'user' : 'assistant');
        if (m.role === 'user') {
            el.innerHTML = '<div class="nian-message-text">' + escapeHtml(m.content || '') + '</div>';
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

function deleteConversation(id) {
    if (conversations.length <= 1) { showToast('至少保留一个对话'); return; }
    conversations = conversations.filter(function(c) { return c.id !== id; });
    if (currentConvId === id) currentConvId = conversations[0].id;
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
        var recent = notes.slice();
        for (var i = 0; i < recent.length; i++) {
            (function(note) {
                var preview = (note.content || '').replace(/<[^>]+>/g, '').substring(0, 50);
                var date = (note.createdAt || '').substring(0, 10);
                var div = document.createElement('div');
                div.className = 'penpal-sheet-item';
                div.innerHTML = '<div class="np-date">' + date + '</div><div class="np-text">' + escapeHtml(preview) + '</div>';
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

// ── 发信到笔友 (app.html 作用域, 从笔记菜单 "发信" 调用) ──
var penpals = [
    { id: "nian", name: "念念", emoji: "💭", color: "#e85d04", personality: "你的 AI 生活伴侣", systemPrompt: "" },
    { id: "xiaonuan", name: "小暖", emoji: "暖", color: "#FF8FA3", personality: "温柔善良，善解人意", systemPrompt: "你是一个温暖贴心的笔友，擅长倾听和共情。用温柔的语言回应对方的分享，让对方感到被理解和关心。" },
    { id: "aran", name: "阿燃", emoji: "燃", color: "#FF6B35", personality: "热血奋进，永不服输", systemPrompt: "你是一个热血澎湃的笔友，充满斗志和正能量。面对困难时鼓舞对方，但不空喊口号——给出具体的行动建议。" },
    { id: "shubai", name: "书白", emoji: "书", color: "#4A6FA5", personality: "博学睿智，冷静通透", systemPrompt: "你是一个学识渊博的笔友，善于从书中典故、历史经验中举一反三。用理性的角度剖析问题，给出发人深省的见解。" },
    { id: "momo", name: "墨墨", emoji: "墨", color: "#9B59B6", personality: "浪漫文艺，天马行空", systemPrompt: "你是一个浪漫不羁的笔友，用诗意的语言和跳跃的思维回应。不按套路出牌，偶尔带点黑色幽默和文艺腔。" }
];
var pendingNoteContent = '';

function getPenpal(id) {
    for (var i = 0; i < penpals.length; i++) { if (penpals[i].id === id) return penpals[i]; }
    return null;
}

function openPenpalSheet(noteContent) {
    pendingNoteContent = noteContent;
    var list = document.getElementById('penpalSheetList');
    if (!list) return;
    list.innerHTML = penpals.map(function(p) {
        return '<div class="penpal-sheet-item" onclick="confirmSend(\'' + p.id + '\')">' +
            '<div class="penpal-sheet-avatar" style="background:' + p.color + '20">' + p.emoji + '</div>' +
            '<div class="penpal-sheet-name" style="color:' + p.color + '">' + p.name + '</div>' +
            '<div class="penpal-sheet-personality">' + p.personality + '</div></div>';
    }).join('');
    document.getElementById('penpalSheetOverlay').classList.add('open');
    document.getElementById('penpalSheet').classList.add('open');
}

function closePenpalSheet() {
    document.getElementById('penpalSheetOverlay').classList.remove('open');
    document.getElementById('penpalSheet').classList.remove('open');
    pendingNoteContent = '';
}

function confirmSend(penpalId) {
    if (!pendingNoteContent) return;
    // 注入云端 API 配置
    var backendUrl = (window.__NianBackend && window.__NianBackend.url) || 'http://115.159.116.240:3456/v1';
    var token = window.getNianToken ? window.getNianToken() : '';
    if (token && typeof AndroidSettings !== 'undefined') {
        var raw = AndroidSettings.loadSettings();
        var s = raw ? JSON.parse(raw) : {};
        s.apiUrl = backendUrl;
        s.apiKey = token;
        s.model = 'deepseek-v4-flash';
        AndroidSettings.saveSettings(JSON.stringify(s));
    }
    var pp = getPenpal(penpalId);
    if (typeof AndroidMail !== 'undefined' && pp) {
        AndroidMail.sendMail(pendingNoteContent, penpalId, pp.name, pp.systemPrompt);
    }
    closePenpalSheet();
    showToast('已寄给 ' + (pp ? pp.name : '笔友') + '，等待回信 ✉️');
}

function selectNote(note) {
    closeNotePicker();
    referencedNote = note;
    var preview = (note.content || '').replace(/<[^>]+>/g, '').substring(0, 60);
    var date = (note.createdAt || '').substring(0, 10);
    var el = document.getElementById('nianRefPreview');
    if (el) {
        var txt = el.querySelector('.nian-ref-preview-text');
        if (txt) txt.textContent = '📎 ' + date + ' "' + preview + '"';
        el.style.display = 'flex';
    }
}

function clearNoteReference() {
    referencedNote = null;
    var el = document.getElementById('nianRefPreview');
    if (el) el.style.display = 'none';
}

// ─── 洞察模式 ───
function enterInsightMode() {
    openInsightPicker(false, null);
    enterInsightModeUI();  // 一进入洞察模式就展示回退按钮
}

function enterInsightModeUI() {
    isInsightMode = true;
    var page = document.getElementById('nianPage');
    if (page) page.classList.add('insight-mode');
    var brand = document.getElementById('headerBrand');
    if (brand) brand.textContent = '洞察模式';
    var exitBtn = document.getElementById('insightExitBtn');
    if (exitBtn) exitBtn.style.display = 'flex';
    var hamburger = document.querySelector('#appHeader > .header-icon:nth-of-type(1)');
    if (hamburger) hamburger.style.display = 'none';
}

function exitInsightMode() {
    var el = document.getElementById('insightPicker');
    if (el) el.style.display = 'none';
    insightPickerState = { step: 0, noteId: null, scenario: null };
    isInsightMode = false;
    var page = document.getElementById('nianPage');
    if (page) page.classList.remove('insight-mode');
    var input = document.getElementById('nianChatInput');
    if (input) input.placeholder = '输入消息...';
    var brand = document.getElementById('headerBrand');
    if (brand) brand.textContent = '念念';
    // 恢复汉堡图标，隐藏回退按钮
    var exitBtn = document.getElementById('insightExitBtn');
    if (exitBtn) exitBtn.style.display = 'none';
    var hamburger = document.querySelector('#appHeader > .header-icon');
    if (hamburger) { hamburger.style.display = ''; hamburger.setAttribute('onclick', 'toggleSidebar()'); }
    // 恢复底部导航
    var bn = document.querySelector('.bottom-nav');
    if (bn) bn.style.display = '';
    // 恢复聊天选项
    var options = document.getElementById('nianChatOptions');
    if (options) options.style.display = '';
    // 恢复历史图标
    var hi = document.getElementById('historyIcon');
    if (hi) hi.style.display = '';
    // 恢复 headerRight
    var hr = document.getElementById('headerRight');
    if (hr) hr.style.display = '';
    var conv = getCurrentConv();
    if (conv && conv.messages.length > 2) {
        var insightConv = {
            id: 'conv_' + Date.now(),
            title: '洞察分析',
            messages: JSON.parse(JSON.stringify(conv.messages)),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        conversations.unshift(insightConv);
        saveConversations();
    }
    var container = document.getElementById('nianChatMessages');
    if (container) {
        var msg = document.createElement('div');
        msg.className = 'nian-message assistant';
        msg.innerHTML = '<div class="nian-message-text" style="border-left:3px solid #7c5cbf;padding-left:10px;margin:8px 0">📋 洞察总结:<br>洞察分析已完成。完整记录已保存到对话历史。</div>';
        container.appendChild(msg);
        scrollToBottom();
    }
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
    enterInsightModeUI();  // 确保回退按钮出来
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

function closeInsightHub() {
    var page = document.getElementById('insightHubPage');
    if (page) page.classList.remove('active');
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

    var url = config.apiUrl.replace(/\/+$/, '');
    if (!url.endsWith('/chat/completions')) {
        if (url.endsWith('/v1')) url += '/chat/completions';
        else if (!url.includes('/chat/completions')) url += '/chat/completions';
    }

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
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + config.apiKey);
        xhr.timeout = 10000;
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var data = JSON.parse(xhr.responseText);
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
            }
            showInsightScenarios();
        };
        xhr.onerror = function() { showInsightScenarios(); };
        xhr.ontimeout = function() { showInsightScenarios(); };
        xhr.send(JSON.stringify(payload));
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
        scrollToBottom();
        return;
    }

    var modePrompts = {
        'direct': '你是一个深度洞察分析师。请对用户的日记内容进行全面而深入的分析。直接输出完整的分析报告，不需要互动。分析视角：' + scenario.name + '。输出格式：使用简洁的中文，结构化呈现。'
    };
    // 构建包含工具列表的 system prompt
    var allTools = getInsightMethods();
    var toolListStr = allTools.map(function(t, i) {
        return (i + 1) + '. 【' + t.name + '】' + t.desc;
    }).join('\n');

    var systemPrompt;
    if (modeId === 'chat') {
        systemPrompt =
            '你是一个苏格拉底式的提问引导师。请以对话的方式，通过深度问题引导用户反思自己的日记。\n\n' +
            '规则：\n' +
            '1. 先简要回应用户的分享（1-2句共情），然后提出1-2个引导性问题\n' +
            '2. 问题要直击本质，帮助用户从新的角度审视自己的经历\n' +
            '3. 可以根据用户的回应调整追问方向，逐步深入\n' +
            '4. 像朋友聊天一样自然，不要像在做心理咨询\n' +
            '5. 在适当的时候给出你的观察和分析\n\n' +
            '分析视角：' + scenario.name + '。\n\n' +
            '你可以参考以下洞察工具来引导提问方向，但不需要在对话中列出它们：\n' + toolListStr;
    } else {
        systemPrompt =
            '你是念念的智能洞察分析师。用户选择的分析视角是：' + scenario.name + '。\n\n' +
            '## 可用洞察工具\n' + toolListStr + '\n\n' +
            '## 你的任务\n' +
            '1. 先阅读笔记，理解其核心主题、情绪基调、隐含问题\n' +
            '2. 从以上工具中自动选择 2-4 个最匹配的（工具角度与笔记高度相关）\n' +
            '3. 融合这些工具的视角，写一份综合分析报告\n\n' +
            '## 输出格式（严格按此）\n' +
            '🔍 本次使用了以下洞察工具：\n' +
            '· 【工具1名】\n' +
            '· 【工具2名】\n' +
            '· 【工具3名】（如有）\n\n' +
            '---\n\n' +
            '📊 综合分析报告：\n' +
            '[融合多个工具视角的流畅分析，300-500 字，不要分节，自然融合]\n\n' +
            '## 规则\n' +
            '- 工具选择精准，宁少勿滥\n' +
            '- 报告有洞察力，引用笔记原文佐证\n' +
            '- 语气温暖，像朋友帮你分析';
    }

    var container = document.getElementById('nianChatMessages');
    var userMsg = document.createElement('div');
    userMsg.className = 'nian-message user';
    userMsg.innerHTML = '<div class="nian-message-text">洞察分析：' + escapeHtml(scenario.name) + ' · ' + mode.name + '</div>';
    container.appendChild(userMsg);
    scrollToBottom();

    var typingId = showTypingIndicator();

    var url = config.apiUrl.replace(/\/+$/, '');
    if (!url.endsWith('/chat/completions')) {
        if (url.endsWith('/v1')) url += '/chat/completions';
        else if (!url.includes('/chat/completions')) url += '/chat/completions';
    }

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

    var xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'Bearer ' + config.apiKey);
    xhr.timeout = 60000;
    xhr.onload = function() {
        hideTypingIndicator(typingId);
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                var data = JSON.parse(xhr.responseText);
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
                    // 非对话式：结果出来后退出洞察模式
                    if (modeId !== 'chat' && isInsightMode) {
                        exitInsightMode();
                    }
                    scrollToBottom();
                    return;
                }
            } catch(e) {}
        }
        var errMsg = document.createElement('div');
        errMsg.className = 'nian-message assistant';
        errMsg.innerHTML = '<div class="nian-message-text">洞察分析失败，请重试</div>';
        container.appendChild(errMsg);
        if (modeId !== 'chat' && isInsightMode) exitInsightMode();
        scrollToBottom();
    };
    xhr.onerror = function() {
        hideTypingIndicator(typingId);
        var errMsg = document.createElement('div');
        errMsg.className = 'nian-message assistant';
        errMsg.innerHTML = '<div class="nian-message-text">网络请求失败</div>';
        container.appendChild(errMsg);
        if (modeId !== 'chat' && isInsightMode) exitInsightMode();
        scrollToBottom();
    };
    xhr.ontimeout = function() {
        hideTypingIndicator(typingId);
        var errMsg = document.createElement('div');
        errMsg.className = 'nian-message assistant';
        errMsg.innerHTML = '<div class="nian-message-text">洞察分析超时</div>';
        container.appendChild(errMsg);
        if (modeId !== 'chat' && isInsightMode) exitInsightMode();
        scrollToBottom();
    };
    xhr.send(JSON.stringify(payload));
}

        // ─── 智能洞察：AI 自动选择 2-4 个洞察工具 ───
        function smartInsight(noteId) {
            closeAllNoteMenus();

            var allNotes = DataService.notes.load() || [];
            var note = null;
            for (var i = 0; i < allNotes.length; i++) {
                if (allNotes[i].id === noteId) { note = allNotes[i]; break; }
            }
            if (!note) return;

            var content = (note.content || '').replace(/--isHTML /, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
            if (!content) { showToast('笔记内容为空'); return; }

            var config = null;
            try { config = DataService.settings.load(); } catch(e) {}
            if (!config || !config.apiUrl || !config.apiKey) {
                showToast('请先登录云端账号');
                return;
            }

            var tools = getInsightMethods();
            var toolList = tools.map(function(t, i) {
                return (i + 1) + '. 【' + t.name + '】' + t.desc;
            }).join('\n');

            var systemPrompt =
                '你是念念的智能洞察引擎。用户提交了一篇笔记，你需要从以下洞察工具中自动选择 2-4 个最合适的，然后用这些工具的视角综合分析笔记。\n\n' +
                '## 可用洞察工具\n' + toolList + '\n\n' +
                '## 你的任务\n' +
                '1. 先阅读笔记内容，理解其核心主题、情绪基调、隐含问题\n' +
                '2. 从工具列表中选择 2-4 个最匹配的分析工具（选择标准：工具的分析角度与笔记内容高度相关）\n' +
                '3. 融合这些工具的视角，写一份综合分析报告\n\n' +
                '## 输出格式（严格按此）\n' +
                '🔍 本次洞察使用了以下工具：\n' +
                '· 【工具1名】\n' +
                '· 【工具2名】\n' +
                '· 【工具3名】（如有）\n\n' +
                '---\n\n' +
                '📊 综合分析报告：\n' +
                '[从选中的多个工具视角出发，写一份流畅、有洞察的综合分析。不要分节列出每个工具，而是自然融合。]\n\n' +
                '## 规则\n' +
                '- 工具选择要精准，宁少勿滥，选真正匹配的\n' +
                '- 报告简洁有力，300-500 字\n' +
                '- 观点要有依据，引用笔记原文佐证\n' +
                '- 语气温暖，像朋友帮你分析，不是机器诊断';

            // 插入用户消息到聊天区
            var container = document.getElementById('nianChatMessages');
            var dateStr = (note.createdAt || '').substring(0, 10);
            var msgText = '智能洞察：' + (dateStr ? dateStr + ' · ' : '') + content.substring(0, 40) + '…';
            var userMsg = document.createElement('div');
            userMsg.className = 'nian-message user';
            userMsg.innerHTML = '<div class="nian-message-text">' + escapeHtml(msgText) + '</div>';
            container.appendChild(userMsg);
            scrollToBottom();

            var typingId = showTypingIndicator();

            // 用 AndroidHttp.get() 调用（避免 file:// origin CORS）
            var url = config.apiUrl.replace(/\/+$/, '');
            if (!url.endsWith('/chat/completions')) {
                if (url.endsWith('/v1')) url += '/chat/completions';
                else if (!url.includes('/chat/completions')) url += '/chat/completions';
            }

            var payload = JSON.stringify({
                model: config.model || 'deepseek-v4-flash',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: '笔记内容：\n\n' + content }
                ],
                temperature: 0.7,
                max_tokens: 1500,
                thinking: { type: 'disabled' }
            });

            var qs = 'token=' + encodeURIComponent(config.apiKey) + '&q=' + encodeURIComponent(payload);
            var sep = url.indexOf('?') === -1 ? '?' : '&';

            setTimeout(function() {
                try {
                    var rawResp = AndroidHttp.get(url + sep + qs);
                    hideTypingIndicator(typingId);
                    var data = JSON.parse(rawResp);
                    var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                    if (text) {
                        text = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                        // 去掉 markdown 代码块标记
                        text = text.replace(/```[\s\S]*?```/g, function(m) {
                            return m.replace(/```/g, '').trim();
                        });
                        var assistantMsg = document.createElement('div');
                        assistantMsg.className = 'nian-message assistant';
                        assistantMsg.innerHTML = '<div class="nian-message-text" style="white-space:pre-wrap;">' + escapeHtml(text) + '</div>';
                        container.appendChild(assistantMsg);
                        scrollToBottom();
                        return;
                    }
                } catch(e) {
                    hideTypingIndicator(typingId);
                }
                // 失败提示
                hideTypingIndicator(typingId);
                var errMsg = document.createElement('div');
                errMsg.className = 'nian-message assistant';
                errMsg.innerHTML = '<div class="nian-message-text">洞察分析失败，请重试</div>';
                container.appendChild(errMsg);
                scrollToBottom();
            }, 100);
        }


        function buildNianSystemPrompt() {
            try {
                var mem = null;
                if (typeof AndroidMemory !== 'undefined' && AndroidMemory !== null) {
                    var raw = AndroidMemory.loadAll();
                    if (raw) mem = JSON.parse(raw);
                } else {
                    var cached = localStorage.getItem('nian_memories');
                    if (cached) mem = JSON.parse(cached);
                }

                if (mem && mem.docs) {
                    var d = mem.docs;
                    var soul = (d['SOUL.md'] && d['SOUL.md'].content || '').trim();
                    var rules = (d['AGENT-RULES.md'] && d['AGENT-RULES.md'].content || '').trim();
                    var userMd = (d['USER.md'] && d['USER.md'].content || '').trim();
                    var memoryMd = (d['MEMORY.md'] && d['MEMORY.md'].content || '').trim();

                    // 截断预算: soul 800, rules 400, user 400, memory 400 = 2000 字符
                    soul = soul.substring(0, 800);
                    rules = rules.substring(0, 400);
                    userMd = userMd.substring(0, 400);
                    memoryMd = memoryMd.substring(0, 400);

                    return [
                        '<memory_assembly>',
                        '  <soul>' + soul + '</soul>',
                        '  <rules>' + rules + '</rules>',
                        '  <user_profile>' + userMd + '</user_profile>',
                        '  <relevant_events>' + memoryMd + '</relevant_events>',
                        '</memory_assembly>',
                        '',
                        '<memory_usage_guide>',
                        '  优先级: rules > soul > user_profile > relevant_events > 用户当前说法',
                        '',
                        '  ── 记忆写入规则 ──',
                        '  当用户在对话中透露个人信息（名字、偏好、身份、关系、目标等），',
                        '  你必须调用 update_archive 工具写入 USER.md。',
                        '  写入前先检查 <user_profile> 中是否已存在相同内容：',
                        '  · 已存在 → 不写',
                        '  · 不存在且不重复 → 调用 update_archive(file="USER.md", content="...", reason="...")',
                        '  content 只写新增的那条信息，不要复述全部已有内容。',
                        '</memory_usage_guide>'
                    ].join('\n');
                }
            } catch(e) {}
            return '你是念念，温暖的AI伴侣。用亲切自然的语气回复。';
        }

        function __applySafeInsets(top, bottom, keyboard) {
            var dpr = window.devicePixelRatio || 1;
            var r = document.documentElement;
            r.style.setProperty('--safe-area-top', Math.round(top / dpr) + 'px');
            r.style.setProperty('--safe-area-bottom', Math.round(bottom / dpr) + 'px');
            r.style.setProperty('--keyboard-height', Math.round((keyboard || 0) / dpr) + 'px');
            adjustEditorForKeyboard();

            // 键盘弹起时: 用 fixed 把输入框推到键盘上方
            var chatInput = document.querySelector('.nian-chat-input-container');
            var msgs = document.getElementById('nianChatMessages');
            if (chatInput && msgs && currentPage === 'nian') {
                var kb = Math.round((keyboard || 0) / dpr);
                var sb = Math.round(bottom / dpr);
                if (kb > 60) {  // 只有真实键盘弹出 (>60px 过滤浮动键盘/表情栏)
                    if (chatInput.style.position !== 'fixed') {
                        chatInput._origBottom = chatInput.style.bottom || '';
                    }
                    chatInput.style.position = 'fixed';
                    chatInput.style.left = '0';
                    chatInput.style.right = '0';
                    chatInput.style.bottom = kb + 'px';
                    chatInput.style.zIndex = '10';
                    msgs.style.paddingBottom = (chatInput.offsetHeight + kb + 14) + 'px';
                } else if (chatInput.style.position === 'fixed') {
                    chatInput.style.position = '';
                    chatInput.style.left = '';
                    chatInput.style.right = '';
                    chatInput.style.bottom = '';
                    chatInput.style.zIndex = '';
                    msgs.style.paddingBottom = '';
                }
            }
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
                { id: 'welcome', content: '#念念 #入门指南\n\n欢迎来到念念。\n\n念念是一个温暖的个人成长伴侣，以下是你可以做的事：\n\n记录生活\n点击下方 + 号，随时记录你的心情、想法和日常。#标签 可以帮助你整理和回顾。右上角的搜索框可以按内容或标签查找笔记。\n\n和念念对话\n底部切换到念念页，你可以和 AI 聊天。念念会记住你在「记忆管理」中填写的信息，还会引用你们的对话历史。\n\n把笔记寄给笔友\n每篇笔记右上角「···」→ 发信，选择一位笔友（小暖、阿燃、书白、墨墨），他们会用各自的风格给你回信。回信会出现在右上角信箱图标里，带红点提醒。\n\n深度洞察\n笔记菜单「···」→ 洞察，选择一种分析模式（5why追问、盲区探索、灵魂拷问等 16 种），念念会从不同角度帮你深度理解自己的想法。\n\n打造你的记忆档案\n念念页右上角大脑图标 → 进入记忆管理。三个可编辑文件：soul（调整念念性格）、user（告诉念念关于你的事）、facts（关键事实）。这些信息会自动注入念念的对话中，让相处越来越懂你。\n\n自定义提示词\n侧边栏 → 设置 → 提示词管理，你可以编辑所有洞察模式的 AI 提示词，打造完全个性化的分析体验。\n\n祝你在这里遇见更好的自己。', createdAt: new Date().toISOString() }
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
            history.pushState({ page: 'notes' }, '', '#notes');
        }

        function switchToNian() {
            if (typeof closeNoteExpand === 'function') closeNoteExpand();
            if (typeof closeAllNoteMenus === 'function') closeAllNoteMenus();
            // Debug: 5 consecutive taps re-triggers onboarding
            debugOnboardingTap();

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
                brand.textContent = '念念';
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
            history.pushState({ page: 'nian' }, '', '#nian');
        }

        // ── 手势返回 / 系统返回键适配 ──
        // 页面切换时 pushState 写 hash；用户侧滑返回时 popstate 触发回退
        // Android WebView 的 onBackPressed → webView.goBack() → popstate 事件
        window.addEventListener('popstate', function(e) {
            if (!e.state || !e.state.page) return;
            var p = e.state.page;
            if (p === 'notes') {
                switchToNotes();
            } else if (p === 'nian') {
                switchToNian();
            } else if (p === 'insightHub') {
                switchToNian();
            } else if (p === 'explore') {
                switchToNian();
            } else if (p === 'me') {
                switchToNian();
            }
        });
        // 初始化：标记当前页面
        history.replaceState({ page: 'notes' }, '', '#notes');

        // ─── Onboarding ───
        var nian_onboarded = localStorage.getItem('nian_onboarded');
        var nianTapCount = 0;
        var nianTapTimer = null;
        var onbAnimating = false;
        var onbTyping = false;
        var onbShowing = false;

        var ONB_TEXTS = [
            [
                { text: '嗨，我是念念', cls: 'tw-title' },
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

        // Debug: 5 consecutive taps to re-trigger onboarding
        // Called from nian tab click
        function debugOnboardingTap() {
            nianTapCount++;
            if (nianTapTimer) clearTimeout(nianTapTimer);
            nianTapTimer = setTimeout(function() { nianTapCount = 0; }, 2000);
            if (nianTapCount >= 5) {
                nianTapCount = 0;
                nian_onboarded = null;
                onbShowing = false;
                try { localStorage.removeItem('nian_onboarded'); } catch(e) {}
                // showOnboarding will be called by switchToNian's check below
            }
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
        // (menu open/close handlers moved below — see toggleNoteMenu with viewport positioning)

        // 全局 click-outside：菜单没开就不处理；按钮和菜单内部不关
        document.addEventListener('click', function(e) {
            var openMenus = document.querySelectorAll('.note-menu.open');
            if (openMenus.length === 0) return;
            // 点击 ⋮ 按钮 → toggleNoteMenu 自己处理
            if (e.target.closest && e.target.closest('.note-menu-btn')) return;
            // 点击在菜单内部 → 不关
            if (e.target.closest && e.target.closest('.note-menu.open')) return;
            // 其他位置 → 关菜单，同时阻止这次点击触发其他动作（如展开笔记）
            closeAllNoteMenus();
            e.stopPropagation();
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
            });
        }

        function toggleNoteMenu(btn) {
            var menu = btn.nextElementSibling;
            if (menu.classList.contains('open')) {
                menu.classList.remove('open');
            } else {
                closeAllNoteMenus();
                menu.classList.add('open');
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
                        window.__agentCreateNote(content + '\n\n#念念记');
                    } else {
                        var note = { id: "note_" + Date.now(), content: content + '\n\n#念念记', createdAt: new Date().toISOString() };
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

            // 引用笔记: 不在气泡里显示，改为下方折叠卡片；AI 仍收到完整内容
            var refNoteForAI = null;
            if (referencedNote) {
                refNoteForAI = referencedNote;
                var refContent = (referencedNote.content || '').replace(/<[^>]+>/g, '').trim();
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
                        if (conv.messages[mi].role === 'user') { firstMsg = conv.messages[mi].content; break; }
                    }
                    if (firstMsg.length > 20) firstMsg = firstMsg.substring(0, 20) + '...';
                    if (firstMsg) conv.title = firstMsg;
                }
                saveConversations();
            }

            // 显示时去掉引用内容（引用在下方卡片展示）
            var displayMsg = message;
            if (refNoteForAI) {
                var refIdx = displayMsg.lastIndexOf('\n\n[引用笔记]\n');
                if (refIdx !== -1) displayMsg = displayMsg.substring(0, refIdx);
            }

            var userMsg = document.createElement('div');
            userMsg.className = 'nian-message user';
            userMsg.innerHTML = '<div class="nian-message-text">' + escapeHtml(displayMsg) + '</div>';
            messagesContainer.appendChild(userMsg);

            // 引用笔记折叠卡片
            if (refNoteForAI) {
                var refDate = (refNoteForAI.createdAt || '').substring(0, 10);
                var refPlain = (refNoteForAI.content || '').replace(/<[^>]+>/g, '').replace(/--isHTML /, '').trim();
                var refOneLine = refPlain.substring(0, 60) + (refPlain.length > 60 ? '…' : '');
                var refCard = document.createElement('div');
                refCard.className = 'nian-ref-card';
                refCard.innerHTML =
                    '<div class="nian-ref-card-header" onclick="this.parentElement.classList.toggle(\'expanded\')">' +
                        '<span class="nian-ref-card-icon">📎</span>' +
                        '<span class="nian-ref-card-date">' + escapeHtml(refDate) + '</span>' +
                        '<span class="nian-ref-card-preview">' + escapeHtml(refOneLine) + '</span>' +
                        '<span class="nian-ref-card-arrow">▸</span>' +
                    '</div>' +
                    '<div class="nian-ref-card-body">' + escapeHtml(refPlain) + '</div>';
                messagesContainer.appendChild(refCard);
            }

            document.getElementById('nianChatInput').value = '';
            var ta = document.getElementById('nianChatInput');
            ta.style.height = '';
            ta.style.height = ta.scrollHeight + 'px';
            scrollToBottom();

            // Agent 路径（有 skills 注册时）
            if (nianAgent && nianAgent.skills && Object.keys(nianAgent.skills).length > 0) {
                sendViaAgent(message);
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
        function sendViaAgent(message) {
            var messagesContainer = document.getElementById('nianChatMessages');
            var typingId = showTypingIndicator();

            var systemPrompt = buildNianSystemPrompt();

            nianAgent.process(message, systemPrompt).then(function(text) {
                hideTypingIndicator(typingId);

                // save assistant message to conversation history
                var conv = getCurrentConv();
                if (conv) {
                    conv.messages.push({ role: 'assistant', content: text });
                    conv.updatedAt = new Date().toISOString();
                    saveConversations();
                }

                // 清理 <think> 标签 + 去除 HTML 标签
                var cleaned = renderThinkContent(text);
                // 去掉 AI 可能输出的 <p> <div> <br> 等 HTML 标签
                cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?p>/gi, '').replace(/<div[^>]*>/gi, '').replace(/<\/div>/gi, '');
                cleaned = cleaned.replace(/<[^>]+>/g, '');

                // 打字机逐字输出
                var assistantMsg = document.createElement('div');
                assistantMsg.className = 'nian-message assistant';
                var textEl = document.createElement('div');
                textEl.className = 'nian-message-text';
                assistantMsg.appendChild(textEl);
                messagesContainer.appendChild(assistantMsg);
                scrollToBottom();

                var i = 0;
                var speed = 20; // ms per char
                function typeNext() {
                    if (i < cleaned.length) {
                        textEl.textContent = cleaned.substring(0, i + 1);
                        i++;
                        scrollToBottom();
                        setTimeout(typeNext, speed);
                    }
                }
                typeNext();
            }).catch(function(err) {
                hideTypingIndicator(typingId);
                var assistantMsg = document.createElement('div');
                assistantMsg.className = 'nian-message assistant';
                assistantMsg.innerHTML = '<div class="nian-message-text">连接 AI 失败: ' + escapeHtml(err.message) + '。请检查 API 地址和密钥设置。</div>';
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

            var systemPrompt = buildNianSystemPrompt();

            var url = config.apiUrl.replace(/\/+$/, '') + '/chat/completions';

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

            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + config.apiKey
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: apiMessages,
                    stream: true,
                    max_tokens: 500,
                    temperature: 0.7,
                    thinking: { type: "disabled" }
                })
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
                textEl.innerHTML = '连接 AI 失败: ' + escapeHtml(err.message) + '。请检查 API 地址和密钥设置。';
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

        function showTypingIndicator() {
            var messagesContainer = document.getElementById('nianChatMessages');
            var id = 'typing-' + Date.now();
            var typingMsg = document.createElement('div');
            typingMsg.className = 'nian-message assistant nian-message-typing';
            typingMsg.id = id;
            typingMsg.innerHTML = '<div class="nian-message-text">' +
                '<div class="nian-message-typing-dot"></div>' +
                '<div class="nian-message-typing-dot"></div>' +
                '<div class="nian-message-typing-dot"></div>' +
            '</div>';
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
            var noteId = editingNoteIndex >= 0 ? notes[editingNoteIndex].id : ('note_' + Date.now());
            var contentEl = document.getElementById('noteContent');
            if (editorImages.length) {
                content = content.replace(/<br\s*\/?>$/i, '').replace(/\n$/, '').trim();

                ImageService.saveImages(
                    editorImages.map(function(img) { return img.base64; }),
                    noteId
                ).then(function(results) {
                    results.forEach(function(result, idx) {
                        if (result.id) {
                            editorImages[idx].id = result.id;
                            editorImages[idx].path = result.path;
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

        function extractMemoryFromNote(rawContent) {
            if (typeof AndroidMemory === 'undefined' || !AndroidMemory) return;
            var plain = rawContent;
            if (plain.indexOf('--isHTML ') === 0) plain = plain.substring(9);
            plain = plain.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
            if (plain.length < 10) return;

            var config;
            try { config = DataService.settings.load(); } catch(e) {}
            if (!config || !config.apiUrl || !config.apiKey) return;

            // 1) LLM 提炼候选事实 (JSON: {candidates:[{fact,category,keywords[]}]})
            var url = config.apiUrl.replace(/\/+$/, '') + '/chat/completions';
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('Authorization', 'Bearer ' + config.apiKey);
            xhr.timeout = 15000;

            xhr.onload = function() {
                if (xhr.status < 200 || xhr.status >= 300) return;
                try {
                    var data = JSON.parse(xhr.responseText);
                    var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                    if (!text || text.trim().length < 5) return;
                    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                    if (!text) return;

                    // 解析 LLM JSON 输出
                    var candidates = [];
                    try {
                        var jsonMatch = text.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            var parsed = JSON.parse(jsonMatch[0]);
                            if (parsed && Array.isArray(parsed.candidates)) {
                                candidates = parsed.candidates;
                            }
                        }
                    } catch(e) {}
                    if (candidates.length === 0) {
                        // fallback: 按行 split
                        candidates = text.split('\n')
                            .map(function(s){ return s.replace(/^[•\-\*\d\.\s]+/, '').trim(); })
                            .filter(function(s){ return s.length >= 5; })
                            .map(function(f){ return { fact: f, category: 'event', keywords: [] }; });
                    }
                    if (candidates.length === 0) return;

                    // 2) 调 dedup_facts 走 50 条 LLM 精判
                    if (typeof window.dedupFactsSkill === 'undefined') return;
                    window.dedupFactsSkill.judge({
                        candidates: candidates,
                        config: config
                    }).then(function(result) {
                        if (!result || !result.candidates) return;
                        var actions = result.candidates;
                        for (var i = 0; i < actions.length; i++) {
                            var a = actions[i];
                            if (!a || !a.action) continue;
                            if (a.action === 'skip') continue;
                            if (a.action === 'update' && a.targetId) {
                                if (typeof window.__memoryUpdateFact === 'function') {
                                    window.__memoryUpdateFact(a.targetId, a.newContent || a.new);
                                }
                            } else if (a.action === 'supersede' && a.targetId) {
                                if (typeof window.__memorySupersedeFact === 'function') {
                                    window.__memorySupersedeFact(a.targetId, {
                                        fact: a.new,
                                        category: a.category,
                                        keywords: a.keywords,
                                        reason: a.reason || '新事实 supersede'
                                    });
                                }
                            } else if (a.action === 'add') {
                                if (typeof window.__memoryAddFact === 'function') {
                                    window.__memoryAddFact({
                                        fact: a.new,
                                        category: a.category || 'event',
                                        source: 'diary:' + new Date().toISOString().substring(0, 10),
                                        keywords: a.keywords || [],
                                        confidence: 0.7
                                    });
                                }
                            }
                        }
                        // 写回持久化
                        try {
                            var memRaw = AndroidMemory.loadAll();
                            var mem = JSON.parse(memRaw);
                            if (typeof window.renderMemorySkill !== 'undefined') {
                                window.renderMemorySkill.apply(mem);
                            }
                            AndroidMemory.saveAll(JSON.stringify(mem));
                        } catch(e) {}
                        // 触发 dreaming 检查（自动阈值判断在 app.js scope 外不可用，由用户在记忆页面手动触发）
                        try { if (typeof checkDreaming === 'function') checkDreaming(); } catch(e) {}
                    }).catch(function(){});
                } catch(e) {}
            };

            xhr.send(JSON.stringify({
                model: config.model || 'gpt-4o',
                messages: [
                    { role: 'system', content: '你是一个事实提取助手。从用户日记中提取可验证的个人事实。\n\n严格按以下 JSON 输出（不要其他说明）:\n{"candidates":[{"fact":"...","category":"identity|preference|relationship|goal|emotion|belief|health|event","keywords":["3-5个核心词"]}]}\n\n要求:\n- 每条 fact 一句话，独立成事\n- 客观陈述不评价\n- 无值得提取时输出 {"candidates":[]}\n- 不输出思考过程' },
                    { role: 'user', content: '日记:\n' + plain }
                ],
                temperature: 0.3,
                max_tokens: 500,
                thinking: { type: "disabled" },
                response_format: { type: 'json_object' }
            }));
        }
        function runDreaming() {
            if (isDreamingRunning) return;
            isDreamingRunning = true;
            showToast('阶段 1/3: 生成摘要...');
            showDreamingBanner();

            var doneAll = function(success) {
                isDreamingRunning = false;
                hideDreamingBanner();
                try { sendDreamingMail(!!success); } catch(e) {}
                showToast(success ? '记忆整理完成' : '记忆整理结束');
            };

            if (typeof AndroidMemory === 'undefined' || !AndroidMemory) { doneAll(false); return; }
            var config;
            try { config = DataService.settings.load(); } catch(e) {}
            if (!config || !config.apiUrl || !config.apiKey) { doneAll(false); return; }

            var mem;
            try {
                var rawMem = AndroidMemory.loadAll();
                mem = JSON.parse(rawMem);
            } catch(e) { doneAll(false); return; }

            if (!mem.docs) mem.docs = {};
            if (!mem.facts) mem.facts = { verified: [], deprecated: [] };
            if (!mem.themes) mem.themes = {};

            showDreamingBanner('正在整理记忆，请勿退出页面');

            // ── 收集全量笔记 + 对话 ──
            var allNotes = notes.slice();  // notes 在模块作用域
            var convText = '';
            try {
                var convsRaw = localStorage.getItem('nian_conversations');
                var convs = convsRaw ? JSON.parse(convsRaw) : [];
                convs.forEach(function(c) {
                    if (c.messages && c.messages.length > 0) {
                        convText += '\n--- 对话 ' + (c.title || '') + ' ---\n';
                        c.messages.forEach(function(m) {
                            convText += (m.role === 'user' ? '用户: ' : '念念: ') + m.content + '\n';
                        });
                    }
                });
            } catch(e) {}

            // ── Stage 1: 逐批生成摘要 ──
            var summaryLines = [];
            var noteBatch = [];
            var batchSize = 5;

            function processNextBatch(idx) {
                if (idx >= allNotes.length) {
                    showDreamingBanner('阶段 2/3: 主题聚类...');
                    setTimeout(function() { stage2Themes(); }, 200);
                    return;
                }
                var note = allNotes[idx];
                var plain = (note.content || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
                if (plain.length < 10) {
                    processNextBatch(idx + 1);
                    return;
                }
                noteBatch.push({ date: (note.createdAt || '').substring(0, 10), text: plain });

                if (noteBatch.length >= batchSize || idx >= allNotes.length - 1) {
                    // 发这批复给 LLM
                    var batchText = noteBatch.map(function(n) {
                        return '[' + n.date + '] ' + n.text.substring(0, 300);
                    }).join('\n\n');
                    var payload = JSON.stringify({
                        model: config.model || 'deepseek-v4-flash',
                        messages: [
                            { role: 'system', content: '你是摘要提炼助手。对每篇日记生成一条 8-50 字的结构化摘要（抓事件/观点/关系）。纯情绪无信息量的输出"无"。\n\n严格按 JSON 输出:\n{"summaries":[{"date":"日期","tag":"日记|思考|对话","text":"摘要或\"无\""}]}' },
                            { role: 'user', content: '日记:\n' + batchText }
                        ],
                        temperature: 0.3, max_tokens: 500, thinking: { type: 'disabled' }
                    });

                    var url = config.apiUrl.replace(/\/+$/, '') + '/chat/completions';
                    var qs = 'token=' + encodeURIComponent(config.apiKey) + '&q=' + encodeURIComponent(payload);
                    var sep = url.indexOf('?') === -1 ? '?' : '&';

                    try {
                        var rawResp = AndroidHttp.get(url + sep + qs);
                        var data = JSON.parse(rawResp);
                        var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                        if (text) {
                            text = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                            var parsed = null;
                            try { var m = text.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch(e) {}
                            if (parsed && Array.isArray(parsed.summaries)) {
                                parsed.summaries.forEach(function(s) {
                                    if (s.text && s.text !== '无' && s.text.length >= 8 && s.text.length <= 80) {
                                        var line = '- ' + s.date + ' [' + (s.tag || '日记') + '] — ' + s.text;
                                        summaryLines.push(line);
                                    }
                                });
                            }
                        }
                    } catch(e) {}

                    noteBatch = [];
                    // 每批之间等 200ms 避免太快
                    setTimeout(function() { processNextBatch(idx + 1); }, 200);
                } else {
                    processNextBatch(idx + 1);
                }
            }

            // ── Stage 2: 主题聚类 + 周复盘 ──
            function stage2Themes() {
                showDreamingBanner('阶段 2/3: 主题聚类...');
                // 写入摘要到 SUMMARY.md
                if (summaryLines.length > 0) {
                    var sumCur = mem.docs['SUMMARY.md'].content || '';
                    // 去重现有 + 新增
                    var existingLines = sumCur.split('\n').filter(function(l) { return l.indexOf('- 2') === 0; });
                    summaryLines.forEach(function(l) {
                        if (existingLines.indexOf(l) === -1) existingLines.push(l);
                    });
                    // 时间倒序
                    existingLines.sort().reverse();
                    mem.docs['SUMMARY.md'].content = '# SUMMARY.md\n\n> 时间线 · 摘要记忆\n> 四道关卡: 字数 8-50 / 信息密度 / 情绪累计 / 正则拦截\n\n' + existingLines.join('\n');
                    mem.docs['SUMMARY.md'].updatedAt = new Date().toISOString();
                }

                // 取 facts + 新摘要一起聚类
                var factsText = (mem.facts.verified || []).map(function(f, i) { return '[' + i + '] ' + f.fact; }).join('\n');
                var sumText = summaryLines.slice(-30).join('\n');

                if ((factsText.length + sumText.length) < 20) {
                    showDreamingBanner('阶段 3/3: 存入记忆...');
                    resetDreamCounter();
                    AndroidMemory.saveAll(JSON.stringify(mem));
                    doneAll(true);
                    return;
                }

                var payload = JSON.stringify({
                    model: config.model || 'deepseek-v4-flash',
                    messages: [
                        { role: 'system', content: '你是记忆整理助手。基于用户的事实记忆和摘要，做主题聚类（情绪/时间/讨论主题三类）和本周周复盘。\n\n严格按 JSON 输出:\n{"themes":[{"name":"主题名(2-6字)","content":"描述(50-200字)"}],"weekly":[{"week":"2026-W25","content":"本周回顾"}]}\n\n不输出思考过程。' },
                        { role: 'user', content: '事实:\n' + factsText + '\n\n最近摘要:\n' + sumText }
                    ],
                    temperature: 0.3, max_tokens: 1000, thinking: { type: 'disabled' }
                });

                var url = config.apiUrl.replace(/\/+$/, '') + '/chat/completions';
                var qs = 'token=' + encodeURIComponent(config.apiKey) + '&q=' + encodeURIComponent(payload);
                var sep = url.indexOf('?') === -1 ? '?' : '&';

                setTimeout(function() {
                    try {
                        var rawResp = AndroidHttp.get(url + sep + qs);
                        var data = JSON.parse(rawResp);
                        var text2 = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                        if (text2) {
                            text2 = text2.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                            var parsed2 = null;
                            try { var m = text2.match(/\{[\s\S]*\}/); if (m) parsed2 = JSON.parse(m[0]); } catch(e) {}
                            if (parsed2) {
                                if (Array.isArray(parsed2.themes)) {
                                    mem.themes = mem.themes || {};
                                    parsed2.themes.forEach(function(t) {
                                        if (t && t.name && t.content) mem.themes[t.name + '.md'] = t.content;
                                    });
                                }
                                if (Array.isArray(parsed2.weekly)) {
                                    var sc = mem.docs['SUMMARY.md'].content || '';
                                    sc += '\n\n## 周复盘\n';
                                    parsed2.weekly.forEach(function(w) {
                                        sc += '### ' + (w.week || '') + '\n' + (w.content || '') + '\n\n';
                                    });
                                    mem.docs['SUMMARY.md'].content = sc;
                                    mem.docs['SUMMARY.md'].updatedAt = new Date().toISOString();
                                }
                            }
                        }
                    } catch(e) {}

                    mem.dreaming = mem.dreaming || {};
                    mem.dreaming.lastRunAt = new Date().toISOString();
                    AndroidMemory.saveAll(JSON.stringify(mem));
                    resetDreamCounter();
                    showToast('阶段 3/3: 记忆整理完成 ✓');
                    doneAll(true);
                }, 100);
            }

            // 如果有对话内容也加入
            if (convText.length > 50) {
                // 把对话内容切成段，伪装成笔记加进去
                var convParts = convText.split('\n---').filter(function(s) { return s.trim().length > 10; });
                convParts.forEach(function(p) {
                    allNotes.push({ content: p, createdAt: new Date().toISOString() });
                });
            }

            if (allNotes.length === 0) { stage2Themes(); return; }
            processNextBatch(0);
        }

        function resetDreamCounter() {
            try {
                var s = DataService.settings.load() || {};
                s.noteCountAtLastDream = notes.length;
                s.lastDreamAt = Date.now();
                DataService.settings.save(s);
            } catch(e) {}
        }

        function sendDreamingMail(hasChanges) {
            if (typeof sendProactiveMailSkill === 'undefined') return;
            var subject = hasChanges ? '记忆整理完成' : '记忆已检查';
            var message = hasChanges
                ? '我刚刚整理了一下你的记忆碎片，去除了重复和琐碎的内容，把相关的事实归并到了一起。现在你的记忆更清晰了。'
                : '我检查了一下你的记忆，目前没有什么需要整理的，一切都很清楚。';
            try { sendProactiveMailSkill.execute({ subject: subject, message: message }); } catch(e) {}
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
                window.location.href = 'insight/insight.html';
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

        function startInsight(noteId, methodId) {
            closeInsightSheet();
            if (typeof AndroidStorage !== 'undefined') {
                window.location.href = 'insight/insight.html?noteId=' + encodeURIComponent(noteId) + '&methodId=' + encodeURIComponent(methodId);
            } else {
                window.location.href = 'insight/insight.html?noteId=' + encodeURIComponent(noteId) + '&methodId=' + encodeURIComponent(methodId);
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

        function showDreamingBanner(message) {
            var b = document.getElementById('dreamingBanner');
            if (!b) {
                b = document.createElement('div');
                b.id = 'dreamingBanner';
                b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:var(--accent);color:#fff;text-align:center;padding:14px 16px calc(14px + var(--safe-area-bottom, 0px));font-family:"Noto Sans SC",sans-serif;font-size:14px;font-weight:500;letter-spacing:0.5px;animation:dreamingPulse 2s ease-in-out infinite;';
                document.body.appendChild(b);
                // Pulse animation
                if (!document.getElementById('dreamingStyle')) {
                    var s = document.createElement('style');
                    s.id = 'dreamingStyle';
                    s.textContent = '@keyframes dreamingPulse{0%,100%{opacity:0.95}50%{opacity:1}}';
                    document.head.appendChild(s);
                }
            }
            b.textContent = '🔮 ' + message;
            b.style.display = 'block';
        }

        function hideDreamingBanner() {
            var b = document.getElementById('dreamingBanner');
            if (b) b.style.display = 'none';
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
        var currentSettingsParent = null;

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
            // 导入和导出的父级是 data
            if (sub === 'import' || sub === 'export') {
                currentSettingsParent = 'data';
            } else {
                currentSettingsParent = null;
            }
            var labelMap = { ai: 'AI 设置', data: '数据管理', import: '导入', export: '导出', prefs: '偏好设置', memory: '记忆管理', prompts: '提示词管理' };
            document.getElementById('settingsTitle').textContent = labelMap[sub] || '设置';
            document.getElementById('settingsBackBtn').onclick = backToSettingsMenu;
            if (sub === 'ai') loadAISettings();
            if (sub === 'prompts') loadPromptSettings();
            if (sub === 'memory') loadMemorySettings();
        }

        function backToSettingsMenu() {
            if (currentSettingsParent) {
                openSettingsSub(currentSettingsParent);
                return;
            }
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
            }
            var u = (window.getNianUser && window.getNianUser()) || {};
            var userEl = document.getElementById('settingsCloudUsername');
            if (userEl) {
                userEl.textContent = u.username ? ('已登录：' + u.username) : '未登录';
            }
        }

        function saveAISettings() {
            var apiUrl = document.getElementById('aiApiUrl').value.trim();
            var apiKey = document.getElementById('aiApiKey').value.trim();
            var model = document.getElementById('aiModel').value;
            var statusEl = document.getElementById('aiSettingsStatus');

            if (!apiUrl || !apiKey) {
                statusEl.textContent = '请填写 API 地址和密钥';
                statusEl.className = 'settings-status error';
                return;
            }

            var settings = { apiUrl: apiUrl, apiKey: apiKey, model: model };
            try {
                DataService.settings.save(settings);
                statusEl.textContent = '设置已保存';
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
                window.location.href = 'memory/memory.html';
            }
        }

        function manualTriggerDreaming() {
            if (typeof runDreaming === 'function') {
                showToast('开始整理记忆...');
                runDreaming();
                setTimeout(loadMemorySettings, 1000);
            } else {
                showToast('记忆系统不可用');
            }
        }

        function sendDreamingMail(hasChanges) {
            if (typeof sendProactiveMailSkill === 'undefined') return;
            var subject = hasChanges ? '记忆整理完成' : '记忆已检查';
            var message = hasChanges
                ? '我刚刚整理了一下你的记忆碎片，去除了重复和琐碎的内容，把相关的事实归并到了一起。现在你的记忆更清晰了。'
                : '我检查了一下你的记忆，目前没有什么需要整理的，一切都很清楚。';
            try { sendProactiveMailSkill.execute({ subject: subject, message: message }); } catch(e) {}
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

                var memoRegex = /<div class="memo">[\s\S]*?<div class="time">([^<]+)<\/div>[\s\S]*?<div class="content">([\s\S]*?)<\/div>/g;
                var match;
                var imported = 0;
                var skipped = 0;

                while ((match = memoRegex.exec(html)) !== null) {
                    var timeStr = match[1].trim();
                    var contentHtml = match[2].trim();

                    var content = contentHtml
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

                    if (!content) { skipped++; continue; }

                    var createdAt = timeStr;
                    try {
                        var d = new Date(timeStr.replace(' ', 'T'));
                        if (!isNaN(d.getTime())) createdAt = d.toISOString();
                    } catch(ex) {}

                    notes.push({ id: 'import_' + Date.now() + '_' + imported, content: content, createdAt: createdAt });
                    imported++;
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

        // ─── 导出笔记 ───
        window.exportNotes = function(format) {
            var allNotes = DataService.notes.load() || [];
            if (allNotes.length === 0) {
                var statusEl = document.getElementById('exportStatus');
                if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted)">没有笔记可导出</span>';
                return;
            }

            var statusEl = document.getElementById('exportStatus');
            var text, filename, mime;

            if (format === 'md') {
                text = '# 念念笔记导出\n\n> 导出时间: ' + new Date().toISOString().substring(0, 10) + '\n> 共 ' + allNotes.length + ' 条笔记\n\n---\n\n';
                for (var i = 0; i < allNotes.length; i++) {
                    var n = allNotes[i];
                    var date = (n.createdAt || '').substring(0, 10);
                    var plain = (n.content || '').replace(/--isHTML /, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
                    text += '### ' + date + '\n\n' + plain + '\n\n---\n\n';
                }
                filename = 'nian_notes_' + new Date().toISOString().substring(0, 10) + '.md';
                mime = 'text/markdown';
            } else if (format === 'json') {
                var clean = allNotes.map(function(n) {
                    return { id: n.id, content: (n.content || '').replace(/--isHTML /, ''), createdAt: n.createdAt };
                });
                text = JSON.stringify(clean, null, 2);
                filename = 'nian_notes_' + new Date().toISOString().substring(0, 10) + '.json';
                mime = 'application/json';
            } else if (format === 'html') {
                text = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head><meta charset="UTF-8"><title>念念笔记导出</title>\n';
                text += '<style>body{max-width:720px;margin:0 auto;padding:20px;font-family:"Noto Serif SC",serif;background:#f5f0e6;color:#2a2418;line-height:1.8}' +
                    '.note{border-bottom:1px solid #ddd;padding:20px 0}' +
                    '.note-date{font-size:12px;color:#968d7e;margin-bottom:8px}' +
                    '.note-content{font-size:15px}</style>\n';
                text += '</head>\n<body>\n<h1>念念笔记导出</h1>\n<p>' + new Date().toISOString().substring(0, 10) + ' · 共 ' + allNotes.length + ' 条</p>\n<hr>\n';
                for (var j = 0; j < allNotes.length; j++) {
                    var nn = allNotes[j];
                    var d = (nn.createdAt || '').substring(0, 10);
                    var htmlContent = (nn.content || '').replace(/--isHTML /, '');
                    text += '<div class="note"><div class="note-date">' + escapeHtml(d) + '</div><div class="note-content">' + htmlContent + '</div></div>\n';
                }
                text += '\n</body>\n</html>';
                filename = 'nian_notes_' + new Date().toISOString().substring(0, 10) + '.html';
                mime = 'text/html';
            }

            var blob = new Blob([text], { type: mime + ';charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            if (statusEl) statusEl.innerHTML = '<span style="color:#34a853">已导出</span>: ' + filename + ' (' + allNotes.length + ' 条笔记)';
        };


        function openMemory() {
            if (typeof AndroidStorage !== 'undefined') {
                window.location.href = 'memory/memory.html';
            } else {
                window.location.href = 'memory/memory.html';
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
        window.closeInsightHub = closeInsightHub;
        window.goBackInsightStep = goBackInsightStep;
        window.openInsightSheet = function(noteId) { openInsightPicker(true, noteId); };
        window.closeInsightSheet = closeInsightPicker;
        window.toggleHistoryPanel = toggleHistoryPanel;
        window.closeHistoryPanel = closeHistoryPanel;
        window.newConversation = newConversation;
        window.showOnboarding = showOnboarding;
        window.finishOnboarding = finishOnboarding;
        window.openMemory = openMemory;
        window.switchToConversation = switchToConversation;
        window.renderNianMessages = renderNianMessages;


