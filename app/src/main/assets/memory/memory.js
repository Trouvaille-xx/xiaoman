(function() {
    var hasBridge = (typeof AndroidMemory !== 'undefined' && AndroidMemory !== null);
    var data = null;
    var currentTab = 'profile';
    var editingFactId = null;

    var CATEGORIES = [
        'identity', 'preference', 'relationship', 'goal',
        'emotion', 'belief', 'health', 'event'
    ];
    var CATEGORY_LABELS = {
        identity: '身份', preference: '偏好', relationship: '关系',
        goal: '目标', emotion: '情绪', belief: '信念',
        health: '健康', event: '事件'
    };

    var FILE_DEFAULTS = {
        identity: '你是「念念」，一个温暖的 AI 生活伴侣。\n\n你的定位是一个贴心的个人成长伴侣。\n\n一句话气质：温柔但有力量，细腻而不琐碎。',
        soul: '你是「念念」，一个温暖的 AI 生活伴侣。\n\n性格：善解人意、温柔但有主见，像一位老朋友。说话自然不做作，偶尔带点幽默。\n\n原则：\n- 先共情，再回应\n- 不评判用户\n- 记住用户告诉你的重要信息\n- 回复简洁温暖，保持在 200 字以内',
        user: '',
        tools: '',
        memory: '',
        heartbeat: ''
    };
    var FILE_META = [
        { key: 'identity', label: '身份', desc: '你的名字、定位和一句话气质描述' },
        { key: 'soul', label: '灵魂', desc: '价值观、说话方式、边界设定' },
        { key: 'user', label: '用户', desc: '你的偏好、习惯与个人信息' },
        { key: 'tools', label: '工具', desc: '本机工具的路径与调用方式' },
        { key: 'memory', label: '记忆', desc: '稳定偏好与环境事实兜底' },
        { key: 'heartbeat', label: '心跳', desc: '扫描清单与主动惊喜' }
    ];
    var notebookFile = 'identity';
    var notebookEditing = false;

    window.__applySafeInsets = function(top, bottom, keyboard) {
        var dpr = window.devicePixelRatio || 1;
        var r = document.documentElement;
        r.style.setProperty('--safe-area-top', Math.round(top / dpr) + 'px');
        r.style.setProperty('--safe-area-bottom', Math.round(bottom / dpr) + 'px');
    };

    function loadData() {
        if (hasBridge) {
            try {
                var raw = AndroidMemory.loadAll();
                data = raw ? JSON.parse(raw) : createEmpty();
            } catch(e) { data = createEmpty(); }
        } else {
            try {
                var cached = localStorage.getItem('nian_memories');
                data = cached ? JSON.parse(cached) : createEmpty();
            } catch(e) { data = createEmpty(); }
        }
        migrateIfNeeded();
    }

    function createEmpty() {
        return {
            version: 3,
            files: {
                identity: FILE_DEFAULTS.identity,
                soul: FILE_DEFAULTS.soul,
                user: '',
                tools: '',
                memory: '',
                heartbeat: ''
            },
            facts: [],
            sessions: []
        };
    }

    function migrateIfNeeded() {
        if (data.version >= 3) return;

        // v1 → v2: migrate profile fields into file blobs
        if (data.version < 2) {
            var p = data.profile || {};
            if (!data.files) data.files = { soul: FILE_DEFAULTS.soul, user: '', facts: '' };
            if (p.soul) {
                var soulParts = [];
                if (p.soul.meaning) soulParts.push('人生意义：' + p.soul.meaning);
                if (p.soul.passion) soulParts.push('热爱之事：' + p.soul.passion);
                if (p.soul.fear) soulParts.push('内心恐惧：' + p.soul.fear);
                if (p.soul.dream) soulParts.push('最大梦想：' + p.soul.dream);
                if (soulParts.length > 0 && !data.files.soul) {
                    data.files.soul = FILE_DEFAULTS.soul + '\n\n用户心灵信息：\n' + soulParts.join('\n');
                }
            }
            var userParts = [];
            if (p.basics && p.basics.name) userParts.push('名称：' + p.basics.name);
            if (p.basics && p.basics.occupation) userParts.push('职业：' + p.basics.occupation);
            if (p.basics && p.basics.location) userParts.push('所在地：' + p.basics.location);
            if (p.preferences && p.preferences.writingStyle) userParts.push('写作风格：' + p.preferences.writingStyle);
            if (p.preferences && p.preferences.activeTime) userParts.push('活跃时段：' + p.preferences.activeTime);
            if (p.goals && p.goals.length > 0) userParts.push('目标：' + p.goals.join('、'));
            if (p.relationships && p.relationships.length > 0) userParts.push('关系：' + p.relationships.join('、'));
            if (p.values && p.values.length > 0) userParts.push('价值观：' + p.values.join('、'));
            if (userParts.length > 0) {
                data.files.user = userParts.join('\n');
            }
            data.version = 2;
            saveData();
        }

        // v2 → v3: expand from 3 files to 6
        if (data.version < 3) {
            if (!data.files) data.files = {};
            // migrate old files.facts → files.memory
            if (data.files.facts && !data.files.memory) {
                data.files.memory = data.files.facts;
            }
            delete data.files.facts;
            // ensure defaults for new keys
            if (!data.files.identity) data.files.identity = FILE_DEFAULTS.identity;
            if (!data.files.soul) data.files.soul = FILE_DEFAULTS.soul;
            if (!data.files.tools) data.files.tools = '';
            if (!data.files.heartbeat) data.files.heartbeat = '';
            if (!data.files.memory) data.files.memory = '';
            data.version = 3;
            saveData();
        }
    }

    function saveData() {
        var json = JSON.stringify(data);
        if (hasBridge) {
            AndroidMemory.saveAll(json);
        } else {
            localStorage.setItem('nian_memories', json);
        }
    }

    function init() {
        loadData();
        renderTab('profile');
    }

    function switchTab(tab) {
        if (notebookEditing) saveNotebookEdit();
        currentTab = tab;
        editingFactId = null;
        notebookFile = 'identity';
        notebookEditing = false;
        document.querySelectorAll('.memory-tab, .mem-head-tab').forEach(function(t) {
            t.classList.toggle('active', t.getAttribute('data-tab') === tab);
        });
        renderTab(tab);
    }

    function renderTab(tab) {
        var container = document.getElementById('memoryContent');
        if (tab === 'profile') renderProfile(container);
        else if (tab === 'facts') renderFacts(container);
    }

    /* ============= Dreaming Dialog ============= */
    function openDreamingDialog() {
        var memoryText = data.files.memory || '';
        var factCount = memoryText ? memoryText.split('•').length - 1 : 0;

        var dreamInfo = '尚未触发';
        var noteCount = '?';
        try {
            var s = JSON.parse(typeof AndroidStorage !== 'undefined'
                ? AndroidSettings.loadSettings()
                : (localStorage.getItem('nian_settings') || '{}'));
            var lastDream = s.lastDreamAt;
            var lastCount = s.noteCountAtLastDream || 0;
            if (lastDream) {
                var d = new Date(lastDream);
                dreamInfo = d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate() + ' ' +
                    d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0');
                if (lastCount) dreamInfo += ' (当时 ' + lastCount + ' 篇笔记)';
            }
            // try to get current note count
            if (typeof AndroidStorage !== 'undefined' && AndroidStorage.getNotesCount) {
                noteCount = AndroidStorage.getNotesCount();
            } else {
                try {
                    var raw = localStorage.getItem('nian_notes');
                    if (raw) { var n = JSON.parse(raw); noteCount = n.length || 0; }
                } catch(e) {}
            }
        } catch(e) {}

        var infoHtml =
            '上次整理: ' + dreamInfo + '<br>' +
            '当前笔记: ' + noteCount + ' 篇<br>' +
            'facts 条目: ' + factCount + ' 条';

        document.getElementById('dreamingDialogInfo').innerHTML = infoHtml;
        document.getElementById('dreamingOverlay').style.display = 'flex';
    }

    function closeDreamingDialog() {
        document.getElementById('dreamingOverlay').style.display = 'none';
    }

    function confirmDreaming() {
        closeDreamingDialog();
        triggerDreamingFromMemory();
    }

    function triggerDreamingFromMemory() {
        if (typeof AndroidMemory !== 'undefined') {
            try {
                var nianWin = window.opener || window.parent;
                if (nianWin && nianWin.runDreaming) {
                    nianWin.runDreaming();
                } else {
                    var iframe = document.createElement('iframe');
                    iframe.style.display = 'none';
                    iframe.src = '../app.html?action=runDreaming&t=' + Date.now();
                    document.body.appendChild(iframe);
                    setTimeout(function() { document.body.removeChild(iframe); }, 1000);
                    showDreamingToast('正在整理...');
                }
            } catch(e) {}
        }
    }

    function showDreamingToast(msg) {
        var t = document.getElementById('dreamingToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'dreamingToast';
            t.className = 'memory-toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(function() { t.classList.remove('show'); }, 3000);
    }

    /* ============= Profile (Notebook) ============= */
    function renderProfile(container) {
        var tagsHtml = FILE_META.map(function(m) {
            var cls = 'notebook-tag' + (m.key === notebookFile ? ' active' : '');
            return '<span class="' + cls + '" data-key="' + m.key + '" onclick="switchNotebookFile(\'' + m.key + '\')">' + m.label + '</span>';
        }).join('');

        var meta = FILE_META.find(function(m) { return m.key === notebookFile; }) || FILE_META[0];
        var text = data.files[notebookFile] || '';
        var isEmpty = !text.trim();

        var html =
            '<div class="mem-notebook active" id="memNotebook">' +
                '<div class="notebook-tags" id="notebookTags">' + tagsHtml + '</div>' +
                '<div class="notebook-body">' +
                    '<div class="notebook-top">' +
                        '<span class="notebook-file-label">' + meta.label + '</span>' +
                        '<span class="notebook-file-name">' + meta.key + '.md</span>' +
                        '<button class="notebook-edit-btn" id="notebookEditBtn" onclick="toggleNotebookEdit()">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
                        '</button>' +
                    '</div>' +
                    '<div class="notebook-paper" id="notebookPaper">' +
                        '<div class="notebook-content' + (isEmpty ? ' empty' : '') + '" id="notebookContent">' +
                        (isEmpty ? '点击编辑按钮开始书写' : escapeHtml(text)) + '</div>' +
                        '<textarea class="notebook-textarea" id="notebookTextarea" placeholder="写点什么...">' + escapeHtml(text) + '</textarea>' +
                    '</div>' +
                '</div>' +
            '</div>';

        container.innerHTML = html;

        if (notebookEditing) {
            var ta = document.getElementById('notebookTextarea');
            var content = document.getElementById('notebookContent');
            if (ta && content) {
                ta.classList.add('active');
                content.classList.add('hidden');
                ta.focus();
            }
        }
    }

    window.switchNotebookFile = function(key) {
        if (notebookEditing) saveNotebookEdit();
        notebookFile = key;
        renderTab('profile');
    };

    window.toggleNotebookEdit = function() {
        var ta = document.getElementById('notebookTextarea');
        var content = document.getElementById('notebookContent');
        if (!ta || !content) return;

        if (notebookEditing) {
            saveNotebookEdit();
        } else {
            notebookEditing = true;
            ta.value = data.files[notebookFile] || '';
            ta.classList.add('active');
            content.classList.add('hidden');
            ta.focus();
        }
    };

    function saveNotebookEdit() {
        var ta = document.getElementById('notebookTextarea');
        var content = document.getElementById('notebookContent');
        if (!ta) return;
        data.files[notebookFile] = ta.value;
        saveData();
        notebookEditing = false;
        ta.classList.remove('active');
        if (content) {
            var text = ta.value;
            var isEmpty = !text.trim();
            content.textContent = isEmpty ? '点击编辑按钮开始书写' : text;
            content.classList.toggle('empty', isEmpty);
            content.classList.remove('hidden');
        }
    }

    window.saveNotebookEdit = saveNotebookEdit;
    window.finishNotebookEdit = function() {
        if (notebookEditing) saveNotebookEdit();
    };

    /* ============= Facts (L2) ============= */
    function renderFacts(container) {
        var facts = data.facts;
        var innerHtml = '<div class="corkboard"><div class="corkboard-facts">';
        if (editingFactId) {
            var fact = null;
            if (editingFactId !== 'new') {
                for (var i = 0; i < facts.length; i++) {
                    if (facts[i].id === editingFactId) { fact = facts[i]; break; }
                }
            }
            innerHtml += '</div></div>';
            innerHtml += renderFactEditor(fact);
        } else {
            if (facts.length === 0) {
                innerHtml += '<div class="empty-hint">贴上你的第一张便利贴吧</div>';
            } else {
                innerHtml += facts.map(function(f) {
                    var date = new Date(f.createdAt);
                    var dateStr = (date.getMonth() + 1) + '月' + date.getDate() + '日';
                    return '<div class="fact-sticker">' +
                        '<span class="fact-sticker-category">' + (CATEGORY_LABELS[f.category] || f.category) + '</span>' +
                        '<div class="fact-sticker-content">' + escapeHtml(f.fact) + '</div>' +
                        '<div class="fact-sticker-actions">' +
                        '<span onclick="startEditFact(\'' + f.id + '\')">编辑</span>' +
                        '<span class="danger" onclick="deleteFact(\'' + f.id + '\')">删除</span></div></div>';
                }).join('');
            }
            innerHtml += '</div></div>';
            innerHtml += '<button class="fact-add-btn" onclick="startAddFact()">+ 添加事实</button>';
        }

        container.innerHTML = '<div class="mem-facts active" id="memFacts">' + innerHtml + '</div>';
    }

    function renderFactEditor(fact) {
        var isNew = !fact;
        return '<div class="fact-editor">' +
            '<textarea class="fact-editor-input" id="factEditContent" placeholder="输入事实内容...">' +
            (fact ? fact.fact : '') + '</textarea>' +
            '<div class="fact-editor-row">' +
            '<span style="font-size:12px;color:var(--text-muted);margin-right:4px">分类:</span>' +
            '<select class="fact-editor-select" id="factEditCategory">' +
            CATEGORIES.map(function(c) {
                return '<option value="' + c + '"' + (fact && fact.category === c ? ' selected' : '') + '>' +
                    CATEGORY_LABELS[c] + '</option>';
            }).join('') +
            '</select></div>' +
            '<div class="fact-editor-actions">' +
            '<button class="fact-editor-btn cancel" onclick="cancelFactEdit()">取消</button>' +
            '<button class="fact-editor-btn confirm" onclick="' + (isNew ? 'confirmAddFact' : 'confirmEditFact(\'' + fact.id + '\')') + '()">保存</button>' +
            '</div></div>';
    }

    window.startAddFact = function() {
        editingFactId = 'new';
        renderTab('facts');
    };

    window.cancelFactEdit = function() {
        editingFactId = null;
        renderTab('facts');
    };

    window.confirmAddFact = function() {
        var content = document.getElementById('factEditContent').value.trim();
        if (!content) { alert('请输入事实内容'); return; }
        var category = document.getElementById('factEditCategory').value;
        data.facts.push({
            id: 'mem_' + Date.now(),
            fact: content,
            category: category,
            source: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            importance: 0.5,
            status: 'active'
        });
        editingFactId = null;
        saveData();
        renderTab('facts');
    };

    window.startEditFact = function(id) {
        editingFactId = id;
        renderTab('facts');
    };

    window.confirmEditFact = function(id) {
        var content = document.getElementById('factEditContent').value.trim();
        if (!content) { alert('请输入事实内容'); return; }
        var category = document.getElementById('factEditCategory').value;
        for (var i = 0; i < data.facts.length; i++) {
            if (data.facts[i].id === id) {
                data.facts[i].fact = content;
                data.facts[i].category = category;
                data.facts[i].updatedAt = new Date().toISOString();
                break;
            }
        }
        editingFactId = null;
        saveData();
        renderTab('facts');
    };

    window.deleteFact = function(id) {
        if (!confirm('确定删除这条记忆？')) return;
        data.facts = data.facts.filter(function(f) { return f.id !== id; });
        saveData();
        renderTab('facts');
    };

    /* ============= Utils ============= */
    function escapeHtml(text) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(text));
        return div.innerHTML;
    }

    function goBack() {
        if (hasBridge) {
            window.location.href = '../app.html';
        } else {
            history.back();
        }
    }

    window.switchTab = switchTab;
    window.goBack = goBack;
    window.openDreamingDialog = openDreamingDialog;
    window.closeDreamingDialog = closeDreamingDialog;
    window.confirmDreaming = confirmDreaming;

    init();
})();
