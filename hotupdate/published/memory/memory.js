(function() {
    var M = window.MemoryService;
    var currentTab = 'user';
    var currentFilter = 'all';
    var editingMemory = null;      // {type, id} 或 null
    var editingMemoryType = 'episode';
    var editingRoleKey = null;

    var ROLE_META = [
        { key: 'identity', label: '身份', desc: '它是谁？（邻家朋友 / 温柔倾听者 / 毒舌嘴替）' },
        { key: 'personality', label: '性格特质', desc: '稳定的人格与处事方式，决定情感色彩' },
        { key: 'tone', label: '语气 / 风格', desc: '亲切 / 温柔 / 俏皮——决定怎么说话' },
        { key: 'knowledge', label: '知识 / 擅长', desc: '懂什么、案例与知识边界' },
        { key: 'background', label: '背景故事', desc: '它从哪来、有什么经历，让角色更立体' },
        { key: 'boundaries', label: '能力边界', desc: '能做什么、不能做什么' }
    ];

    var TYPE_META = {
        episode: { label: '情节', cls: 'ep', desc: '带时间的事件与经历' },
        fact: { label: '事实', cls: 'fact', desc: '稳定的客观属性' },
        preference: { label: '偏好', cls: 'pref', desc: '喜好、习惯' },
        semantic: { label: '语义', cls: 'sem', desc: '沉淀的理解与画像结论' },
        summary: { label: '摘要', cls: 'sum', desc: '一段时间对话的浓缩' }
    };

    var EMOJI = { '低落': '😔', '焦虑': '😰', '愤怒': '😤', '疲惫': '😮‍💨', '平静': '🌿', '开心': '😊', '迷茫': '🌀', '期待': '✨', '其他': '🍃' };

    window.__applySafeInsets = function(top, bottom, keyboard) {
        var dpr = window.devicePixelRatio || 1;
        var r = document.documentElement;
        r.style.setProperty('--safe-area-top', Math.round(top / dpr) + 'px');
        r.style.setProperty('--safe-area-bottom', Math.round(bottom / dpr) + 'px');
    };

    function data() { return M.loadOrCreate(); }
    function esc(t) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(t == null ? '' : String(t)));
        return div.innerHTML;
    }
    function rel(ts) { return M.relativeTime ? M.relativeTime(ts) : ''; }
    function dateOf(ts) { return ts ? String(ts).substring(0, 10) : ''; }
    function statusLabel(s) {
        return s === 'superseded' ? '已失效' : s === 'archived' ? '已归档' : s === 'pending' ? '待确认' : '有效';
    }
    function tagsHtml(tags) {
        if (!tags || !tags.length) return '';
        return '<div class="mem-tags">' + tags.map(function(t) { return '<span>#' + esc(t) + '</span>'; }).join('') + '</div>';
    }

    /* ══════════ 渲染入口 ══════════ */

    function init() {
        bindTypeChange();
        renderTab('user');
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.mem-head-tab').forEach(function(t) {
            t.classList.toggle('active', t.getAttribute('data-tab') === tab);
        });
        renderTab(tab);
    }

    function renderTab(tab) {
        var c = document.getElementById('memoryContent');
        if (!c) return;
        if (tab === 'role') renderRole(c);
        else renderUser(c);
    }

    /* ══════════ 用户记忆 ══════════ */

    function renderUser(container) {
        var d = data();
        var html = '';
        html += moodStrip(d);
        html += coreProfile(d);
        html += pendingCards(d);
        html += filterBar(d);
        html += memorySections(d);
        html += '<button class="fact-add-btn" onclick="openAddMemory()">+ 添加记忆</button>';
        container.innerHTML = '<div class="mem-user">' + html + '</div>';
    }

    function moodStrip(d) {
        var episodes = (d.episodes || []).filter(function(e) { return e && e.status === 'active'; });
        var mood = {};
        for (var i = 0; i < episodes.length; i++) {
            var t = episodes[i].occurredAt || episodes[i].createdAt;
            var key = dateOf(t);
            if (key && !mood[key]) mood[key] = episodes[i].emotion;
        }
        var cells = [];
        for (var k = 6; k >= 0; k--) {
            var day = new Date(Date.now() - k * 86400000);
            var key = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
            var emo = mood[key];
            cells.push('<div class="mood-cell' + (emo ? '' : ' mood-cell-empty') + '">' +
                '<div class="mood-cell-emoji">' + (emo ? (EMOJI[emo] || '🍃') : '·') + '</div>' +
                '<div class="mood-cell-label">' + (emo || '') + '</div></div>');
        }
        return '<div class="mood-strip"><div class="mood-strip-title">最近的心情</div><div class="mood-strip-days">' + cells.join('') + '</div></div>';
    }

    function coreProfile(d) {
        var p = d.profile || {};
        var chips = [];
        var fields = [
            ['名字', p.name], ['性别', p.gender], ['年龄', p.age], ['职业', p.occupation],
            ['城市', p.city], ['情感', p.emotionalStatus], ['关系', p.relationshipStatus]
        ];
        fields.forEach(function(f) {
            if (f[1]) chips.push('<span class="tag-chip" onclick="openProfileEditor()"><b>' + f[0] + '</b>' + esc(f[1]) + '</span>');
        });
        (p.keyDates || []).forEach(function(kd) {
            chips.push('<span class="tag-chip tag-date" onclick="openProfileEditor()"><b>' + esc(kd.label) + '</b>' + esc(kd.date) + '</span>');
        });
        (p.longTermGoals || []).forEach(function(g) {
            chips.push('<span class="tag-chip tag-goal" onclick="openProfileEditor()"><b>目标</b>' + esc(g) + '</span>');
        });
        var seen = {};
        (d.semantic || []).forEach(function(s) {
            if (!s || s.status !== 'active') return;
            (s.tags || []).forEach(function(t) {
                if (!t || seen[t]) return;
                seen[t] = 1;
                if (Object.keys(seen).length <= 10) chips.push('<span class="tag-chip tag-semantic" onclick="setFilter(\'semantic\')">#' + esc(t) + '</span>');
            });
        });
        if (!chips.length) {
            return '<div class="mem-section"><div class="mem-section-head"><span>核心画像</span>' +
                '<button class="mem-mini-btn" onclick="openProfileEditor()">手动填写</button></div>' +
                '<div class="mem-empty-line">还没有画像信息。和小满聊聊天，她会慢慢记住你。</div></div>';
        }
        return '<div class="mem-section"><div class="mem-section-head"><span>核心画像</span>' +
            '<button class="mem-mini-btn" onclick="openProfileEditor()">编辑</button></div>' +
            '<div class="tag-wall">' + chips.join('') + '</div></div>';
    }

    function pendingCards(d) {
        var list = (d.pending || []).filter(function(p) { return p && p.status === 'pending'; });
        if (!list.length) return '';
        return '<div class="mem-section"><div class="mem-section-head"><span>待确认的记忆</span></div>' +
            list.slice(0, 3).map(function(p) {
                return '<div class="pending-card">' +
                    '<div class="pending-q">' + esc(p.question) + '</div>' +
                    '<div class="pending-actions">' +
                        '<button onclick="resolvePending(\'' + p.id + '\',\'accept_new\')">按新的记</button>' +
                        '<button onclick="resolvePending(\'' + p.id + '\',\'keep_old\')">保持原样</button>' +
                        '<button onclick="resolvePending(\'' + p.id + '\',\'keep_both_by_context\')">两种都记</button>' +
                        '<button onclick="resolvePending(\'' + p.id + '\',\'reject_both\')">忽略</button>' +
                    '</div></div>';
            }).join('') + '</div>';
    }

    function filterBar(d) {
        var counts = {
            all: (d.episodes || []).length + (d.facts || []).length + (d.preferences || []).length + (d.semantic || []).length + (d.summaries || []).length,
            episode: (d.episodes || []).length,
            fact: (d.facts || []).length,
            preference: (d.preferences || []).length,
            semantic: (d.semantic || []).length,
            summary: (d.summaries || []).length
        };
        var items = [['all', '全部'], ['episode', '情节'], ['fact', '事实'], ['preference', '偏好'], ['semantic', '语义'], ['summary', '摘要']];
        return '<div class="mem-filter">' + items.map(function(it) {
            var active = currentFilter === it[0] ? ' active' : '';
            return '<button class="mem-filter-chip' + active + '" onclick="setFilter(\'' + it[0] + '\')">' + it[1] +
                (counts[it[0]] ? '<span>' + counts[it[0]] + '</span>' : '') + '</button>';
        }).join('') + '</div>';
    }

    function memorySections(d) {
        var order = currentFilter === 'all' ? ['episode', 'fact', 'preference', 'semantic', 'summary'] : [currentFilter];
        var html = '';
        var total = 0;
        order.forEach(function(type) {
            var list = listOf(d, type);
            if (!list.length) return;
            total += list.length;
            html += '<div class="mem-section"><div class="mem-section-head"><span>' + TYPE_META[type].label + '记忆' +
                '<small>' + TYPE_META[type].desc + '</small></span></div>' +
                list.slice(0, 30).map(function(item) { return card(type, item); }).join('') + '</div>';
        });
        if (!total) {
            html = '<div class="empty-hint"><img class="empty-mascot" src="../mascot/xiaoman-logo.png" alt="">还没有记住什么。<br>和小满聊聊天，她会把关于你的事<br>分门别类地记在这里。</div>';
        }
        return html;
    }

    function listOf(d, type) {
        var arr = type === 'episode' ? d.episodes : type === 'fact' ? d.facts : type === 'preference' ? d.preferences :
                  type === 'semantic' ? d.semantic : type === 'summary' ? d.summaries : [];
        arr = (arr || []).filter(Boolean);
        if (type === 'episode') {
            arr = arr.slice().sort(function(a, b) { return String(b.occurredAt || b.createdAt) < String(a.occurredAt || a.createdAt) ? -1 : 1; });
        }
        return arr;
    }

    function card(type, item) {
        var meta = TYPE_META[type];
        var status = item.status || 'active';
        var statusCls = status === 'active' ? '' : ' inactive';
        var head = '<div class="mem-card-head"><span class="mem-type-badge ' + meta.cls + '">' + meta.label + '</span>' +
            '<span class="mem-card-date">' + (type === 'episode' ? esc(dateOf(item.occurredAt)) + ' · ' + esc(rel(item.occurredAt)) : esc(rel(item.updatedAt || item.createdAt))) + '</span>' +
            '<span class="mem-card-status' + statusCls + '">' + statusLabel(status) + '</span></div>';
        var body = '', extra = '';
        if (type === 'episode') {
            body = '<div class="mem-card-title">' + esc(item.title || '') + '</div>' +
                '<div class="mem-card-body">' + esc(item.summary || '') + '</div>' +
                '<div class="mem-card-meta">' + (EMOJI[item.emotion] || '🍃') + ' ' + esc(item.emotion || '其他') +
                (item.context ? ' · ' + esc(item.context) : '') +
                ((item.people && item.people.length) ? ' · ' + esc(item.people.join('、')) : '') + '</div>';
        } else if (type === 'fact') {
            body = '<div class="mem-card-title">' + esc(item.key) + '</div>' +
                '<div class="mem-card-body">' + esc(item.value) + '</div>' +
                '<div class="mem-card-meta">' + esc(item.category || '其他') + (item.confidence ? ' · 置信度 ' + Math.round(item.confidence * 100) + '%' : '') + '</div>';
        } else if (type === 'preference') {
            body = '<div class="mem-card-title">' + (item.polarity === 'dislike' ? '不喜欢 ' : '喜欢 ') + esc(item.key) + '</div>' +
                '<div class="mem-card-body">' + esc(item.value) + '</div>' +
                '<div class="mem-card-meta">' + esc((item.tags || []).join(' / ') || '偏好') + '</div>';
        } else if (type === 'semantic') {
            body = '<div class="mem-card-body">' + esc(item.statement) + '</div>' +
                '<div class="mem-card-meta">理解' + (item.confidence ? ' · 置信度 ' + Math.round(item.confidence * 100) + '%' : '') + '</div>';
        } else if (type === 'summary') {
            body = '<div class="mem-card-body">' + esc(item.text) + '</div>' +
                '<div class="mem-card-meta">' + esc((item.themes || []).join('、') || '摘要') + '</div>';
        }
        extra = tagsHtml(item.tags);
        var actions = '<div class="mem-card-actions">' +
            '<span onclick="openEditMemory(\'' + type + '\',\'' + item.id + '\')">编辑</span>' +
            '<span onclick="toggleMemoryStatus(\'' + type + '\',\'' + item.id + '\')">' + (status === 'active' ? '失效' : '恢复') + '</span>' +
            '<span class="danger" onclick="deleteMemory(\'' + type + '\',\'' + item.id + '\')">删除</span>' +
            '</div>';
        return '<div class="mem-card' + (status === 'active' ? '' : ' mem-card-inactive') + '">' + head + body + extra + actions + '</div>';
    }

    window.setFilter = function(f) {
        currentFilter = f;
        renderTab('user');
    };

    /* ══════════ 核心画像编辑 ══════════ */

    window.openProfileEditor = function() {
        var p = (data().profile) || {};
        document.getElementById('pfName').value = p.name || '';
        document.getElementById('pfGender').value = p.gender || '';
        document.getElementById('pfAge').value = p.age || '';
        document.getElementById('pfOccupation').value = p.occupation || '';
        document.getElementById('pfCity').value = p.city || '';
        document.getElementById('pfEmotion').value = p.emotionalStatus || '';
        document.getElementById('pfRelation').value = p.relationshipStatus || '';
        document.getElementById('pfKeyDates').value = (p.keyDates || []).map(function(k) { return k.label + ' ' + k.date; }).join('\n');
        document.getElementById('pfGoals').value = (p.longTermGoals || []).join('\n');
        document.getElementById('pfNotes').value = p.notes || '';
        document.getElementById('profileOverlay').style.display = 'flex';
    };
    window.closeProfileEditor = function() {
        document.getElementById('profileOverlay').style.display = 'none';
    };
    window.saveProfileEditor = function() {
        var patch = {
            name: document.getElementById('pfName').value.trim(),
            gender: document.getElementById('pfGender').value.trim(),
            age: document.getElementById('pfAge').value.trim(),
            occupation: document.getElementById('pfOccupation').value.trim(),
            city: document.getElementById('pfCity').value.trim(),
            emotionalStatus: document.getElementById('pfEmotion').value.trim(),
            relationshipStatus: document.getElementById('pfRelation').value.trim(),
            notes: document.getElementById('pfNotes').value.trim()
        };
        patch.keyDates = document.getElementById('pfKeyDates').value.split(/\r?\n/).map(function(line) {
            var m = /^(.+?)\s+((?:\d{4}[-/.])?\d{1,2}[-/.]\d{1,2}.*)$/.exec(line.trim());
            if (!m) return null;
            return { label: m[1].trim(), date: m[2].trim().replace(/[/.]/g, '-') };
        }).filter(Boolean);
        patch.longTermGoals = document.getElementById('pfGoals').value.split(/\r?\n/).map(function(x) { return x.trim(); }).filter(Boolean);
        M.updateProfile(patch, { force: true, allowNotes: true });
        closeProfileEditor();
        toast('核心画像已保存');
        renderTab('user');
    };

    /* ══════════ 记忆条目编辑 ══════════ */

    function typeOptions(selected) {
        return ['episode', 'fact', 'preference', 'semantic', 'summary'].map(function(t) {
            return '<option value="' + t + '"' + (t === selected ? ' selected' : '') + '>' + TYPE_META[t].label + '记忆</option>';
        }).join('');
    }
    function statusOptions(selected) {
        return ['active', 'superseded', 'archived'].map(function(s) {
            return '<option value="' + s + '"' + (s === (selected || 'active') ? ' selected' : '') + '>' + statusLabel(s) + '</option>';
        }).join('');
    }
    function categoryOptions(selected) {
        return M.MEMORY_CATEGORIES.map(function(c) {
            return '<option value="' + c + '"' + (c === (selected || '其他') ? ' selected' : '') + '>' + c + '</option>';
        }).join('');
    }
    function emotionOptions(selected) {
        return M.EPISODE_EMOTIONS.map(function(e) {
            return '<option value="' + e + '"' + (e === (selected || '其他') ? ' selected' : '') + '>' + (EMOJI[e] || '') + ' ' + e + '</option>';
        }).join('');
    }

    function renderMemoryForm(type, item) {
        item = item || {};
        var html = '<label class="mem-field"><span>类型</span><select class="moment-select" id="mfType" ' + (editingMemory ? 'disabled' : '') + ' onchange="onMemoryTypeChange(this.value)">' + typeOptions(type) + '</select></label>';
        if (type === 'episode') {
            html += '<label class="mem-field"><span>标题</span><input class="moment-input" id="mfTitle" maxlength="40" value="' + esc(item.title || '') + '"></label>' +
                '<label class="mem-field"><span>发生了什么（用户视角）</span><textarea class="moment-textarea" id="mfSummary" rows="3">' + esc(item.summary || '') + '</textarea></label>' +
                '<label class="mem-field"><span>发生日期</span><input class="moment-input" id="mfDate" type="date" value="' + esc(dateOf(item.occurredAt)) + '"></label>' +
                '<label class="mem-field"><span>情绪</span><select class="moment-select" id="mfEmotion">' + emotionOptions(item.emotion) + '</select></label>' +
                '<label class="mem-field"><span>强度（0-1）</span><input class="moment-input" id="mfIntensity" type="number" min="0" max="1" step="0.1" value="' + (item.intensity != null ? item.intensity : 0.5) + '"></label>' +
                '<label class="mem-field"><span>场景</span><input class="moment-input" id="mfContext" maxlength="80" value="' + esc(item.context || '') + '"></label>' +
                '<label class="mem-field"><span>人物（逗号分隔）</span><input class="moment-input" id="mfPeople" value="' + esc((item.people || []).join(',')) + '"></label>';
        } else if (type === 'fact') {
            html += '<label class="mem-field"><span>分类</span><select class="moment-select" id="mfCategory">' + categoryOptions(item.category) + '</select></label>' +
                '<label class="mem-field"><span>属性名</span><input class="moment-input" id="mfKey" maxlength="40" value="' + esc(item.key || '') + '"></label>' +
                '<label class="mem-field"><span>内容</span><textarea class="moment-textarea" id="mfValue" rows="2">' + esc(item.value || '') + '</textarea></label>' +
                '<label class="mem-field"><span>置信度（0-1）</span><input class="moment-input" id="mfConfidence" type="number" min="0" max="1" step="0.1" value="' + (item.confidence != null ? item.confidence : 0.8) + '"></label>';
        } else if (type === 'preference') {
            html += '<label class="mem-field"><span>偏好对象</span><input class="moment-input" id="mfKey" maxlength="40" value="' + esc(item.key || '') + '"></label>' +
                '<label class="mem-field"><span>具体内容</span><textarea class="moment-textarea" id="mfValue" rows="2">' + esc(item.value || '') + '</textarea></label>' +
                '<label class="mem-field"><span>方向</span><select class="moment-select" id="mfPolarity">' +
                    '<option value="like"' + (item.polarity !== 'dislike' ? ' selected' : '') + '>喜欢</option>' +
                    '<option value="dislike"' + (item.polarity === 'dislike' ? ' selected' : '') + '>不喜欢</option></select></label>';
        } else if (type === 'semantic') {
            html += '<label class="mem-field"><span>沉淀的理解</span><textarea class="moment-textarea" id="mfStatement" rows="3">' + esc(item.statement || '') + '</textarea></label>' +
                '<label class="mem-field"><span>置信度（0-1）</span><input class="moment-input" id="mfConfidence" type="number" min="0" max="1" step="0.1" value="' + (item.confidence != null ? item.confidence : 0.7) + '"></label>';
        } else if (type === 'summary') {
            html += '<label class="mem-field"><span>摘要内容</span><textarea class="moment-textarea" id="mfText" rows="4">' + esc(item.text || '') + '</textarea></label>';
        }
        html += '<label class="mem-field"><span>标签（逗号分隔）</span><input class="moment-input" id="mfTags" value="' + esc((item.tags || []).join(',')) + '"></label>';
        if (editingMemory) {
            html += '<label class="mem-field"><span>状态</span><select class="moment-select" id="mfStatus">' + statusOptions(item.status) + '</select></label>';
        }
        document.getElementById('memoryForm').innerHTML = html;
    }

    function bindTypeChange() {}
    window.onMemoryTypeChange = function(type) {
        editingMemoryType = type;
        renderMemoryForm(type, null);
    };

    window.openAddMemory = function() {
        editingMemory = null;
        editingMemoryType = 'episode';
        document.getElementById('memoryEditorTitle').textContent = '添加记忆';
        renderMemoryForm('episode', null);
        document.getElementById('memoryOverlay').style.display = 'flex';
    };

    window.openEditMemory = function(type, id) {
        var d = data();
        var list = listOf(d, type);
        var item = null;
        for (var i = 0; i < list.length; i++) if (list[i].id === id) { item = list[i]; break; }
        if (!item) return;
        editingMemory = { type: type, id: id };
        editingMemoryType = type;
        document.getElementById('memoryEditorTitle').textContent = '编辑' + TYPE_META[type].label + '记忆';
        renderMemoryForm(type, item);
        document.getElementById('memoryOverlay').style.display = 'flex';
    };

    window.closeMemoryEditor = function() {
        document.getElementById('memoryOverlay').style.display = 'none';
    };

    function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    function splitTags(s) { return String(s || '').split(/[,，、\s]+/).map(function(x) { return x.trim(); }).filter(Boolean); }

    window.saveMemoryEditor = function() {
        var type = editingMemory ? editingMemory.type : val('mfType');
        var patch = { tags: splitTags(val('mfTags')) };
        if (type === 'episode') {
            patch.title = val('mfTitle'); patch.summary = val('mfSummary');
            patch.occurredAt = val('mfDate') || new Date().toISOString();
            patch.emotion = val('mfEmotion'); patch.intensity = parseFloat(val('mfIntensity')) || 0.5;
            patch.context = val('mfContext'); patch.people = splitTags(val('mfPeople'));
        } else if (type === 'fact') {
            patch.category = val('mfCategory'); patch.key = val('mfKey'); patch.value = val('mfValue');
            patch.confidence = parseFloat(val('mfConfidence')) || 0.8;
        } else if (type === 'preference') {
            patch.key = val('mfKey'); patch.value = val('mfValue'); patch.polarity = val('mfPolarity');
        } else if (type === 'semantic') {
            patch.statement = val('mfStatement'); patch.confidence = parseFloat(val('mfConfidence')) || 0.7;
        } else if (type === 'summary') {
            patch.text = val('mfText');
        }
        if (editingMemory) {
            patch.status = val('mfStatus') || 'active';
            M.updateMemoryItem(type, editingMemory.id, patch);
            toast('已更新');
        } else {
            var r = M.addMemory(type, patch);
            if (!r || r.action === 'skip' || r.action === 'error') { toast('内容不完整，未保存'); return; }
            if (r.action === 'duplicate') toast('已有相似记忆，未重复添加');
            else if (r.action === 'pending') toast('与已有记忆冲突，已加入待确认');
            else toast('已记下');
        }
        closeMemoryEditor();
        renderTab('user');
    };

    window.toggleMemoryStatus = function(type, id) {
        var list = listOf(data(), type);
        var item = null;
        for (var i = 0; i < list.length; i++) if (list[i].id === id) { item = list[i]; break; }
        if (!item) return;
        M.setMemoryStatus(type, id, item.status === 'active' ? 'superseded' : 'active');
        renderTab('user');
    };

    window.deleteMemory = function(type, id) {
        if (!confirm('确定删除这条记忆？')) return;
        M.deleteMemoryItem(type, id);
        toast('已删除');
        renderTab('user');
    };

    window.resolvePending = function(id, resolution) {
        M.resolvePending(id, resolution);
        toast(resolution === 'accept_new' ? '已按新的更新' : resolution === 'keep_both_by_context' ? '已记录两种场景' : '已处理');
        renderTab('user');
    };

    /* ══════════ 角色档案 ══════════ */

    function renderRole(container) {
        var role = M.getRole(data());
        var html = '<div class="role-hero"><img src="../mascot/xiaoman-logo.png" alt=""><div><div class="role-hero-name">小满</div>' +
            '<div class="role-hero-sub">住在你手机里的 AI 伙伴 · 角色档案</div></div></div>';
        html += '<div class="role-tip">角色档案只描述「小满是谁」，与关于你的记忆分开管理。</div>';
        ROLE_META.forEach(function(m) {
            var text = role[m.key] || '';
            html += '<div class="role-card">' +
                '<div class="role-card-head"><div><div class="role-card-title">' + m.label + '</div>' +
                '<div class="role-card-desc">' + m.desc + '</div></div>' +
                '<button class="mem-mini-btn" onclick="openRoleEditor(\'' + m.key + '\')">编辑</button></div>' +
                '<div class="role-card-body">' + (text ? esc(text) : '<span class="mem-empty-line">未填写</span>') + '</div>' +
                '</div>';
        });
        container.innerHTML = '<div class="mem-role">' + html + '</div>';
    }

    window.openRoleEditor = function(key) {
        var meta = ROLE_META.filter(function(m) { return m.key === key; })[0];
        if (!meta) return;
        editingRoleKey = key;
        document.getElementById('roleEditorTitle').textContent = '编辑 · ' + meta.label;
        document.getElementById('roleEditorDesc').textContent = meta.desc;
        document.getElementById('roleEditorText').value = M.getRole(data())[key] || '';
        document.getElementById('roleOverlay').style.display = 'flex';
    };
    window.closeRoleEditor = function() {
        document.getElementById('roleOverlay').style.display = 'none';
    };
    window.saveRoleEditor = function() {
        if (!editingRoleKey) return;
        var patch = {};
        patch[editingRoleKey] = document.getElementById('roleEditorText').value;
        M.updateRole(patch);
        closeRoleEditor();
        toast('角色档案已保存');
        renderTab('role');
    };

    /* ══════════ 写回忆信 ══════════ */

    function loadSettings() {
        try {
            var raw = (typeof AndroidSettings !== 'undefined' && AndroidSettings && AndroidSettings.loadSettings)
                ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
            return raw ? JSON.parse(raw) : {};
        } catch(e) { return {}; }
    }

    function openLetterDialog() {
        var d = data();
        var eps = (d.episodes || []).filter(function(e) { return e && e.status === 'active'; });
        var info = '最近共记下 ' + eps.length + ' 段情节记忆';
        var s = loadSettings();
        if (s.lastDreamAt) {
            var dd = new Date(s.lastDreamAt);
            info += '<br>上次写信: ' + dd.getFullYear() + '-' + (dd.getMonth() + 1) + '-' + dd.getDate();
        } else {
            info += '<br>这会是第一封';
        }
        document.getElementById('letterDialogInfo').innerHTML = info;
        document.getElementById('letterOverlay').style.display = 'flex';
    }
    function closeLetterDialog() {
        document.getElementById('letterOverlay').style.display = 'none';
    }
    function confirmLetter() {
        closeLetterDialog();
        triggerLetter();
    }

    function triggerLetter() {
        if (!M || typeof NativeHttp === 'undefined') { toast('记忆系统不可用'); return; }
        var d = data();
        var eps = (d.episodes || []).filter(function(e) { return e && e.status === 'active'; }).slice(0, 20);
        if (!eps.length) { toast('还没有值得写信的回忆'); return; }
        var config = loadSettings();
        if (!config || !config.apiUrl || !config.apiKey) { toast('请先配置 AI 参数'); return; }
        var lines = eps.map(function(e, i) {
            return (i + 1) + '. ' + dateOf(e.occurredAt) + '（' + (e.emotion || '其他') + '）' + (e.title ? e.title + '：' : '') + e.summary;
        }).join('\n');
        toast('正在写信…');
        NativeHttp.postJson(NativeHttp.chatEndpoint(config.apiUrl), { Authorization: 'Bearer ' + config.apiKey }, {
            model: config.model || 'gpt-4o',
            messages: [
                { role: 'system', content: M.TASK_PROMPTS.letterSystem },
                { role: 'user', content: '以下是你最近和用户一起经历的时刻：\n\n' + lines + '\n\n请给用户写一封回忆信。' }
            ],
            temperature: 0.8,
            max_tokens: 700
        }).then(function(resp) {
            var text = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
            if (text) {
                text = text.replace(/思考[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                if (text.length > 10) {
                    saveLetterMail('小满的' + (new Date().getMonth() + 1) + '月回忆信', text);
                    recordLetterTime();
                    toast('回忆信已送到信箱');
                    return;
                }
            }
            toast('写信失败，稍后再试');
        }, function() { toast('写信失败，请检查网络'); });
    }

    function saveLetterMail(subject, message) {
        var mail = {
            id: 'mail_' + Date.now(), noteContent: subject, penpalId: 'nian', penpalName: '小满',
            sentAt: Date.now().toString(), status: 'replied', reply: message,
            replyAt: Date.now().toString(), read: false, isProactive: true
        };
        try {
            if (typeof AndroidMail !== 'undefined' && AndroidMail.upsertMail) {
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

    function recordLetterTime() {
        try {
            var s = loadSettings();
            s.lastDreamAt = Date.now();
            if (typeof AndroidSettings !== 'undefined' && AndroidSettings.saveSettings) AndroidSettings.saveSettings(JSON.stringify(s));
            else localStorage.setItem('nian_settings', JSON.stringify(s));
        } catch(e) {}
    }

    /* ══════════ Utils ══════════ */

    function toast(msg) {
        var t = document.getElementById('dreamingToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'dreamingToast';
            t.className = 'memory-toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._timer);
        t._timer = setTimeout(function() { t.classList.remove('show'); }, 2600);
    }

    function goBack() {
        if (typeof AndroidStorage !== 'undefined') window.location.href = '../app.html';
        else history.back();
    }

    window.switchTab = switchTab;
    window.goBack = goBack;
    window.openLetterDialog = openLetterDialog;
    window.closeLetterDialog = closeLetterDialog;
    window.confirmLetter = confirmLetter;

    init();
})();
