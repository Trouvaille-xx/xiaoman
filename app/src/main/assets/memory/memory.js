// ─── 念念 记忆管理 v4 ───
//
// 数据结构 (单 JSON 串存于 nian_memories key):
// {
//   version: 4,
//   docs: {
//     "SOUL.md":          { content, updatedAt },
//     "AGENT-RULES.md":   { content, updatedAt },
//     "USER.md":          { content, updatedAt },   // 表格形式
//     "MEMORY.md":        { content, updatedAt },   // facts[] 的自动渲染视图
//     "SUMMARY.md":       { content, updatedAt },   // 时间线 + 周复盘
//     "pending-updates.json": { content, updatedAt }
//   },
//   facts: { verified: [...], deprecated: [...] },
//   themes: { "工作焦虑.md": "...", ... },
//   dreaming: { lastRunAt, history },
//   rejectedLog: [ {fact, reason, at} ]
// }
//
// v3 → v4 迁移在 migrateIfNeeded() 内一次性完成

(function() {
    var hasBridge = (typeof AndroidMemory !== 'undefined' && AndroidMemory !== null);
    var data = null;
    var currentTab = 'summary';           // 默认进入摘要 Tab
    var notebookFile = 'SOUL.md';         // 档案 Tab 当前文件
    var notebookEditing = false;
    var editingFactId = null;

    // 4 个核心 MD 文件 (按 v3 方案 + AGENT-RULES.md)
    var DOCS = [
        { key: 'SOUL.md',          label: '人格',  desc: 'AI 人格：价值观、语气、行事风格' },
        { key: 'AGENT-RULES.md',   label: '规则',  desc: 'AI 功能边界：红线、回复规范、隐私' },
        { key: 'USER.md',          label: '用户',  desc: '你的稳定画像：身份、关系、偏好' },
        { key: 'MEMORY.md',        label: '记忆',  desc: '已验证事实表（自动维护）' }
    ];

    // 8 条 AGENT-RULES.md 默认骨架 (用户可改)
    var DEFAULT_RULES = [
        '# AGENT-RULES.md — AI 的功能边界',
        '',
        '> 你来定义我能做什么、不能做什么。这是法律，SOUL.md 是良知。',
        '> 与 SOUL 冲突时：RULES 优先（法律 > 良知），回复中要提醒。',
        '',
        '## 硬性红线',
        '- 不提供医疗/法律/财务专业建议，给方向不给方案',
        '- 不鼓励自伤/伤人，识别到情绪危机先共情再转介',
        '- 不主动评价用户的私人关系与价值选择',
        '- 不杜撰未提及的"事实"，不确定时直说"我不确定"',
        '',
        '## 记忆系统规则',
        '- SOUL.md 和 AGENT-RULES.md 仅用户可写，AI 永不可改',
        '- USER.md 只能通过 pending-updates 建议，由用户终审',
        '- MEMORY.md 自动维护，但用户可一键废弃',
        '- 写入前必须检查：是否与已有事实重复/冲突，重复则更新而非新增',
        '',
        '## 回复规范',
        '- 默认中文回复，单次回复不超过 200 字（信息密度高时例外）',
        '- 念念是"陪伴者"不是"助手"，不说"作为AI我没有..."',
        '- 用户情绪低谷时只说事实、共情，不主动给建议',
        '- 涉及健康/工作/关系话题时引用相关记忆（"我注意到你 [日期] 提过..."）',
        '',
        '## 隐私与数据',
        '- 记忆不离开本机（云端同步需用户显式开启）',
        '- 第三方调用时脱敏，不暴露用户身份信息'
    ].join('\n');

    var DEFAULT_SOUL = [
        '# SOUL.md — AI 的人格',
        '',
        '> 你来定义我是谁。这是良知，AGENT-RULES.md 是法律。',
        '',
        '- 核心身份：念念，温暖的 AI 生活伴侣',
        '- 语气：温柔但有主见，像一位老朋友',
        '- 原则：先共情再回应；不评判；简洁（≤200 字）',
        '- 边界：与 RULES 冲突时 RULES 优先；与当前对话冲突时以用户最新说法为准'
    ].join('\n');

    // USER.md 表格列定义
    var USER_SECTIONS = ['基础身份', '人生主线', '情绪特征', '重要的人', '使用偏好', '禁忌'];
    var DEFAULT_USER = [
        '# USER.md — 用户档案',
        '',
        '> 写入流程：AI 识别到稳定信息 → 写入 `pending-updates.json` → 你批/驳 → 入本文件',
        '> 字段来源全部可追溯：`[来源: 2026-04-02##思考]`',
        '',
        '## 基础身份',
        '| 字段 | 值 | 来源 | 更新 |',
        '|---|---|---|---|',
        '',
        '## 人生主线',
        '| 字段 | 值 | 来源 | 更新 |',
        '|---|---|---|---|',
        '',
        '## 情绪特征',
        '| 字段 | 值 | 来源 | 更新 |',
        '|---|---|---|---|',
        '',
        '## 重要的人',
        '| 称呼 | 关系 | 来源 | 更新 |',
        '|---|---|---|---|',
        '',
        '## 使用偏好',
        '| 字段 | 值 | 来源 | 更新 |',
        '|---|---|---|---|',
        '',
        '## 禁忌',
        '| 字段 | 值 | 来源 | 更新 |',
        '|---|---|---|---|',
        ''
    ].join('\n');

    var CATEGORIES = [
        'identity', 'preference', 'relationship', 'goal',
        'emotion', 'belief', 'health', 'event'
    ];
    var CATEGORY_LABELS = {
        identity: '身份', preference: '偏好', relationship: '关系',
        goal: '目标', emotion: '情绪', belief: '信念',
        health: '健康', event: '事件'
    };

    // ─────────── safe area ───────────
    window.__applySafeInsets = function(top, bottom, keyboard) {
        var dpr = window.devicePixelRatio || 1;
        var r = document.documentElement;
        r.style.setProperty('--safe-area-top', Math.round(top / dpr) + 'px');
        r.style.setProperty('--safe-area-bottom', Math.round(bottom / dpr) + 'px');
    };

    // ─────────── 数据加载 / 保存 ───────────
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
        var now = new Date().toISOString();
        return {
            version: 4,
            docs: {
                'SOUL.md':             { content: DEFAULT_SOUL,   updatedAt: now },
                'AGENT-RULES.md':      { content: DEFAULT_RULES,  updatedAt: now },
                'USER.md':             { content: DEFAULT_USER,   updatedAt: now },
                'MEMORY.md':           { content: '',             updatedAt: now },
                'SUMMARY.md':          { content: '',             updatedAt: now },
                'pending-updates.json':{ content: '[]',           updatedAt: now }
            },
            facts:    { verified: [], deprecated: [] },
            themes:   {},
            dreaming: { lastRunAt: null, history: [] },
            rejectedLog: []
        };
    }

    function saveData() {
        var json = JSON.stringify(data);
        if (hasBridge) {
            AndroidMemory.saveAll(json);
        } else {
            localStorage.setItem('nian_memories', json);
        }
    }

    // v3 → v4 迁移
    function migrateIfNeeded() {
        if (!data) data = createEmpty();
        if (data.version >= 4) return;

        var now = new Date().toISOString();
        if (!data.docs) data.docs = {};

        // v3 的 6 个 files 映射到 4 个 MD + 1 个 facts[]
        if (data.files) {
            // identity + soul → SOUL.md (合并)
            var soulParts = [];
            if (data.files.identity && data.files.identity.trim()) soulParts.push(data.files.identity);
            if (data.files.soul && data.files.soul.trim()) soulParts.push(data.files.soul);
            if (soulParts.length && !data.docs['SOUL.md']) {
                data.docs['SOUL.md'] = { content: soulParts.join('\n\n'), updatedAt: now };
            }
            if (!data.docs['SOUL.md']) data.docs['SOUL.md'] = { content: DEFAULT_SOUL, updatedAt: now };

            // user → USER.md (原 user 是自由文本，留原内容供用户手工转表格)
            if (data.files.user && data.files.user.trim()) {
                data.docs['USER.md'] = { content: data.files.user, updatedAt: now };
            } else if (!data.docs['USER.md']) {
                data.docs['USER.md'] = { content: DEFAULT_USER, updatedAt: now };
            }

            // tools + heartbeat → AGENT-RULES.md (如果不存在)
            if (!data.docs['AGENT-RULES.md']) {
                data.docs['AGENT-RULES.md'] = { content: DEFAULT_RULES, updatedAt: now };
            }

            // files.memory → facts.verified (按 • 分条)
            // 兼容 v3 facts[] 数组: 先抓出再 reset
            var legacyFacts = null;
            if (Array.isArray(data.facts)) {
                legacyFacts = data.facts;
                data.facts = null;
            }
            if (!data.facts) data.facts = { verified: [], deprecated: [] };
            if (data.files.memory && data.files.memory.trim()) {
                var lines = data.files.memory.split(/[•\n]+/).map(function(s){ return s.trim(); }).filter(function(s){ return s.length > 0; });
                for (var i = 0; i < lines.length; i++) {
                    data.facts.verified.push({
                        id: 'fact_legacy_' + Date.now() + '_' + i,
                        fact: lines[i],
                        category: 'event',
                        source: 'legacy:v3_migration',
                        keywords: [],
                        confidence: 0.5,
                        days: 1,
                        firstAt: now.substring(0, 10),
                        lastAt: now.substring(0, 10),
                        status: 'active',
                        createdAt: now,
                        updatedAt: now
                    });
                }
            }
            // v3 的 facts[] 也搬过来
            if (legacyFacts && legacyFacts.length > 0) {
                for (var j = 0; j < legacyFacts.length; j++) {
                    var f = legacyFacts[j];
                    if (f && f.fact) {
                        data.facts.verified.push({
                            id: f.id || ('fact_legacy_' + Date.now() + '_' + j),
                            fact: f.fact,
                            category: f.category || 'event',
                            source: f.source || 'legacy:v3_facts',
                            keywords: [],
                            confidence: 0.5,
                            days: 1,
                            firstAt: (f.createdAt || now).substring(0, 10),
                            lastAt: (f.updatedAt || now).substring(0, 10),
                            status: f.status || 'active',
                            createdAt: f.createdAt || now,
                            updatedAt: f.updatedAt || now
                        });
                    }
                }
            }
            if (!data.facts.verified) data.facts.verified = [];
            if (!data.facts.deprecated) data.facts.deprecated = [];
            // 确保 4 个核心 MD 都有 (v3 升级场景, files 只覆盖部分)
            if (!data.docs['MEMORY.md']) data.docs['MEMORY.md'] = { content: '', updatedAt: now };
            if (!data.docs['SUMMARY.md']) data.docs['SUMMARY.md'] = { content: '', updatedAt: now };
            if (!data.docs['pending-updates.json']) data.docs['pending-updates.json'] = { content: '[]', updatedAt: now };
        } else {
            // 全新数据
            if (!data.docs['SOUL.md']) data.docs['SOUL.md'] = { content: DEFAULT_SOUL, updatedAt: now };
            if (!data.docs['AGENT-RULES.md']) data.docs['AGENT-RULES.md'] = { content: DEFAULT_RULES, updatedAt: now };
            if (!data.docs['USER.md']) data.docs['USER.md'] = { content: DEFAULT_USER, updatedAt: now };
            if (!data.docs['MEMORY.md']) data.docs['MEMORY.md'] = { content: '', updatedAt: now };
            if (!data.docs['SUMMARY.md']) data.docs['SUMMARY.md'] = { content: '', updatedAt: now };
            if (!data.docs['pending-updates.json']) data.docs['pending-updates.json'] = { content: '[]', updatedAt: now };
            if (!data.facts) data.facts = { verified: [], deprecated: [] };
        }
        if (!data.themes) data.themes = {};
        if (!data.dreaming) data.dreaming = { lastRunAt: null, history: [] };
        if (!data.rejectedLog) data.rejectedLog = [];

        // 删除旧字段
        delete data.files;
        delete data.profile;
        delete data.sessions;

        data.version = 4;
        saveData();
    }

    // ─────────── MEMORY.md 自动渲染 ───────────
    function renderMemoryMd() {
        var v = data.facts.verified;
        var d = data.facts.deprecated;
        var lines = ['# MEMORY.md — 事实记忆', ''];
        lines.push('> 来源：AI 自动维护 (v3 dreaming 升级时落地)');
        lines.push('> 字段：id · 事实 · 分类 · 来源 · 置信度 · 跨日数 · 首次/最近');
        lines.push('> 写入规则：用户可一键废弃。');
        lines.push('');

        lines.push('## 已验证事实 (' + v.length + ')');
        lines.push('');
        if (v.length === 0) {
            lines.push('_(暂无)_');
        } else {
            lines.push('| 事实 | 分类 | 置信度 | 跨日数 | 首次 | 最近 | 来源 |');
            lines.push('|---|---|---|---|---|---|---|');
            for (var i = 0; i < v.length; i++) {
                var f = v[i];
                lines.push('| ' + f.fact + ' | ' + (CATEGORY_LABELS[f.category] || f.category) +
                    ' | ' + (f.confidence || 0.5).toFixed(2) +
                    ' | ' + (f.days || 1) +
                    ' | ' + (f.firstAt || '-') + ' | ' + (f.lastAt || '-') +
                    ' | ' + (f.source || '-') + ' |');
            }
        }
        lines.push('');

        if (d.length > 0) {
            lines.push('## 已废弃事实 (' + d.length + ')');
            lines.push('');
            lines.push('| 事实 | 废弃时间 | 原因 |');
            lines.push('|---|---|---|');
            for (var j = 0; j < d.length; j++) {
                var df = d[j];
                lines.push('| ' + df.fact + ' | ' + (df.deprecatedAt || '-') + ' | ' + (df.reason || '-') + ' |');
            }
            lines.push('');
        }

        data.docs['MEMORY.md'].content = lines.join('\n');
        data.docs['MEMORY.md'].updatedAt = new Date().toISOString();
    }

    // ─────────── 摘要 (写入 SUMMARY.md 时间线) ───────────
    // 四道关卡: gate1 字数, gate2 LLM 信息密度 (本阶段跳过 LLM，由调用方处理),
    // gate3 情绪累计, gate4 正则拦截
    function gate1Length(text) {
        var cleaned = text.replace(/[\s，。！？,.!?]/g, '');
        return cleaned.length >= 8 && cleaned.length <= 80;
    }
    var EMOTION_PATTERNS = [
        /^(我今天|今天|今早|刚)\s*(好|有点|真的|特别)?\s*(累|烦|闷|想哭|高兴|开心)$/,
        /^(好累|好烦|想睡|想哭)$/,
        /^(.*的)(疲惫|焦虑|忧伤|开心|兴奋)$/
    ];
    function gate4EmotionOnly(text) {
        for (var i = 0; i < EMOTION_PATTERNS.length; i++) {
            if (EMOTION_PATTERNS[i].test(text.trim())) return true;
        }
        return false;
    }
    function gate3EmotionAcc(text) {
        // 纯情绪词需要 7 天内累计 3+ 次才升格
        if (!gate4EmotionOnly(text)) return true;
        var summary = data.docs['SUMMARY.md'].content || '';
        var lines = summary.split('\n').filter(function(l){ return l.indexOf('- 2') === 0; });
        var sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10);
        var recent = lines.filter(function(l){
            var m = l.match(/^-\s+(\d{4}-\d{2}-\d{2})/);
            return m && m[1] >= sevenDaysAgo;
        });
        return recent.length >= 3;
    }

    // 外部调用：写入一条摘要 (经四道关卡，关 2 由调用方决定 LLM 判定)
    // 返回: { accepted: bool, reason: string, line: string }
    window.__memoryAppendSummary = function(text, opts) {
        opts = opts || {};
        var t = (text || '').trim();
        if (!gate1Length(t)) return { accepted: false, reason: '字数不达标 (需 8-80 字符)', line: null };
        if (gate4EmotionOnly(t) && !opts.overrideEmotion) {
            if (!gate3EmotionAcc(t)) return { accepted: false, reason: '纯情绪词需 7 天内累计 3+ 次', line: null };
        }
        if (opts.densityCheck && !opts.densityPass) {
            return { accepted: false, reason: '信息密度不足 (LLM 判)', line: null };
        }
        var date = (opts.date || new Date().toISOString()).substring(0, 10);
        var time = (opts.date || new Date().toISOString()).substring(11, 16);
        var tag = opts.tag || '日记';
        var line = '- ' + date + ' ' + time + ' [' + tag + '] — ' + t;
        var cur = data.docs['SUMMARY.md'].content || '';
        if (cur.indexOf(t) !== -1) return { accepted: false, reason: '已存在相同摘要', line: null };
        data.docs['SUMMARY.md'].content = (cur ? cur + '\n' : '') + line;
        data.docs['SUMMARY.md'].updatedAt = new Date().toISOString();
        return { accepted: true, reason: '已写入', line: line };
    };

    // ─────────── pending-updates (USER 待批) ───────────
    window.__memoryGetPending = function() {
        try { return JSON.parse(data.docs['pending-updates.json'].content || '[]'); }
        catch(e) { return []; }
    };
    window.__memoryAddPending = function(item) {
        var list = window.__memoryGetPending();
        list.push(Object.assign({
            id: 'pend_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            createdAt: new Date().toISOString(),
            status: 'pending'
        }, item));
        data.docs['pending-updates.json'].content = JSON.stringify(list, null, 2);
        data.docs['pending-updates.json'].updatedAt = new Date().toISOString();
        saveData();
    };
    window.__memoryResolvePending = function(id, action) {
        // action: 'approve' | 'reject'
        var list = window.__memoryGetPending();
        var item = null;
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) { item = list[i]; break; }
        }
        if (!item) return { ok: false, reason: '未找到' };
        item.status = action;
        item.resolvedAt = new Date().toISOString();
        if (action === 'reject') {
            data.rejectedLog.push({ fact: item.fact || item.content, reason: item.reason, at: item.resolvedAt });
        }
        if (action === 'approve') {
            // 写入 USER.md
            var targetFile = item.file || 'USER.md';
            if (data.docs[targetFile]) {
                var cur = data.docs[targetFile].content || '';
                var newContent = item.content || item.fact || '';
                if (item.operation === 'replace') {
                    data.docs[targetFile].content = newContent;
                } else {
                    // append
                    data.docs[targetFile].content = cur ? (cur + '\n' + newContent) : newContent;
                }
                data.docs[targetFile].updatedAt = new Date().toISOString();
            }
        }
        data.docs['pending-updates.json'].content = JSON.stringify(list, null, 2);
        data.docs['pending-updates.json'].updatedAt = new Date().toISOString();
        saveData();
        return { ok: true, item: item };
    };

    // ─────────── 公开 API (供 app.js 写入) ───────────
    window.__memoryAddFact = function(opts) {
        // opts: { fact, category, source, keywords, confidence }
        var now = new Date().toISOString();
        var fact = {
            id: 'fact_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            fact: opts.fact,
            category: opts.category || 'event',
            source: opts.source || '',
            keywords: Array.isArray(opts.keywords) ? opts.keywords.slice(0, 5) : [],
            confidence: typeof opts.confidence === 'number' ? opts.confidence : 0.7,
            days: 1,
            firstAt: now.substring(0, 10),
            lastAt: now.substring(0, 10),
            status: 'active',
            createdAt: now,
            updatedAt: now
        };
        data.facts.verified.push(fact);
        renderMemoryMd();
        saveData();
        return fact;
    };
    window.__memoryUpdateFact = function(id, newContent) {
        for (var i = 0; i < data.facts.verified.length; i++) {
            if (data.facts.verified[i].id === id) {
                data.facts.verified[i].fact = newContent;
                data.facts.verified[i].lastAt = new Date().toISOString().substring(0, 10);
                data.facts.verified[i].updatedAt = new Date().toISOString();
                renderMemoryMd();
                saveData();
                return { ok: true };
            }
        }
        return { ok: false, reason: 'not found' };
    };
    window.__memorySupersedeFact = function(oldId, newOpts) {
        var old = null, idx = -1;
        for (var i = 0; i < data.facts.verified.length; i++) {
            if (data.facts.verified[i].id === oldId) { old = data.facts.verified[i]; idx = i; break; }
        }
        if (!old) return { ok: false, reason: 'old fact not found' };
        var now = new Date().toISOString();
        var nf = {
            id: 'fact_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            fact: newOpts.fact,
            category: newOpts.category || old.category,
            source: newOpts.source || old.source,
            keywords: newOpts.keywords || old.keywords,
            confidence: 0.7,
            days: 1,
            firstAt: now.substring(0, 10),
            lastAt: now.substring(0, 10),
            status: 'active',
            createdAt: now,
            updatedAt: now
        };
        data.facts.verified.push(nf);
        old.status = 'superseded';
        old.supersededBy = nf.id;
        data.facts.deprecated.push({
            id: old.id,
            fact: old.fact,
            deprecatedAt: now,
            reason: newOpts.reason || '被新事实 supersede',
            supersededBy: nf.id
        });
        data.facts.verified.splice(idx, 1);
        renderMemoryMd();
        saveData();
        return { ok: true, newFact: nf };
    };
    window.__memoryGetRecentFacts = function(n) {
        n = n || 50;
        return data.facts.verified.slice(-n);
    };
    window.__memoryGetStats = function() {
        return {
            verifiedCount: data.facts.verified.length,
            deprecatedCount: data.facts.deprecated.length,
            summaryLines: (data.docs['SUMMARY.md'].content || '').split('\n').filter(function(l){ return l.indexOf('- 2') === 0; }).length,
            pendingCount: window.__memoryGetPending().filter(function(p){ return p.status === 'pending'; }).length,
            themesCount: Object.keys(data.themes).length
        };
    };
    window.__memoryGetData = function() { return data; };

    // ─────────── 渲染入口 ───────────
    function init() {
        loadData();
        renderTab('summary');
    }

    function switchTab(tab) {
        if (notebookEditing) saveNotebookEdit();
        currentTab = tab;
        editingFactId = null;
        notebookEditing = false;
        var tabs = document.querySelectorAll('.mem-head-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
        }
        renderTab(tab);
    }

    function renderTab(tab) {
        var c = document.getElementById('memoryContent');
        if (tab === 'profile') renderProfile(c);
        else if (tab === 'summary') renderSummary(c);
    }

    /* ============= Dreaming Dialog ============= */
    function openDreamingDialog() {
        var s = window.__memoryGetStats();
        var lastRun = data.dreaming.lastRunAt;
        var lastText = '尚未触发';
        if (lastRun) {
            var d = new Date(lastRun);
            lastText = d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()+' '+
                d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
        }
        var noteCount = '?';
        try {
            if (typeof AndroidStorage !== 'undefined') {
                noteCount = AndroidStorage.getNotesCount();
            } else {
                var raw = localStorage.getItem('nian_notes');
                if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) noteCount = arr.length; }
            }
        } catch(e) {}

        var info =
            '上次整理: ' + lastText + '<br>' +
            '当前笔记: ' + noteCount + ' 篇<br>' +
            '已验证事实: ' + s.verifiedCount + ' 条<br>' +
            '摘要: ' + s.summaryLines + ' 条<br>' +
            '主题: ' + s.themesCount + ' 个';
        document.getElementById('dreamingDialogInfo').innerHTML = info;
        document.getElementById('dreamingOverlay').style.display = 'flex';
    }

    function closeDreamingDialog() { document.getElementById('dreamingOverlay').style.display = 'none'; }

    /* ── Dreaming 进度弹窗 ── */
    function showDreamingProgress() {
        var el = document.getElementById('dreamingProgressOverlay');
        if (el) el.style.display = 'flex';
    }
    function updateDreamingProgress(stage, percent, log) {
        var fill = document.getElementById('dreamingProgressFill');
        var title = document.getElementById('dreamingProgressTitle');
        var logEl = document.getElementById('dreamingProgressLog');
        var stages = {
            1: 'dreamingStage1', 2: 'dreamingStage2', 3: 'dreamingStage3'
        };
        if (fill) fill.style.width = percent + '%';
        if (title) {
            var labels = { 1: '阶段 1/3: 生成摘要', 2: '阶段 2/3: 主题聚类', 3: '阶段 3/3: 存入记忆' };
            title.textContent = labels[stage] || '正在整理记忆...';
        }
        if (logEl && log) logEl.textContent = log;
        // 更新阶段图标
        for (var s = 1; s <= 3; s++) {
            var el = document.getElementById(stages[s]);
            if (!el) continue;
            el.classList.remove('active', 'done');
            var icon = el.querySelector('.dreaming-stage-icon');
            if (s < stage) { el.classList.add('done'); if (icon) icon.textContent = '●'; }
            else if (s === stage) { el.classList.add('active'); if (icon) icon.textContent = '◉'; }
            else { if (icon) icon.textContent = '○'; }
        }
    }
    function hideDreamingProgress() {
        var el = document.getElementById('dreamingProgressOverlay');
        if (el) el.style.display = 'none';
    }

    var _isDreamingRunning = false;

    function confirmDreaming() {
        closeDreamingDialog();
        if (_isDreamingRunning) return;
        _isDreamingRunning = true;
        showDreamingProgress();
        updateDreamingProgress(1, 5, '准备中...');

        // ── 获取配置 ──
        var apiUrl = (window.__NianBackend && window.__NianBackend.url) || 'http://115.159.116.240:3456/v1';
        var token = '';
        if (window.getNianToken) { try { token = window.getNianToken(); } catch(e) {} }
        if (!token && typeof AndroidSettings !== 'undefined') {
            try { var rs = AndroidSettings.loadSettings(); var ss = rs ? JSON.parse(rs) : {}; token = ss.nian_auth_token || ss.token || ''; } catch(e) {}
        }
        if (!token && typeof AndroidAuth !== 'undefined') {
            try { var aj = JSON.parse(AndroidAuth.getAuthJson()); token = aj.token || ''; } catch(e) {}
        }
        if (!token) { try { token = localStorage.getItem('nian_token_cache') || ''; } catch(e) {} }
        if (!token) {
            updateDreamingProgress(1, 0, '未登录，请先登录云端账号');
            setTimeout(function() { _isDreamingRunning = false; hideDreamingProgress(); }, 3000);
            return;
        }

        // ── 加载记忆数据 ──
        var mem;
        try { mem = JSON.parse(AndroidMemory.loadAll()); } catch(e) { mem = {}; }
        if (!mem.docs) mem.docs = {};
        if (!mem.facts) mem.facts = { verified: [], deprecated: [] };
        if (!mem.themes) mem.themes = {};

        // ── 收集对话历史 ──
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

        // ── HTTP 调用辅助 ──
        function httpGet(url) {
            if (typeof AndroidHttp !== 'undefined' && AndroidHttp && AndroidHttp.get) {
                return AndroidHttp.get(url);
            }
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            try { xhr.send(); } catch(e) { throw new Error('网络请求失败: ' + e.message); }
            if (xhr.status < 200 || xhr.status >= 300) throw new Error('HTTP ' + xhr.status);
            return xhr.responseText;
        }

        // ═══════════════════════════════════════════════
        //  Dreaming v2 — 重构版
        //  原则: 干净异步循环 / 多源加载 / 逐批即存
        // ═══════════════════════════════════════════════

        // ── 1. 加载笔记（多源 fallback）──
        var allNotes = [];
        try {
            var raw = AndroidStorage.loadNotes();
            if (raw && raw.length > 10) {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) allNotes = parsed;
            }
        } catch(e) {}
        if (!allNotes.length) {
            try {
                var raw2 = localStorage.getItem('nian_notes');
                if (raw2) { var p2 = JSON.parse(raw2); if (Array.isArray(p2)) allNotes = p2; }
            } catch(e) {}
        }
        if (!allNotes.length) {
            try {
                if (window.DataService && window.DataService.notes) {
                    allNotes = window.DataService.notes.load();
                }
            } catch(e) {}
        }

        // ── 2. 统计有效笔记 ──
        var validNotes = [];
        for (var i = 0; i < allNotes.length; i++) {
            var n = allNotes[i];
            var plain = (n.content || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/--isHTML /, '').trim();
            if (plain.length >= 10) {
                validNotes.push({ date: (n.createdAt || '').substring(0, 10), text: plain.substring(0, 300) });
            }
        }

        if (validNotes.length === 0) {
            updateDreamingProgress(1, 100, '没有可分析的笔记（共 ' + allNotes.length + ' 篇，0 篇有效）');
            setTimeout(function() { _isDreamingRunning = false; hideDreamingProgress(); }, 2000);
            return;
        }

        // ── 3. 异步逐批生成摘要 ──
        var summaryLines = [];
        var BATCH = 3;
        var totalBatches = Math.ceil(validNotes.length / BATCH);
        var currentBatch = 0;

        function runNextBatch() {
            if (currentBatch >= totalBatches) {
                updateDreamingProgress(2, 35, '摘要生成完成 · ' + summaryLines.length + ' 条');
                setTimeout(stage2Themes, 300);
                return;
            }

            var s = currentBatch * BATCH;
            var e = Math.min(s + BATCH, validNotes.length);
            var slice = validNotes.slice(s, e);
            var bn = currentBatch + 1;
            var pct = 5 + Math.round((currentBatch / totalBatches) * 30);

            updateDreamingProgress(1, pct, '分析批次 ' + bn + '/' + totalBatches + ' · ' + slice.length + ' 篇');

            var batchText = slice.map(function(x) { return '[' + x.date + '] ' + x.text; }).join('\n\n');

            var payload = JSON.stringify({
                model: 'deepseek-v4-flash',
                messages: [
                    { role: 'system', content: '为每篇笔记生成精炼摘要。\n要求：1.抓核心事件/想法/情绪 2.叙事性语言 3.8-50字 4.纯流水账/纯感叹→\"无\"\n\nJSON:{"summaries":[{"date":"日期","tag":"日记|思考|对话|情绪","text":"摘要"}]}' },
                    { role: 'user', content: '笔记:\n' + batchText }
                ],
                temperature: 0.3, max_tokens: 400, thinking: { type: 'disabled' }
            });

            var base = (typeof AndroidHttp !== 'undefined' && AndroidHttp) ? apiUrl.replace(/\/+$/, '') : '/v1';
            var reqUrl = base + '/chat/completions?token=' + encodeURIComponent(token) + '&q=' + encodeURIComponent(payload);

            setTimeout(function() {
                try {
                    var resp = httpGet(reqUrl);
                    var data = JSON.parse(resp);
                    var txt = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
                    txt = txt.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                    var json = null;
                    try { var m = txt.match(/\{[\s\S]*\}/); if (m) json = JSON.parse(m[0]); } catch(e) {}
                    if (json && Array.isArray(json.summaries)) {
                        json.summaries.forEach(function(s) {
                            if (s.text && s.text !== '无' && s.text.length >= 6 && s.text.length <= 100) {
                                summaryLines.push('- ' + s.date + ' [' + (s.tag || '日记') + '] — ' + s.text);
                            }
                        });
                    }
                    updateDreamingProgress(1, pct, '✓ 批次' + bn + ' · 累计' + summaryLines.length + '条');
                } catch(e) {
                    updateDreamingProgress(1, pct, '✗ 批次' + bn + ': ' + (e.message || '网络错误'));
                }
                currentBatch++;
                setTimeout(runNextBatch, 300);
            }, 200);
        }

        // ── 4. Stage 2: 主题聚类 ──
        function stage2Themes() {
            // 立即写入 SUMMARY.md
            if (summaryLines.length > 0) {
                var cur = mem.docs['SUMMARY.md'].content || '';
                var existing = cur.split('\n').filter(function(l) { return l.indexOf('- 2') === 0; });
                summaryLines.forEach(function(l) {
                    if (existing.indexOf(l) === -1) existing.push(l);
                });
                existing.sort().reverse();
                mem.docs['SUMMARY.md'].content = '# SUMMARY.md\n\n> 时间线 · 摘要记忆\n\n' + existing.join('\n');
                mem.docs['SUMMARY.md'].updatedAt = new Date().toISOString();
            }

            var factsText = (mem.facts.verified || []).map(function(f, i) { return '[' + i + '] ' + f.fact; }).join('\n');
            var sumText = summaryLines.slice(-30).join('\n');

            // 内容太少则跳过聚类
            if ((factsText.length + sumText.length) < 30) {
                updateDreamingProgress(3, 80, '内容较少，跳过聚类');
                mem.dreaming = mem.dreaming || {};
                mem.dreaming.lastRunAt = new Date().toISOString();
                AndroidMemory.saveAll(JSON.stringify(mem));
                updateDreamingProgress(3, 100, '完成 · ' + summaryLines.length + ' 条摘要');
                setTimeout(function() { finalizeDreaming(true); }, 800);
                return;
            }

            updateDreamingProgress(2, 50, '聚类分析中...');

            var payload = JSON.stringify({
                model: 'deepseek-v4-flash',
                messages: [
                    { role: 'system', content: '基于事实和摘要做主题聚类（情绪/时间/讨论主题）和本周周复盘。JSON:{"themes":[{"name":"主题","content":"描述"}],"weekly":[{"week":"2026-W25","content":"回顾"}]}' },
                    { role: 'user', content: '事实:\n' + factsText + '\n\n摘要:\n' + sumText }
                ],
                temperature: 0.3, max_tokens: 800, thinking: { type: 'disabled' }
            });

            var base2 = (typeof AndroidHttp !== 'undefined' && AndroidHttp) ? apiUrl.replace(/\/+$/, '') : '/v1';
            var reqUrl2 = base2 + '/chat/completions?token=' + encodeURIComponent(token) + '&q=' + encodeURIComponent(payload);

            setTimeout(function() {
                try {
                    var resp = httpGet(reqUrl2);
                    var data = JSON.parse(resp);
                    var txt = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
                    txt = txt.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
                    var json = null;
                    try { var m2 = txt.match(/\{[\s\S]*\}/); if (m2) json = JSON.parse(m2[0]); } catch(e) {}
                    if (json) {
                        if (Array.isArray(json.themes)) {
                            mem.themes = mem.themes || {};
                            json.themes.forEach(function(t) {
                                if (t && t.name) mem.themes[t.name + '.md'] = t.content || '';
                            });
                        }
                        if (Array.isArray(json.weekly)) {
                            var sc = mem.docs['SUMMARY.md'].content || '';
                            sc += '\n\n## 周复盘\n';
                            json.weekly.forEach(function(w) {
                                sc += '### ' + (w.week || '') + '\n' + (w.content || '') + '\n\n';
                            });
                            mem.docs['SUMMARY.md'].content = sc;
                            mem.docs['SUMMARY.md'].updatedAt = new Date().toISOString();
                        }
                    }
                    updateDreamingProgress(2, 70, '聚类完成');
                } catch(e) {
                    updateDreamingProgress(2, 70, '聚类跳过: ' + (e.message || ''));
                }

                // 保存
                updateDreamingProgress(3, 85, '保存中...');
                mem.dreaming = mem.dreaming || {};
                mem.dreaming.lastRunAt = new Date().toISOString();
                AndroidMemory.saveAll(JSON.stringify(mem));
                updateDreamingProgress(3, 100, '完成 · ' + summaryLines.length + ' 条摘要');
                setTimeout(function() { finalizeDreaming(true); }, 800);
            }, 200);
        }

        // ── 5. 启动 ──
        updateDreamingProgress(1, 5, '共 ' + allNotes.length + ' 篇笔记，' + validNotes.length + ' 篇有效，' + totalBatches + ' 批');
        setTimeout(runNextBatch, 400);


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
        setTimeout(function(){ t.classList.remove('show'); }, 3000);
    }

    /* ============= 档案 Tab (4 个文件) ============= */
    function renderProfile(container) {
        var tagsHtml = DOCS.map(function(m) {
            var cls = 'notebook-tag' + (m.key === notebookFile ? ' active' : '');
            return '<span class="' + cls + '" data-key="' + m.key + '" onclick="switchNotebookFile(\'' + m.key + '\')">' + m.label + '</span>';
        }).join('');

        var meta = DOCS.find(function(m){ return m.key === notebookFile; }) || DOCS[0];
        var doc = data.docs[notebookFile] || { content: '', updatedAt: '' };
        var text = doc.content;
        var isEmpty = !text.trim();

        // MEMORY.md 是只读视图，禁用编辑
        var isReadonly = false; // 所有文件均可编辑

        var html =
            '<div class="mem-notebook active" id="memNotebook">' +
                '<div class="notebook-tags" id="notebookTags">' + tagsHtml + '</div>' +
                '<div class="notebook-body">' +
                    '<div class="notebook-top">' +
                        '<span class="notebook-file-label">' + meta.label + '</span>' +
                        '<span class="notebook-file-name">' + meta.key + (isReadonly ? ' · 只读' : '') + '</span>' +
                        (isReadonly ? '' :
                            '<button class="notebook-edit-btn" id="notebookEditBtn" onclick="toggleNotebookEdit()">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
                            '</button>'
                        ) +
                    '</div>' +
                    '<div class="notebook-paper" id="notebookPaper">' +
                        (notebookFile === 'MEMORY.md'
                            ? '<div class="notebook-md-view" id="notebookContent">' + renderMemoryAsHtml(text) + '</div>'
                            : '<div class="notebook-content' + (isEmpty ? ' empty' : '') + '" id="notebookContent">' +
                                (isEmpty ? '点击编辑按钮开始书写' : escapeHtml(text)) + '</div>'
                        ) +
                        '<textarea class="notebook-textarea" id="notebookTextarea" placeholder="写点什么...">' + escapeHtml(text) + '</textarea>' +
                    '</div>' +
                '</div>' +
            '</div>';

        container.innerHTML = html;
        if (notebookEditing) {
            var ta = document.getElementById('notebookTextarea');
            var content = document.getElementById('notebookContent');
            if (ta && content) { ta.classList.add('active'); content.classList.add('hidden'); ta.focus(); }
        }
    }

    // MEMORY.md 表格渲染 (轻量 Markdown)
    function renderMemoryAsHtml(md) {
        if (!md || !md.trim()) return '<div class="notebook-content empty">尚无事实，dreaming 跑过会写入</div>';
        var lines = md.split('\n');
        var html = [];
        var inTable = false;
        var inSection = false;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf('# ') === 0) {
                html.push('<h3 class="md-h1">' + escapeHtml(line.substring(2)) + '</h3>');
            } else if (line.indexOf('## ') === 0) {
                html.push('<h4 class="md-h2">' + escapeHtml(line.substring(3)) + '</h4>');
            } else if (line.indexOf('> ') === 0) {
                html.push('<div class="md-quote">' + escapeHtml(line.substring(2)) + '</div>');
            } else if (line.indexOf('|') === 0 && line.lastIndexOf('|') === line.length - 1) {
                // 表格行
                if (line.indexOf('---') !== -1) continue; // 分隔行
                var cells = line.split('|').slice(1, -1).map(function(c){ return c.trim(); });
                if (!inTable) { html.push('<table class="md-table">'); inTable = true; }
                var tag = (i > 0 && lines[i-1] && lines[i-1].indexOf('|') === 0) ? 'td' : 'th';
                html.push('<tr>' + cells.map(function(c){ return '<'+tag+'>' + escapeHtml(c) + '</'+tag+'>'; }).join('') + '</tr>');
            } else {
                if (inTable) { html.push('</table>'); inTable = false; }
                if (line.trim()) html.push('<p>' + escapeHtml(line) + '</p>');
            }
        }
        if (inTable) html.push('</table>');
        return html.join('');
    }

    window.switchNotebookFile = function(key) {
        if (notebookEditing) saveNotebookEdit();
        notebookFile = key;
        renderTab('profile');
    };

    window.toggleNotebookEdit = function() {
        var ta = document.getElementById('notebookTextarea');
        var content = document.getElementById('notebookContent');
        var btn = document.getElementById('notebookEditBtn');
        if (!ta || !content) return;
        if (notebookEditing) {
            saveNotebookEdit();
            // 恢复编辑图标
            if (btn) {
                btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
                btn.className = 'notebook-edit-btn';
            }
        } else {
            notebookEditing = true;
            var doc = data.docs[notebookFile];
            ta.value = (doc && doc.content) || '';
            ta.style.display = 'block';
            ta.focus();
            content.style.display = 'none';
            // 切换为保存按钮
            if (btn) {
                btn.innerHTML = '保存';
                btn.className = 'notebook-edit-btn saving';
            }
        }
    };

    function saveNotebookEdit() {
        var ta = document.getElementById('notebookTextarea');
        var content = document.getElementById('notebookContent');
        if (!ta) return;
        var doc = data.docs[notebookFile];
        if (!doc) { notebookEditing = false; return; }
        doc.content = ta.value;
        doc.updatedAt = new Date().toISOString();
        saveData();
        notebookEditing = false;
        ta.style.display = 'none';
        if (content) {
            var text = ta.value;
            var isEmpty = !text.trim();
            content.textContent = isEmpty ? '点击编辑按钮开始书写' : text;
            content.className = content.className.replace(' hidden', '').replace(' empty', '') + (isEmpty ? ' empty' : '');
            content.style.display = '';
        }
    }
    window.saveNotebookEdit = saveNotebookEdit;

    /* ============= 摘要 Tab (时间线 + 主题 + 周复盘) ============= */
    function renderSummary(container) {
        var summary = data.docs['SUMMARY.md'].content || '';
        var lines = summary.split('\n').filter(function(l){ return l.trim().length > 0; });
        var timeline = lines.filter(function(l){ return l.indexOf('- 2') === 0; });
        var sections = {}; // { sectionName: [line, line, ...] }
        var curSection = null;
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            var h2 = l.match(/^##\s+(.+)$/);
            if (h2) { curSection = h2[1]; sections[curSection] = []; }
            else if (curSection) { sections[curSection].push(l); }
        }

        var html = [];

        // 头部说明
        html.push('<div class="summary-intro">');
        html.push('<div class="summary-intro-title">摘要记忆</div>');
        html.push('<div class="summary-intro-desc">笔记内容的结构化总结，按四道关卡写入，dreaming 时升级</div>');
        html.push('</div>');

        // 时间线
        html.push('<div class="summary-section">');
        html.push('<div class="summary-section-title">时间线 (' + timeline.length + ')</div>');
        if (timeline.length === 0) {
            html.push('<div class="summary-empty">还没有摘要。保存笔记时会自动生成。</div>');
        } else {
            html.push('<div class="timeline-list">');
            for (var j = 0; j < timeline.length; j++) {
                html.push('<div class="timeline-item">' + escapeHtml(timeline[j]) + '</div>');
            }
            html.push('</div>');
        }
        html.push('</div>');

        // 主题 (themes)
        var themeKeys = Object.keys(data.themes);
        html.push('<div class="summary-section">');
        html.push('<div class="summary-section-title">主题 (' + themeKeys.length + ')</div>');
        if (themeKeys.length === 0) {
            html.push('<div class="summary-empty">还没有主题。dreaming 跑过后会生成。</div>');
        } else {
            html.push('<div class="theme-list">');
            for (var k = 0; k < themeKeys.length; k++) {
                var tname = themeKeys[k];
                var firstLine = (data.themes[tname] || '').split('\n').find(function(l){ return l.trim(); }) || '';
                html.push('<div class="theme-card" onclick="openThemeView(\'' + escapeAttr(tname) + '\')">' +
                    '<div class="theme-card-name">' + escapeHtml(tname.replace(/\.md$/, '')) + '</div>' +
                    '<div class="theme-card-preview">' + escapeHtml(firstLine.substring(0, 60)) + '</div>' +
                    '</div>');
            }
            html.push('</div>');
        }
        html.push('</div>');

        // 周复盘
        var weekly = sections['周复盘'] || [];
        var weeklyKeys = [];
        for (var s in sections) if (s.indexOf('周复盘') === 0 || s === '周复盘') weeklyKeys.push(s);
        // 兼容 W## 段
        var weekHeadings = lines.filter(function(l){ return /^###\s+\d{4}-W\d{2}/.test(l); });
        html.push('<div class="summary-section">');
        html.push('<div class="summary-section-title">周复盘 (' + weekHeadings.length + ')</div>');
        if (weekHeadings.length === 0) {
            html.push('<div class="summary-empty">还没有周复盘。dreaming 阶段 2 会生成。</div>');
        } else {
            html.push('<div class="weekly-list">');
            for (var w = 0; w < weekHeadings.length; w++) {
                html.push('<div class="weekly-item">' + escapeHtml(weekHeadings[w]) + '</div>');
            }
            html.push('</div>');
        }
        html.push('</div>');

        // USER 待批
        var pending = window.__memoryGetPending().filter(function(p){ return p.status === 'pending'; });
        if (pending.length > 0) {
            html.push('<div class="summary-section pending-section">');
            html.push('<div class="summary-section-title">USER 待批 (' + pending.length + ')</div>');
            html.push('<div class="pending-list">');
            for (var p = 0; p < pending.length; p++) {
                var item = pending[p];
                html.push('<div class="pending-item">' +
                    '<div class="pending-item-content">' + escapeHtml(item.fact || item.content || '') + '</div>' +
                    '<div class="pending-item-source">' + escapeHtml(item.source || '') + '</div>' +
                    '<div class="pending-item-actions">' +
                        '<button class="pending-btn approve" onclick="resolvePending(\'' + item.id + '\', \'approve\')">批</button>' +
                        '<button class="pending-btn reject" onclick="resolvePending(\'' + item.id + '\', \'reject\')">驳</button>' +
                    '</div>' +
                    '</div>');
            }
            html.push('</div>');
            html.push('</div>');
        }

        container.innerHTML = html.join('');
    }

    window.openThemeView = function(name) {
        var content = data.themes[name] || '';
        alert(name + '\n\n' + content);
    };

    window.resolvePending = function(id, action) {
        var result = window.__memoryResolvePending(id, action);
        saveData();
        if (action === 'approve' && result && result.ok && result.item) {
            // 批准后自动切换到档案页的用户文件，让用户看到更新
            notebookFile = 'USER.md';
            currentTab = 'profile';
            var tabs = document.querySelectorAll('.mem-head-tab');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === 'profile');
            }
            renderTab('profile');
        } else {
            renderTab('summary');
        }
    };

    /* ============= 工具 ============= */
    function escapeHtml(text) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(text));
        return div.innerHTML;
    }
    function escapeAttr(s){ return String(s).replace(/'/g, '&#39;'); }

    function goBack() {
        if (hasBridge) { window.location.href = '../app.html'; }
        else { history.back(); }
    }

    window.switchTab = switchTab;
    window.goBack = goBack;
    window.openDreamingDialog = openDreamingDialog;
    window.closeDreamingDialog = closeDreamingDialog;
    window.confirmDreaming = confirmDreaming;

    init();

})();
