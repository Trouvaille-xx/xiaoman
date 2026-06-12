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
    var _d = localStorage.getItem('nian_notes');
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
};

var prompts = [];
var notes = [];
var selectedMethod = null;
var selectedNote = null;
var insightHistory = [];

function getPlainText(content) {
    if (content.indexOf('--isHTML ') === 0) content = content.substring(9);
    content = content.replace(/<img[^>]*>/g, '');
    content = content.replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '');
    content = content.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return content.replace(/!\[([^\]]*)\]\([^)]+\)/g, '').replace(/\n\n+/g, '\n').trim();
}

function init() {
    notes = DataService.notes.load();
    insightHistory = loadHistory();
    loadPrompts();

    var noteId = getUrlParam('noteId');
    var methodId = getUrlParam('methodId');
    if (noteId && methodId) {
        selectedMethod = prompts.find(function(p) { return p.id === methodId; });
        selectedNote = notes.find(function(n) { return n.id === noteId; });
        if (selectedMethod && selectedNote) {
            setTimeout(function() { generateInsight(); }, 100);
            return;
        }
    }
}

function getUrlParam(name) {
    var search = window.location.search.substring(1);
    var params = search.split('&');
    for (var i = 0; i < params.length; i++) {
        var pair = params[i].split('=');
        if (decodeURIComponent(pair[0]) === name) {
            return decodeURIComponent(pair[1] || '');
        }
    }
    return null;
}

function loadPrompts() {
    var stored = null;
    try {
        var hasBridge = (typeof AndroidSettings !== 'undefined' && AndroidSettings !== null);
        if (hasBridge) {
            var raw = AndroidSettings.loadSettings();
            if (raw) {
                var s = JSON.parse(raw);
                if (s && s.insightPrompts) {
                    stored = typeof s.insightPrompts === 'string' ? JSON.parse(s.insightPrompts) : s.insightPrompts;
                }
            }
        } else {
            var cached = localStorage.getItem('nian_settings');
            if (cached) {
                var s = JSON.parse(cached);
                if (s && s.insightPrompts) {
                    stored = typeof s.insightPrompts === 'string' ? JSON.parse(s.insightPrompts) : s.insightPrompts;
                }
            }
        }
    } catch(e) {}
    if (stored && Array.isArray(stored) && stored.length > 0) {
        prompts = stored.map(function(p) {
            return { id: p.id, name: p.name, systemPrompt: p.systemPrompt, desc: p.desc || '' };
        });
    } else {
        prompts = INSIGHT_PROMPTS;
    }
    renderMethodGrid();
}

function renderMethodGrid() {
    var grid = document.getElementById('methodGrid');
    grid.innerHTML = prompts.map(function(p) {
        return '<div class="method-card" onclick="openNoteSearch(\'' + p.id + '\')">' +
            '<svg class="method-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/></svg>' +
            '<div class="method-name">' + p.name + '</div>' +
            '<div class="method-desc">' + getMethodDesc(p.id) + '</div>' +
            '</div>';
    }).join('');
}

function getMethodDesc(id) {
    var found = prompts.find(function(p) { return p.id === id; });
    if (found && found.desc) return found.desc;
    var descs = {
        'affirmation': '每日积极肯定',
        'meaning': '发现深层意义',
        'default': '通用深度分析',
        'value': '梳理核心价值观',
        'reverse': '反向思维训练',
        'second': '连锁效应分析',
        'cbt': '认知行为疗法',
        'mbti': '性格类型洞察',
        'why': '连续追问直达本质',
        'blindspot': '发现认知盲区',
        'counterintuitive': '反常识思考',
        'extend': '主题关联与延伸',
        'seneca': '斯多葛哲学视角',
        'contradiction': '抓住核心矛盾',
        'compound': '复利效应思维'
    };
    return descs[id] || '';
}

function openNoteSearch(methodId) {
    selectedMethod = prompts.find(function(p) { return p.id === methodId; });
    document.getElementById('noteSearchOverlay').classList.add('open');
    document.getElementById('noteSearchPanel').classList.add('open');
    document.getElementById('noteSearchInput').value = '';
    renderNoteSearchList(notes);
    setTimeout(function() {
        document.getElementById('noteSearchInput').focus();
    }, 200);
}

function closeNoteSearch() {
    document.getElementById('noteSearchOverlay').classList.remove('open');
    document.getElementById('noteSearchPanel').classList.remove('open');
}

function filterNotes() {
    var query = document.getElementById('noteSearchInput').value.toLowerCase();
    if (!query) {
        renderNoteSearchList(notes);
        return;
    }
    var filtered = notes.filter(function(n) {
        return n.content.toLowerCase().includes(query);
    });
    renderNoteSearchList(filtered);
}

function renderNoteSearchList(list) {
    var container = document.getElementById('noteSearchList');
    if (list.length === 0) {
        container.innerHTML = '<div class="note-search-empty">没有找到笔记</div>';
        return;
    }
    container.innerHTML = list.map(function(n) {
        var date = new Date(n.createdAt);
        var dateStr = (date.getMonth() + 1) + '月' + date.getDate() + '日';
        var text = getPlainText(n.content).replace(/#([^\s]+)/g, '$1');
        return '<div class="note-search-item" onclick="selectNote(\'' + n.id + '\')">' +
            '<div class="item-date">' + dateStr + '</div>' +
            '<div class="item-text">' + escapeHtml(text) + '</div>' +
            '</div>';
    }).join('');
}

function selectNote(noteId) {
    selectedNote = notes.find(function(n) { return n.id === noteId; });
    if (!selectedNote) return;
    closeNoteSearch();
    generateInsight();
}

function generateInsight() {
    var settings = DataService.settings.load();
    if (!settings || !settings.apiUrl || !settings.apiKey) {
        showError('请先在设置中配置 AI 参数（API 地址、密钥、模型）');
        return;
    }

    document.getElementById('insightResult').classList.add('open');
    document.getElementById('resultTitle').textContent = selectedMethod.name;
    var plainText = getPlainText(selectedNote.content);
    document.getElementById('resultNote').innerHTML = '<div class="note-clamp" id="noteClamp"><div class="note-clamp-text">' + escapeHtml(plainText).replace(/\n/g, '<br>') + '</div></div><div class="note-clamp-toggle" id="noteClampToggle" onclick="toggleNoteClamp()">展开</div>';
    document.getElementById('resultContent').innerHTML = '<div class="result-loading"><div class="loading-spinner"></div>正在生成洞察...</div>';

    var noteContent = plainText;
    var systemPrompt = selectedMethod.systemPrompt;

    var url = settings.apiUrl.replace(/\/+$/, '');
    if (!url.endsWith('/chat/completions')) {
        if (url.endsWith('/v1')) url += '/chat/completions';
        else if (!url.includes('/chat/completions')) url += '/chat/completions';
    }

    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + settings.apiKey
        },
        body: JSON.stringify({
            model: settings.model || 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: noteContent }
            ],
            temperature: 0.7
        })
    })
    .then(function(res) {
        if (!res.ok) {
            if (res.status === 401) throw new Error('API 密钥无效');
            if (res.status === 404) throw new Error('API 地址不正确');
            throw new Error('请求失败 (' + res.status + ')');
        }
        return res.json();
    })
    .then(function(data) {
        var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!text) throw new Error('AI 返回内容为空');
        text = cleanOutput(text);
        document.getElementById('resultContent').innerHTML = renderMarkdown(text);
        saveHistory(text);
    })
    .catch(function(err) {
        showError(err.message || '生成洞察失败，请重试');
    });
}

function renderMarkdown(text) {
    var html = escapeHtml(text);

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(m, lang, code) {
        return '<pre><code>' + code.trim() + '</code></pre>';
    });

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');

    html = html.replace(/^- (.*$)/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, function(m) { return '<ul>' + m + '</ul>'; });

    html = html.replace(/^\d+\. (.*$)/gm, '<li>$1</li>');
    html = html.replace(/(?:<li>.*<\/li>\n?)+/g, function(m) {
        if (!m.startsWith('<ul>')) return '<ol>' + m + '</ol>';
        return m;
    });

    html = html.replace(/<li><\/li>/g, '');

    var paragraphs = html.split(/\n\n+/);
    html = paragraphs.map(function(p) {
        p = p.trim();
        if (!p) return '';
        if (p.match(/^<(h[123]|ul|ol|pre|blockquote)/)) return p;
        if (p.match(/^<li/)) return p;
        return '<p>' + p + '</p>';
    }).join('\n');

    html = html.replace(/\n/g, '<br>');

    return html;
}

function cleanOutput(text) {
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '');
    text = text.replace(/<\/?think>/gi, '');
    return text.trim();
}

function showError(msg) {
    document.getElementById('resultContent').innerHTML = '<div class="result-error">' + escapeHtml(msg) + '<div><button class="result-retry" onclick="generateInsight()">重试</button></div></div>';
}

function closeResult() {
    document.getElementById('insightResult').classList.remove('open');
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

function goBack() {
    history.back();
}

/* History */
function loadHistory() {
    try {
        var raw = localStorage.getItem('nian_insight_history');
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch(e) { return []; }
}

function saveHistory(result) {
    var item = {
        methodName: selectedMethod.name,
        methodId: selectedMethod.id,
        notePreview: selectedNote.content.substring(0, 60),
        noteFull: selectedNote.content,
        result: result,
        date: new Date().toISOString()
    };
    insightHistory.unshift(item);
    if (insightHistory.length > 50) insightHistory = insightHistory.slice(0, 50);
    try { localStorage.setItem('nian_insight_history', JSON.stringify(insightHistory)); } catch(e) {}
}

function openHistory() {
    document.getElementById('insightHistory').classList.add('open');
    var container = document.getElementById('historyList');
    if (insightHistory.length === 0) {
        container.innerHTML = '<div class="history-empty">暂无历史洞察</div>';
        return;
    }
    container.innerHTML = insightHistory.map(function(h) {
        var date = new Date(h.date);
        var dateStr = (date.getMonth() + 1) + '月' + date.getDate() + '日';
        return '<div class="history-item" onclick="viewHistory(\'' + encodeURIComponent(JSON.stringify(h)) + '\')">' +
            '<div class="history-method">' + escapeHtml(h.methodName) + '</div>' +
            '<div class="history-preview">' + escapeHtml(h.result.substring(0, 80)) + '</div>' +
            '<div class="history-date">' + dateStr + '</div>' +
            '</div>';
    }).join('');
}

function closeHistory() {
    document.getElementById('insightHistory').classList.remove('open');
}

function viewHistory(encoded) {
    var h = JSON.parse(decodeURIComponent(encoded));
    document.getElementById('insightHistory').classList.remove('open');
    document.getElementById('insightResult').classList.add('open');
    document.getElementById('resultTitle').textContent = h.methodName;
    document.getElementById('resultNote').innerHTML = '<div class="note-clamp" id="noteClamp"><div class="note-clamp-text">' + escapeHtml(h.noteFull || h.notePreview).replace(/\n/g, '<br>') + '</div></div><div class="note-clamp-toggle" id="noteClampToggle" onclick="toggleNoteClamp()">展开</div>';
    document.getElementById('resultContent').innerHTML = renderMarkdown(h.result);
}

function toggleNoteClamp() {
    var clamp = document.getElementById('noteClamp');
    var toggle = document.getElementById('noteClampToggle');
    if (!clamp || !toggle) return;
    clamp.classList.toggle('expanded');
    toggle.textContent = clamp.classList.contains('expanded') ? '收起' : '展开';
}
window.toggleNoteClamp = toggleNoteClamp;

init();
