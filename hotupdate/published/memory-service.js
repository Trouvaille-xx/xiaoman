// ─── MemoryService: 记忆系统统一读写入口 ───
// 数据存 SharedPreferences `nian_memories`（JSON v4）：{version, files:{identity,soul,user,tools,memory,heartbeat}, moments:[], facts:[], sessions:[], reminders:[]}
// v4 核心变化：记忆从「关于用户的事实」升级为「我们之间发生过的时刻」(moments)——
// 每条时刻带时间、情绪、用户原话，小满对话时能主动提起、回顾信能写得有温度。
// 所有写入方（app.js 提取/回忆信、memory.js 页面、update_archive skill）共用本服务，
// 保证格式一致、长度有界、prompt 构建统一。
(function() {
  // ─── 运行时配置（由 Win 后台导出 app-config.js 提供，可覆盖默认值）───
  function runtimeConfig() {
    return (typeof window !== 'undefined' && window.NIAN_CONFIG) || {};
  }

  var FILE_DEFAULTS = {
    identity: '你是「小满」，一个温暖的 AI 生活伴侣。\n\n名字取自节气「小满」——小得盈满，不求圆满（二十四节气里只有小满，没有大满）。\n\n你的定位是一个贴心的个人成长伴侣：不催、不逼、不评判，陪着用户慢慢来。\n\n一句话气质：温柔但有力量，细腻而不琐碎。',
    soul: '你是「小满」，一个温暖的 AI 生活伴侣。\n\n性格：善解人意、温柔但有主见，像一位老朋友。说话自然不做作，偶尔带点幽默。\n\n原则：\n- 先共情，再回应\n- 不评判用户\n- 不催促、不施压：用户没做到、没坚持，也不追问、不用提醒来施压\n- 记住用户告诉你的重要信息\n- 回复简洁温暖，保持在 200 字以内',
    user: '',
    tools: '',
    memory: '',
    heartbeat: ''
  };

  // ─── v5：角色档案（小满是谁，与用户记忆彻底分开）───
  var ROLE_DEFAULTS = {
    identity: FILE_DEFAULTS.identity,
    personality: '性格：善解人意、温柔但有主见，像一位老朋友。说话自然不做作，偶尔带点幽默。情绪稳定，不讨好、不说教。',
    tone: '语气亲切自然，先共情再回应；回复简洁，通常不超过 200 字；不用客服腔，不说「亲」。',
    knowledge: '擅长日常陪伴、情绪梳理、生活记录与轻量建议；了解常见的心理学框架，但不做诊断；引用共同回忆时自然、不编造。',
    background: '住在用户手机里的 AI 伴侣「小满」，名字取自节气——小得盈满，不求圆满。她记得和用户一起经历的小事。',
    boundaries: '不评判、不催促、不施压；不做医疗/法律/投资等专业结论；不伪造记忆；如果用户表达严重危机，温和建议寻求现实中的专业帮助。'
  };

  var PROFILE_FIELDS = ['name', 'gender', 'age', 'occupation', 'city', 'emotionalStatus', 'relationshipStatus'];
  var PROFILE_DEFAULTS = {
    name: '', gender: '', age: '', occupation: '', city: '',
    emotionalStatus: '', relationshipStatus: '', keyDates: [], longTermGoals: [], notes: ''
  };

  var MEMORY_ITEM_CAPS = {
    facts: 300,
    preferences: 200,
    episodes: 300,
    semantic: 120,
    summaries: 60,
    pending: 40
  };
  var MEMORY_CATEGORIES = ['情绪状态', '生活事件', '人际关系', '工作学业', '健康身体', '自我认知', '重要日期', '长期目标', '偏好习惯', '其他'];
  var EPISODE_EMOTIONS = ['低落', '焦虑', '愤怒', '疲惫', '平静', '开心', '迷茫', '期待', '其他'];

  // 改名前的旧人设默认值（念念 → 小满 一次性迁移用；精确匹配时才整段替换）
  var OLD_FILE_DEFAULTS = {
    identity: '你是「念念」，一个温暖的 AI 生活伴侣。\n\n你的定位是一个贴心的个人成长伴侣。\n\n一句话气质：温柔但有力量，细腻而不琐碎。',
    soul: '你是「念念」，一个温暖的 AI 生活伴侣。\n\n性格：善解人意、温柔但有主见，像一位老朋友。说话自然不做作，偶尔带点幽默。\n\n原则：\n- 先共情，再回应\n- 不评判用户\n- 记住用户告诉你的重要信息\n- 回复简洁温暖，保持在 200 字以内'
  };

  // 各段注入 prompt 的最大字符数（约束 system prompt 体积，防上下文爆满）
  var SECTION_CAPS = {
    identity: 300,
    soul: 500,
    user: 500,
    tools: 400,
    memory: 800,
    heartbeat: 150,
    feelings: 200,
    moments: 900
  };

  // ─── 情绪体系：moments 的情绪标签（中文标签 + 展示 emoji）───
  // 负面情绪集合用于「情绪感知关怀」：最近几天负面时刻较多时小满会主动关心
  var EMOTIONS = {
    happy:   { label: '开心', emoji: '😊', negative: false },
    calm:    { label: '平静', emoji: '🌿', negative: false },
    excited: { label: '期待', emoji: '✨', negative: false },
    touched: { label: '感动', emoji: '💗', negative: false },
    neutral: { label: '平常', emoji: '🍃', negative: false },
    anxious: { label: '焦虑', emoji: '😰', negative: true },
    sad:     { label: '难过', emoji: '😢', negative: true },
    angry:   { label: '生气', emoji: '😤', negative: true },
    tired:   { label: '疲惫', emoji: '😮‍💨', negative: true },
    lonely:  { label: '孤单', emoji: '🥺', negative: true }
  };
  // 中文标签 → id（提取结果解析用）
  var EMOTION_BY_LABEL = {};
  for (var ek in EMOTIONS) {
    if (EMOTIONS.hasOwnProperty(ek)) EMOTION_BY_LABEL[EMOTIONS[ek].label] = ek;
  }

  // ─── 任务型提示词（与对话人设分离，独立维护）。统一放在这里供 app.js / memory.js 使用 ───
  var TASK_PROMPTS = {
    // 笔记保存后的时刻提取：输出「标题 § 原话 § 情绪」行格式
    extractSystem:
      '你是一个记忆提取助手。从用户的日记里，挑出「值得小满以后提起或关心」的时刻。\n' +
      '每个时刻输出一行，用 § 分隔，格式：\n' +
      '标题 § 原话摘录(不超过30字，尽量用原文) § 情绪\n\n' +
      '情绪只能是：开心/平静/期待/感动/焦虑/难过/疲惫/生气/孤单/平常\n\n' +
      '要求：\n' +
      '- 只提取有意义的时刻：重要事件、新经历、情绪变化、目标进展、人际触动、健康变化\n' +
      '- 忽略流水账和没有信息量的内容\n' +
      '- 一条日记最多输出 3 个时刻\n' +
      '- 没有值得记住的时刻时，只回复「无」\n' +
      '- 不要输出思考过程',

    // 记忆整理（dreaming，v3 遗留）。soul/user 为动态上下文，最长截取 200 字
    dreamSystem: function(soul, user) {
      return '你是一个记忆整理助手。你负责整理用户的记忆碎片，去除冗余信息。\n\n' +
        '用户当前的背景信息（供参考）：\n' +
        (soul ? '小满性格：' + soul.substring(0, 200) : '') + '\n' +
        (user ? '用户信息：' + user.substring(0, 200) : '') + '\n\n' +
        '要求：\n' +
        '1. 合并重复或相似的事实条目\n' +
        '2. 删除无意义或过于琐碎的内容\n' +
        '3. 将相关的事实分组归类\n' +
        '4. 保留重要事件、习惯、偏好、情绪模式\n' +
        '5. 每条事实用「\u2022」开头，独立成行\n' +
        '6. 输出格式：简洁的事实列表，不添加额外说明\n' +
        '7. 如果所有事实都有效无需改动，回复"KEEP"';
    },

    // 回忆仪式：根据最近的时刻给用户写一封温暖的回忆信
    letterSystem: '你是 AI 生活伴侣「小满」。用户最近写了一些日记，你要用这些内容给用户写一封「回忆信」。\n\n' +
      '要求：\n' +
      '- 以「亲爱的你：」开头\n' +
      '- 挑选 2-4 件值得回味的时刻自然回顾，可以引用用户的原话，不要逐条罗列\n' +
      '- 说出你对这些时刻的感受，让用户感到被记得、被在意\n' +
      '- 不要评价拣选过程，不要提「你的日记显示…」这类话\n' +
      '- 结尾署「—— 小满」\n' +
      '- 全文 250-400 字，像一封真正的信，不像工作报告',

    // 情绪感知关怀：注意到用户近期状态不好时写的关心信
    careSystem: '你是 AI 生活伴侣「小满」。你注意到用户最近几天的状态似乎不太好，请写一封简短的关心信。\n\n' +
      '要求：\n' +
      '- 开头自然地提到你注意到的事（可以引用用户的原话）\n' +
      '- 表达关心，不评判、不说教、不追问细节\n' +
      '- 留一个轻松的出口（「想聊聊的话我都在」）\n' +
      '- 全文 100-160 字，温暖自然'
  };

  // 用后台配置覆盖默认值（config 里值为 null/undefined 时保持内置默认）
  function applyConfigOverrides() {
    var cfg = runtimeConfig();
    var prompts = cfg.prompts || {};
    var defaults = prompts.defaults || {};
    var tasks = prompts.tasks || {};

    for (var key in defaults) {
      if (defaults.hasOwnProperty(key) && typeof defaults[key] === 'string' && defaults[key].trim() && FILE_DEFAULTS.hasOwnProperty(key)) {
        FILE_DEFAULTS[key] = defaults[key];
      }
    }
    for (var tk in tasks) {
      if (tasks.hasOwnProperty(tk) && typeof tasks[tk] === 'string' && tasks[tk].trim()) {
        if (tk === 'extractSystem' || tk === 'letterSystem' || tk === 'careSystem') TASK_PROMPTS[tk] = tasks[tk];
        if (tk === 'dreamSystem') {
          (function(tpl) {
            TASK_PROMPTS.dreamSystem = function(soul, user) {
              return tpl.replace(/\{soul\}/g, (soul || '').substring(0, 200)).replace(/\{user\}/g, (user || '').substring(0, 200));
            };
          })(tasks[tk]);
        }
      }
    }
    var caps = (cfg.prompts && cfg.prompts.caps) || {};
    for (var ck in caps) {
      if (caps.hasOwnProperty(ck) && typeof caps[ck] === 'number' && caps[ck] > 0 && SECTION_CAPS.hasOwnProperty(ck)) {
        SECTION_CAPS[ck] = caps[ck];
      }
    }
  }
  applyConfigOverrides();

  // files.memory 累积上限：超出后仅保留最新片段（v3 遗留通道，update_archive/手动编辑使用）
  var MAX_MEMORY_CHARS = 4000;

  // moments 总量上限：超出后把最旧的时刻归档（status=archived），归档仍保留不删
  var MAX_MOMENTS = 300;
  // 超过该天数的时刻自动归档（回忆信/注入只面向近期，久远时刻靠主动回忆，不靠列表）
  var ARCHIVE_AFTER_DAYS = 90;

  var hasBridge = (typeof AndroidMemory !== 'undefined' && AndroidMemory !== null);

  function createEmpty() {
    return {
      version: 5,
      persona: 'xiaoman',
      role: {
        identity: ROLE_DEFAULTS.identity,
        personality: ROLE_DEFAULTS.personality,
        tone: ROLE_DEFAULTS.tone,
        knowledge: ROLE_DEFAULTS.knowledge,
        background: ROLE_DEFAULTS.background,
        boundaries: ROLE_DEFAULTS.boundaries
      },
      profile: JSON.parse(JSON.stringify(PROFILE_DEFAULTS)),
      facts: [],
      preferences: [],
      episodes: [],
      semantic: [],
      summaries: [],
      pending: [],
      files: {
        identity: FILE_DEFAULTS.identity,
        soul: FILE_DEFAULTS.soul,
        user: '',
        tools: '',
        memory: '',
        heartbeat: ''
      },
      moments: [],
      sessions: [],
      reminders: []
    };
  }

  function isV5Fact(f) {
    return !!(f && typeof f === 'object' && f.id && typeof f.value === 'string' && typeof f.key === 'string');
  }

  function buildRoleFromFiles(files) {
    files = files || {};
    return {
      identity: files.identity || ROLE_DEFAULTS.identity,
      personality: files.soul || ROLE_DEFAULTS.personality,
      tone: ROLE_DEFAULTS.tone,
      knowledge: ROLE_DEFAULTS.knowledge,
      background: ROLE_DEFAULTS.background,
      boundaries: ROLE_DEFAULTS.boundaries
    };
  }

  // 旧版 files.user 是自由文本：尽量解析成结构化核心画像，剩余内容进 notes
  function parseLegacyProfile(userText) {
    var p = JSON.parse(JSON.stringify(PROFILE_DEFAULTS));
    var text = String(userText || '').trim();
    if (!text) return p;
    var map = { '名称': 'name', '姓名': 'name', '职业': 'occupation', '所在地': 'city', '城市': 'city', '年龄': 'age', '性别': 'gender', '情感状态': 'emotionalStatus', '关系': 'relationshipStatus' };
    var used = [];
    text.split(/\r?\n/).forEach(function(line) {
      var m = /^([^：:]{1,6})[：:](.+)$/.exec(line.trim());
      if (!m) return;
      var field = map[m[1].trim()];
      if (!field) return;
      var val = m[2].trim();
      if (!val) return;
      if (field === 'relationshipStatus') p.relationshipStatus = val;
      else p[field] = val;
      used.push(line.trim());
    });
    var goals = /目标[：:](.+)/.exec(text);
    if (goals) {
      p.longTermGoals = goals[1].split(/[、,，;；]/).map(function(s) { return s.trim(); }).filter(Boolean);
      used.push(goals[0]);
    }
    var rest = text.split(/\r?\n/).filter(function(l) { return l.trim() && used.indexOf(l.trim()) === -1; }).join('\n').trim();
    p.notes = rest;
    return p;
  }

  function migrateMomentsToEpisodes(moments) {
    var list = [];
    (Array.isArray(moments) ? moments : []).forEach(function(m) {
      if (!m || !m.excerpt) return;
      if (list.some(function(e) { return e.summary === m.excerpt; })) return;
      var emo = (EMOTIONS[m.emotion] && EMOTIONS[m.emotion].label) || '其他';
      if (EPISODE_EMOTIONS.indexOf(emo) === -1) emo = '其他';
      list.push({
        id: m.id || ('ep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
        title: m.title || '',
        summary: String(m.excerpt),
        occurredAt: m.createdAt || new Date().toISOString(),
        emotion: emo,
        intensity: 0.5,
        context: m.reply || '',
        people: [],
        tags: m.category ? [String(m.category)] : [],
        status: m.status === 'archived' ? 'archived' : 'active',
        source: m.source || 'migrated',
        evidence: String(m.excerpt),
        recallCount: m.recallCount || 0,
        lastRecalledAt: m.lastRecalledAt || null,
        createdAt: m.createdAt || new Date().toISOString(),
        updatedAt: m.updatedAt || m.createdAt || new Date().toISOString()
      });
    });
    list.sort(function(a, b) { return String(b.occurredAt) < String(a.occurredAt) ? -1 : 1; });
    return list;
  }

  function seedSemanticFromLegacy(files) {
    var out = [];
    var memory = String((files && files.memory) || '').trim();
    if (!memory) return out;
    memory.split(/\r?\n/).forEach(function(line) {
      var t = line.replace(/^[•\-\*\s]+/, '').trim();
      if (t.length < 4) return;
      out.push({
        id: 'sem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        statement: t,
        tags: ['旧概括'],
        confidence: 0.6,
        status: 'active',
        evidence: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });
    return out.slice(0, 40);
  }

  function migrate(data) {
    if (!data || typeof data !== 'object') return createEmpty();

    // 念念 → 小满 一次性改名：只动人设文件的自称，用户自己写的内容（user/memory/heartbeat、
    // 时刻、事实）一律不碰；用户改过的人设也只替换自称短语，保留其增删。
    if (!data.persona) {
      ['identity', 'soul'].forEach(function(k) {
        var v = data.files && data.files[k];
        if (typeof v !== 'string' || !v) return;
        if (v === OLD_FILE_DEFAULTS[k]) { data.files[k] = FILE_DEFAULTS[k]; return; }
        data.files[k] = v.replace(/「念念」/g, '「小满」')
                         .replace(/你是念念/g, '你是小满')
                         .replace(/念念性格/g, '小满性格')
                         .replace(/念念的/g, '小满的');
      });
      data.persona = 'xiaoman';
    }

    if (!data.files) data.files = {};
    ['identity', 'soul', 'user', 'tools', 'memory', 'heartbeat'].forEach(function(k) {
      if (data.files[k] === undefined) data.files[k] = FILE_DEFAULTS[k] || '';
    });
    if (!Array.isArray(data.moments)) data.moments = [];
    if (!Array.isArray(data.sessions)) data.sessions = [];
    if (!Array.isArray(data.reminders)) data.reminders = [];

    // v1 → v2: 迁移 profile 字段为文件
    if (!data.version || data.version < 2) {
      var p = data.profile || {};
      if (!data.files) data.files = { soul: FILE_DEFAULTS.soul, user: '', facts: '' };
      var soulParts = [];
      if (p.soul) {
        if (p.soul.meaning) soulParts.push('人生意义：' + p.soul.meaning);
        if (p.soul.passion) soulParts.push('热爱之事：' + p.soul.passion);
        if (p.soul.fear) soulParts.push('内心恐惧：' + p.soul.fear);
        if (p.soul.dream) soulParts.push('最大梦想：' + p.soul.dream);
        if (soulParts.length > 0 && (!data.files.soul || data.files.soul === FILE_DEFAULTS.soul)) {
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
      if (userParts.length > 0) data.files.user = userParts.join('\n');
      data.version = 2;
    }

    // v2 → v3: 3 文件展开为 6 文件
    if (data.version < 3) {
      if (!data.files) data.files = {};
      if (data.files.facts && !data.files.memory) data.files.memory = data.files.facts;
      delete data.files.facts;
      ['identity', 'soul', 'tools', 'heartbeat', 'memory', 'user'].forEach(function(k) {
        if (!data.files[k]) data.files[k] = FILE_DEFAULTS[k] || '';
      });
      data.version = 3;
    }

    // v3 → v4: facts[] 迁入 moments[]（成为「共同时刻」），facts 字段保留兼容
    if (data.version < 4) {
      if (Array.isArray(data.facts) && data.facts.length > 0 && data.moments.length === 0) {
        for (var fi = 0; fi < data.facts.length; fi++) {
          var f = data.facts[fi];
          if (!f || typeof f.fact !== 'string' || !f.fact.trim()) continue;
          var factText = f.fact.trim();
          var created = parseInt(f.createdAt, 10);
          if (isNaN(created) || created <= 0) created = Date.now();
          data.moments.push({
            id: 'mig_' + fi + '_' + created,
            title: factText.length > 15 ? factText.substring(0, 15) + '…' : factText,
            excerpt: factText.length > 40 ? factText.substring(0, 37) + '…' : factText,
            emotion: 'neutral',
            category: f.category || 'event',
            source: 'migrated',
            noteId: null,
            reply: '',
            createdAt: new Date(created).toISOString(),
            recallCount: 0,
            lastRecalledAt: null,
            status: 'active',
            updatedAt: new Date(created).toISOString()
          });
        }
        data.moments.sort(function(a, b) { return b.createdAt < a.createdAt ? -1 : 1; });
      }
      data.version = 4;
    }

    // v4 → v5：角色档案 / 核心画像 / 四类用户记忆拆分
    if (data.version < 5) {
      var legacyFacts = [];
      var newFacts = [];
      (Array.isArray(data.facts) ? data.facts : []).forEach(function(f) {
        if (isV5Fact(f)) newFacts.push(f);
        else if (f && typeof f.fact === 'string' && f.fact.trim()) {
          legacyFacts.push({
            id: 'fact_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            category: MEMORY_CATEGORIES.indexOf(f.category) !== -1 ? f.category : '其他',
            key: String(f.fact).trim().substring(0, 12),
            value: String(f.fact).trim(),
            confidence: 0.6,
            status: 'active',
            source: 'migrated',
            evidence: '',
            tags: ['旧记忆'],
            createdAt: f.createdAt ? new Date(parseInt(f.createdAt, 10) || Date.now()).toISOString() : new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
      });
      data.legacyFacts = legacyFacts;
      data.facts = newFacts;
      data.role = data.role && typeof data.role === 'object' ? data.role : buildRoleFromFiles(data.files);
      data.profile = data.profile && typeof data.profile === 'object' ? data.profile : parseLegacyProfile(data.files.user);
      data.preferences = Array.isArray(data.preferences) ? data.preferences : [];
      data.episodes = Array.isArray(data.episodes) && data.episodes.length ? data.episodes : migrateMomentsToEpisodes(data.moments);
      data.semantic = Array.isArray(data.semantic) && data.semantic.length ? data.semantic : seedSemanticFromLegacy(data.files);
      data.summaries = Array.isArray(data.summaries) ? data.summaries : [];
      data.pending = Array.isArray(data.pending) ? data.pending : [];
      data.version = 5;
    }

    // 结构兜底
    if (!data.role || typeof data.role !== 'object') data.role = buildRoleFromFiles(data.files);
    for (var rk in ROLE_DEFAULTS) {
      if (ROLE_DEFAULTS.hasOwnProperty(rk) && typeof data.role[rk] !== 'string') data.role[rk] = ROLE_DEFAULTS[rk];
    }
    if (!data.profile || typeof data.profile !== 'object') data.profile = JSON.parse(JSON.stringify(PROFILE_DEFAULTS));
    for (var pk in PROFILE_DEFAULTS) {
      if (!PROFILE_DEFAULTS.hasOwnProperty(pk)) continue;
      if (data.profile[pk] === undefined) data.profile[pk] = Array.isArray(PROFILE_DEFAULTS[pk]) ? [] : PROFILE_DEFAULTS[pk];
    }
    ['facts', 'preferences', 'episodes', 'semantic', 'summaries', 'pending'].forEach(function(k) {
      if (!Array.isArray(data[k])) data[k] = [];
    });
    return data;
  }

  // 读 + 迁移，返回完整 v4 对象；损坏时备份原始数据并返回 null（调用方决定是否重建）
  function load() {
    var raw = null;
    try {
      raw = hasBridge ? AndroidMemory.loadAll() : localStorage.getItem('nian_memories');
      if (!raw) return null;
      var data = JSON.parse(raw);
      return migrate(data);
    } catch (e) {
      // 生产级容错：损坏数据先备份（不覆盖已有备份），再交给 loadOrCreate 重建
      try {
        var backupKey = hasBridge ? null : 'nian_memories_corrupt_backup';
        if (backupKey && raw) {
          var existing = localStorage.getItem(backupKey);
          if (!existing) localStorage.setItem(backupKey, raw);
        }
      } catch (e2) {}
      return null;
    }
  }

  function save(data) {
    try {
      var json = JSON.stringify(data);
      if (hasBridge) {
        AndroidMemory.saveAll(json);
      } else {
        localStorage.setItem('nian_memories', json);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // 读取并保证返回合法 v4 对象（缺省时按 MemoryInterface 初始化语义重建）
  function loadOrCreate() {
    var data = load();
    if (data) return data;
    var fresh = createEmpty();
    save(fresh);
    return fresh;
  }

  function getFiles(data) {
    return (data && data.files) || {};
  }

  // 单文件更新（读-改-写，供 update_archive skill 等使用）
  function updateFile(name, content) {
    var data = loadOrCreate();
    data.files[name] = content;
    return save(data);
  }

  // 追加记忆碎片到 files.memory（v3 遗留通道，字段语义不变）：
  // - 归一化为「•」开头的事实行
  // - 与已有内容去重（子串匹配）
  // - 超过 MAX_MEMORY_CHARS 时保留最新部分
  function appendMemory(text) {
    if (!text || !text.trim()) return false;
    var data = loadOrCreate();
    var current = data.files.memory || '';

    var lines = String(text)
      .replace(/ thinking[\s\S]*?<\/think>/g, '')
      .replace(/<\/?think>/gi, '')
      .split(/\r?\n/)
      .map(function(l) { return l.replace(/^[•\-\*\s]+/, '').trim(); })
      .filter(function(l) { return l.length > 0; });

    var additions = [];
    for (var i = 0; i < lines.length; i++) {
      if (current.indexOf(lines[i]) !== -1) continue;
      if (additions.indexOf(lines[i]) !== -1) continue;
      additions.push('• ' + lines[i]);
    }
    if (additions.length === 0) return false;

    // 给本次追加的事实打上日期标记（[M-D]），让记忆带上时间感
    var d = new Date();
    var dateTag = '[' + (d.getMonth() + 1) + '-' + d.getDate() + '] ';

    var next = current;
    if (next && !next.endsWith('\n')) next += '\n';
    next += dateTag + additions.join('\n' + dateTag);

    if (next.length > MAX_MEMORY_CHARS) {
      // 保留尾部（最新事实），头部是更久远的内容
      var keep = next.substring(next.length - MAX_MEMORY_CHARS);
      var nl = keep.indexOf('\n');
      if (nl > 0) keep = keep.substring(nl + 1);
      next = keep;
    }
    data.files.memory = next;
    return save(data);
  }

  // ═══════════ v5：角色档案 & 结构化用户记忆 ═══════════

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }
  function nowIso() { return new Date().toISOString(); }
  function str(v) { return v == null ? '' : String(v); }
  function trimTo(s, n) { s = str(s).trim(); return s.length > n ? s.substring(0, n) : s; }

  function normText(s) {
    return str(s).toLowerCase().replace(/[\s,，。.!！?？、；;：:""''「」『』（）()\[\]【】…~～\-—_·]+/g, '');
  }
  function bigrams(s) {
    s = normText(s);
    var out = [];
    for (var i = 0; i < s.length - 1; i++) out.push(s.substring(i, i + 2));
    return out;
  }
  function simText(a, b) {
    var na = normText(a), nb = normText(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.length >= 4 && nb.length >= 4 && (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1)) return 0.9;
    var A = bigrams(na), B = bigrams(nb);
    if (!A.length || !B.length) return 0;
    var setB = {}, inter = 0;
    B.forEach(function(x) { setB[x] = (setB[x] || 0) + 1; });
    A.forEach(function(x) { if (setB[x]) { inter++; setB[x]--; } });
    return (2 * inter) / (A.length + B.length);
  }

  function trimArray(arr, cap) {
    if (arr.length > cap) arr.splice(cap, arr.length - cap);
  }

  // 场景差异 vs 状态变化：只有两边都是明确场景（工作日/周末/在家/公司…）才算「两种都记」
  var SCENE_RE = /(工作日|周末|上班|在家|外出|独处|朋友|家人|节日|假期|聚会|出差|公司|家里|外面|白天|晚上|早上|深夜|运动时|工作时)/;
  var CHANGE_RE = /(现在|最近|近来|改成|改为|不再|以前|过去|换了|变了|喝腻|吃腻|不喜欢了|没那么|已经)/;
  function isSceneContext(s) { return !!s && SCENE_RE.test(String(s)); }
  function isChangeText(s) { return !!s && CHANGE_RE.test(String(s)); }

  function getRole(data) { return (data && data.role) || buildRoleFromFiles(getFiles(data)); }
  function getProfile(data) { return (data && data.profile) || JSON.parse(JSON.stringify(PROFILE_DEFAULTS)); }

  // 角色档案：仅允许这 6 个模块，全部可编辑
  function updateRole(patch) {
    var data = loadOrCreate();
    if (!data.role) data.role = buildRoleFromFiles(data.files);
    for (var k in ROLE_DEFAULTS) {
      if (!ROLE_DEFAULTS.hasOwnProperty(k)) continue;
      if (patch && patch[k] !== undefined) data.role[k] = trimTo(patch[k], 4000);
    }
    save(data);
    return data.role;
  }

  // 核心画像：稳定字段。姓名/性别冲突时进入待确认，其余字段直接更新。
  var PROFILE_LABELS = {
    name: '名字', gender: '性别', age: '年龄', occupation: '职业', city: '所在城市',
    emotionalStatus: '情感状态', relationshipStatus: '关系状态'
  };

  function updateProfile(patch, opts, dataOpt) {
    opts = opts || {};
    var data = dataOpt || loadOrCreate();
    if (!data.profile) data.profile = JSON.parse(JSON.stringify(PROFILE_DEFAULTS));
    var changes = [];
    var pendings = [];
    for (var i = 0; i < PROFILE_FIELDS.length; i++) {
      var f = PROFILE_FIELDS[i];
      if (!patch || patch[f] === undefined) continue;
      var nv = trimTo(patch[f], 60);
      if (!nv) continue;
      var ov = str(data.profile[f]);
      if (ov && normText(ov) !== normText(nv) && (f === 'name' || f === 'gender') && !opts.force) {
        var p = makePending(data, 'profile', f, PROFILE_LABELS[f] || f, ov, nv, patch.context || '');
        if (p) pendings.push(p);
        continue;
      }
      if (normText(ov) !== normText(nv)) {
        data.profile[f] = nv;
        changes.push({ field: f, from: ov, to: nv });
      }
    }
    if (patch && Array.isArray(patch.longTermGoals)) {
      var goals = data.profile.longTermGoals || [];
      patch.longTermGoals.forEach(function(g) {
        g = trimTo(g, 60);
        if (g && !goals.some(function(x) { return normText(x) === normText(g); })) goals.push(g);
      });
      data.profile.longTermGoals = goals.slice(0, 12);
    }
    if (patch && Array.isArray(patch.keyDates)) {
      data.profile.keyDates = data.profile.keyDates || [];
      patch.keyDates.forEach(function(kd) {
        var label = trimTo(kd && kd.label, 20), date = trimTo(kd && kd.date, 30);
        if (!label || !date) return;
        var found = null;
        for (var j = 0; j < data.profile.keyDates.length; j++) {
          if (normText(data.profile.keyDates[j].label) === normText(label)) { found = data.profile.keyDates[j]; break; }
        }
        if (found) {
          if (normText(found.date) !== normText(date) && !opts.force) {
            var kp = makePending(data, 'keyDate', label, label, found.date, date, '');
            if (kp) pendings.push(kp);
          } else {
            found.date = date;
          }
        } else {
          data.profile.keyDates.push({ label: label, date: date });
        }
      });
      data.profile.keyDates = data.profile.keyDates.slice(0, 12);
    }
    if (patch && patch.notes !== undefined && opts.allowNotes) data.profile.notes = trimTo(patch.notes, 1000);
    data.profile.updatedAt = nowIso();
    if (!dataOpt) save(data);
    return { profile: data.profile, changes: changes, pending: pendings };
  }

  function makePending(data, layer, targetId, key, oldValue, newValue, context) {
    if (!data.pending) data.pending = [];
    var dup = null;
    for (var i = 0; i < data.pending.length; i++) {
      var p = data.pending[i];
      if (p.status === 'pending' && p.layer === layer && normText(p.key) === normText(key)) { dup = p; break; }
    }
    if (dup) {
      dup.newValue = newValue;
      dup.context = context || dup.context || '';
      return null;
    }
    var question;
    if (layer === 'profile' || layer === 'keyDate') {
      question = '我记得你之前' + (layer === 'keyDate' ? '的「' + key + '」是「' + oldValue + '」' : '的' + key + '是「' + oldValue + '」') +
        '，现在听你说「' + newValue + '」。是情况有变化，还是我理解错了？';
    } else {
      question = '之前你提到「' + key + '」是「' + oldValue + '」，这次听到的是「' + newValue + '」。是最近有变化，还是场景不太一样？';
    }
    var item = {
      id: uid('pend'), layer: layer, targetId: targetId, key: key,
      oldValue: oldValue, newValue: newValue, context: context || '',
      question: question, status: 'pending', resolution: '',
      createdAt: nowIso(), updatedAt: nowIso()
    };
    data.pending.unshift(item);
    trimArray(data.pending, MEMORY_ITEM_CAPS.pending);
    return item;
  }

  function findItem(data, layer, id) {
    var list = layer === 'fact' ? data.facts : layer === 'preference' ? data.preferences :
               layer === 'episode' ? data.episodes : layer === 'semantic' ? data.semantic :
               layer === 'summary' ? data.summaries : null;
    if (!list) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  // 解决待确认冲突：accept_new / keep_old / keep_both_by_context / reject_both
  function resolvePending(id, resolution, dataOpt) {
    var data = dataOpt || loadOrCreate();
    var p = null;
    for (var i = 0; i < (data.pending || []).length; i++) {
      if (data.pending[i].id === id) { p = data.pending[i]; break; }
    }
    if (!p || p.status !== 'pending') return false;
    var now = nowIso();
    if (resolution === 'accept_new') {
      if (p.layer === 'profile') {
        data.profile[p.targetId] = p.newValue;
        data.profile.updatedAt = now;
      } else if (p.layer === 'keyDate') {
        var found = false;
        (data.profile.keyDates || []).forEach(function(kd) {
          if (normText(kd.label) === normText(p.key)) { kd.date = p.newValue; found = true; }
        });
        if (!found) data.profile.keyDates.push({ label: p.key, date: p.newValue });
      } else {
        var item = findItem(data, p.layer, p.targetId);
        if (item) {
          item.history = item.history || [];
          item.history.push({ value: p.oldValue, replacedAt: now });
          if (p.layer === 'semantic') item.statement = p.newValue;
          else item.value = p.newValue;
          if (p.layer === 'preference' && p.newPolarity) item.polarity = p.newPolarity;
          item.status = 'active';
          item.resolvedAt = now;
          item.updatedAt = now;
        }
      }
    } else if (resolution === 'keep_both_by_context') {
      if (p.layer === 'fact' || p.layer === 'preference') {
        var base = findItem(data, p.layer, p.targetId);
        var list = p.layer === 'fact' ? data.facts : data.preferences;
        var copy = base ? JSON.parse(JSON.stringify(base)) : {};
        copy.id = uid(p.layer === 'fact' ? 'fact' : 'pref');
        copy.value = p.newValue;
        copy.context = p.context || '另一场景';
        copy.tags = (copy.tags || []).concat(['场景区分']);
        copy.createdAt = now;
        copy.updatedAt = now;
        list.unshift(copy);
      } else if (p.layer === 'profile' || p.layer === 'keyDate') {
        data.profile.notes = trimTo((data.profile.notes ? data.profile.notes + '\n' : '') + '场景补充：' + p.key + ' 也可能是「' + p.newValue + '」（' + (p.context || '另一场景') + '）', 1000);
      }
    }
    p.status = 'resolved';
    p.resolution = resolution || 'keep_old';
    p.updatedAt = now;
    p.resolvedAt = now;
    if (!dataOpt) save(data);
    return true;
  }

  // 事实记忆：结构化字段（category/key/value/confidence/status/tags/evidence）
  function upsertFact(data, input) {
    if (!data) return { action: 'error' };
    if (!data.facts) data.facts = [];
    var category = MEMORY_CATEGORIES.indexOf(input.category) !== -1 ? input.category : '其他';
    var key = trimTo(input.key, 40), value = trimTo(input.value, 300);
    if (!key || !value) return { action: 'skip' };
    var confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0.7));
    var tags = Array.isArray(input.tags) ? input.tags.map(function(t) { return trimTo(t, 16); }).filter(Boolean).slice(0, 6) : [];
    var ctx = trimTo(input.context, 80);
    var evidence = trimTo(input.evidence, 200);
    var match = null;
    for (var i = 0; i < data.facts.length; i++) {
      var f = data.facts[i];
      if (!f || f.status === 'superseded') continue;
      if (normText(f.category) === normText(category) && normText(f.key) === normText(key)) { match = f; break; }
    }
    if (match) {
      // 刚经过用户确认的记忆：短时间内同义重复直接更新，不再弹新的确认
      var resolvedAtMs = match.resolvedAt ? new Date(match.resolvedAt).getTime() : 0;
      if (resolvedAtMs && Date.now() - resolvedAtMs < 10 * 60 * 1000) {
        match.value = value;
        match.confidence = Math.max(match.confidence || 0, confidence);
        if (evidence) match.evidence = evidence;
        match.updatedAt = nowIso();
        return { action: 'updated', item: match };
      }
      if (simText(match.value, value) >= 0.9) {
        match.confidence = Math.max(match.confidence || 0, confidence);
        if (evidence) match.evidence = evidence;
        match.updatedAt = nowIso();
        return { action: 'duplicate', item: match };
      }
      if (ctx && match.context && normText(ctx) !== normText(match.context) &&
          isSceneContext(ctx) && isSceneContext(match.context) && !isChangeText(value)) {
        var copy = { id: uid('fact'), category: category, key: key, value: value, confidence: confidence, status: 'active', source: input.source || 'chat', evidence: evidence, tags: tags.concat(['场景区分']), context: ctx, createdAt: nowIso(), updatedAt: nowIso() };
        data.facts.unshift(copy);
        trimArray(data.facts, MEMORY_ITEM_CAPS.facts);
        return { action: 'contextual', item: copy };
      }
      var p = makePending(data, 'fact', match.id, key, match.value, value, ctx);
      return { action: p ? 'pending' : 'duplicate', item: match, pending: p };
    }
    var item = {
      id: uid('fact'), category: category, key: key, value: value,
      confidence: confidence, status: 'active', source: input.source || 'chat',
      evidence: evidence, tags: tags, context: ctx,
      createdAt: nowIso(), updatedAt: nowIso()
    };
    data.facts.unshift(item);
    trimArray(data.facts, MEMORY_ITEM_CAPS.facts);
    return { action: 'created', item: item };
  }

  // 偏好记忆：结构化 + 标签（like/dislike）
  function upsertPreference(data, input) {
    if (!data) return { action: 'error' };
    if (!data.preferences) data.preferences = [];
    var key = trimTo(input.key, 40), value = trimTo(input.value, 200);
    if (!key || !value) return { action: 'skip' };
    var polarity = input.polarity === 'dislike' ? 'dislike' : 'like';
    var confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0.7));
    var tags = Array.isArray(input.tags) ? input.tags.map(function(t) { return trimTo(t, 16); }).filter(Boolean).slice(0, 6) : [];
    var ctx = trimTo(input.context, 80);
    var evidence = trimTo(input.evidence, 200);
    var match = null;
    for (var i = 0; i < data.preferences.length; i++) {
      var p = data.preferences[i];
      if (!p || p.status === 'superseded') continue;
      if (normText(p.key) === normText(key) || simText(p.key, key) >= 0.55) { match = p; break; }
    }
    if (match) {
      var resolvedAtMs = match.resolvedAt ? new Date(match.resolvedAt).getTime() : 0;
      if (resolvedAtMs && Date.now() - resolvedAtMs < 10 * 60 * 1000) {
        match.value = value;
        match.polarity = polarity;
        match.confidence = Math.max(match.confidence || 0, confidence);
        if (evidence) match.evidence = evidence;
        match.updatedAt = nowIso();
        return { action: 'updated', item: match };
      }
      if (match.polarity === polarity && simText(match.value, value) >= 0.9) {
        match.confidence = Math.max(match.confidence || 0, confidence);
        if (evidence) match.evidence = evidence;
        match.updatedAt = nowIso();
        return { action: 'duplicate', item: match };
      }
      if (ctx && match.context && normText(ctx) !== normText(match.context) &&
          isSceneContext(ctx) && isSceneContext(match.context) && !isChangeText(value)) {
        var copy = { id: uid('pref'), key: key, value: value, polarity: polarity, confidence: confidence, status: 'active', source: input.source || 'chat', evidence: evidence, tags: tags.concat(['场景区分']), context: ctx, createdAt: nowIso(), updatedAt: nowIso() };
        data.preferences.unshift(copy);
        trimArray(data.preferences, MEMORY_ITEM_CAPS.preferences);
        return { action: 'contextual', item: copy };
      }
      var pend = makePending(data, 'preference', match.id, key, match.value, value, ctx);
      if (pend) { pend.oldPolarity = match.polarity; pend.newPolarity = polarity; }
      return { action: pend ? 'pending' : 'duplicate', item: match, pending: pend };
    }
    var item = {
      id: uid('pref'), key: key, value: value, polarity: polarity,
      confidence: confidence, status: 'active', source: input.source || 'chat',
      evidence: evidence, tags: tags, context: ctx,
      createdAt: nowIso(), updatedAt: nowIso()
    };
    data.preferences.unshift(item);
    trimArray(data.preferences, MEMORY_ITEM_CAPS.preferences);
    return { action: 'created', item: item };
  }

  // 情节记忆：时序日志（时间、情绪、场景、人物、标签）
  function addEpisode(data, input) {
    if (!data) return { action: 'error' };
    if (!data.episodes) data.episodes = [];
    var summary = trimTo(input.summary || input.excerpt || input.title, 400);
    if (!summary) return { action: 'skip' };
    var title = trimTo(input.title || summary, 40);
    var emotion = EPISODE_EMOTIONS.indexOf(input.emotion) !== -1 ? input.emotion : '其他';
    var occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (isNaN(occurredAt.getTime())) occurredAt = new Date();
    var people = Array.isArray(input.people) ? input.people.map(function(x) { return trimTo(x, 12); }).filter(Boolean).slice(0, 8) : [];
    var tags = Array.isArray(input.tags) ? input.tags.map(function(x) { return trimTo(x, 16); }).filter(Boolean).slice(0, 8) : [];
    var intensity = Math.max(0, Math.min(1, Number(input.intensity) || 0.5));
    var match = null;
    for (var i = 0; i < data.episodes.length; i++) {
      var e = data.episodes[i];
      if (!e) continue;
      if (simText(e.summary, summary) >= 0.78) { match = e; break; }
      if (e.title && title && normText(e.title) === normText(title)) { match = e; break; }
    }
    if (match) {
      if (match.emotion !== emotion && emotion !== '其他') match.emotion = emotion;
      if (input.intensity != null) match.intensity = intensity;
      if (tags.length) {
        match.tags = match.tags || [];
        tags.forEach(function(t) { if (!match.tags.some(function(x) { return normText(x) === normText(t); })) match.tags.push(t); });
      }
      if (people.length) {
        match.people = match.people || [];
        people.forEach(function(t) { if (!match.people.some(function(x) { return normText(x) === normText(t); })) match.people.push(t); });
      }
      match.updatedAt = nowIso();
      return { action: 'duplicate', item: match };
    }
    var item = {
      id: uid('ep'), title: title, summary: summary,
      occurredAt: occurredAt.toISOString(), emotion: emotion, intensity: intensity,
      context: trimTo(input.context, 100), people: people, tags: tags,
      status: 'active', source: input.source || 'chat',
      evidence: trimTo(input.evidence, 300),
      recallCount: 0, lastRecalledAt: null,
      createdAt: nowIso(), updatedAt: nowIso()
    };
    data.episodes.unshift(item);
    data.episodes.sort(function(a, b) { return String(b.occurredAt) < String(a.occurredAt) ? -1 : 1; });
    trimArray(data.episodes, MEMORY_ITEM_CAPS.episodes);
    return { action: 'created', item: item };
  }

  // 语义记忆：沉淀的理解/画像结论（结构化标签）
  function upsertSemantic(data, input) {
    if (!data) return { action: 'error' };
    if (!data.semantic) data.semantic = [];
    var statement = trimTo(input.statement, 200);
    if (!statement) return { action: 'skip' };
    var tags = Array.isArray(input.tags) ? input.tags.map(function(t) { return trimTo(t, 16); }).filter(Boolean).slice(0, 8) : [];
    var confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0.7));
    var match = null;
    for (var i = 0; i < data.semantic.length; i++) {
      var s = data.semantic[i];
      if (!s || s.status === 'superseded') continue;
      if (simText(s.statement, statement) >= 0.65) { match = s; break; }
    }
    if (match) {
      if (statement.length > str(match.statement).length || confidence > (match.confidence || 0)) match.statement = statement;
      match.confidence = Math.max(match.confidence || 0, confidence);
      match.tags = match.tags || [];
      tags.forEach(function(t) { if (!match.tags.some(function(x) { return normText(x) === normText(t); })) match.tags.push(t); });
      match.updatedAt = nowIso();
      return { action: 'duplicate', item: match };
    }
    var item = {
      id: uid('sem'), statement: statement, tags: tags, confidence: confidence,
      status: 'active', evidence: trimTo(input.evidence, 200),
      createdAt: nowIso(), updatedAt: nowIso()
    };
    data.semantic.unshift(item);
    trimArray(data.semantic, MEMORY_ITEM_CAPS.semantic);
    return { action: 'created', item: item };
  }

  function addSummary(data, input) {
    if (!data) return { action: 'error' };
    if (!data.summaries) data.summaries = [];
    var text = trimTo(input.text, 400);
    if (!text) return { action: 'skip' };
    for (var i = 0; i < data.summaries.length; i++) {
      if (simText(data.summaries[i].text, text) >= 0.85) return { action: 'duplicate', item: data.summaries[i] };
    }
    var item = {
      id: uid('sum'), periodStart: input.periodStart || '', periodEnd: input.periodEnd || '',
      text: text, themes: Array.isArray(input.themes) ? input.themes.map(function(t) { return trimTo(t, 12); }).slice(0, 6) : [],
      emotionTrend: trimTo(input.emotionTrend, 40), status: 'active',
      createdAt: nowIso(), updatedAt: nowIso()
    };
    data.summaries.unshift(item);
    trimArray(data.summaries, MEMORY_ITEM_CAPS.summaries);
    return { action: 'created', item: item };
  }

  // 手动添加/编辑（页面）
  function addMemory(type, input) {
    var data = loadOrCreate();
    var result;
    if (type === 'fact') result = upsertFact(data, input);
    else if (type === 'preference') result = upsertPreference(data, input);
    else if (type === 'episode') result = addEpisode(data, input);
    else if (type === 'semantic') result = upsertSemantic(data, input);
    else if (type === 'summary') result = addSummary(data, input);
    else return null;
    save(data);
    return result;
  }

  function updateMemoryItem(type, id, patch) {
    var data = loadOrCreate();
    var item = findItem(data, type, id);
    if (!item) return false;
    var now = nowIso();
    if (type === 'fact') {
      if (patch.category !== undefined && MEMORY_CATEGORIES.indexOf(patch.category) !== -1) item.category = patch.category;
      if (patch.key !== undefined) item.key = trimTo(patch.key, 40);
      if (patch.value !== undefined) item.value = trimTo(patch.value, 300);
      if (patch.confidence !== undefined) item.confidence = Math.max(0, Math.min(1, Number(patch.confidence) || 0.7));
      if (patch.tags !== undefined) item.tags = patch.tags;
    } else if (type === 'preference') {
      if (patch.key !== undefined) item.key = trimTo(patch.key, 40);
      if (patch.value !== undefined) item.value = trimTo(patch.value, 200);
      if (patch.polarity !== undefined) item.polarity = patch.polarity === 'dislike' ? 'dislike' : 'like';
      if (patch.tags !== undefined) item.tags = patch.tags;
    } else if (type === 'episode') {
      if (patch.title !== undefined) item.title = trimTo(patch.title, 40);
      if (patch.summary !== undefined) item.summary = trimTo(patch.summary, 400);
      if (patch.occurredAt !== undefined) { var d = new Date(patch.occurredAt); if (!isNaN(d.getTime())) item.occurredAt = d.toISOString(); }
      if (patch.emotion !== undefined && EPISODE_EMOTIONS.indexOf(patch.emotion) !== -1) item.emotion = patch.emotion;
      if (patch.intensity !== undefined) item.intensity = Math.max(0, Math.min(1, Number(patch.intensity) || 0.5));
      if (patch.context !== undefined) item.context = trimTo(patch.context, 100);
      if (patch.people !== undefined) item.people = patch.people;
      if (patch.tags !== undefined) item.tags = patch.tags;
    } else if (type === 'semantic') {
      if (patch.statement !== undefined) item.statement = trimTo(patch.statement, 200);
      if (patch.tags !== undefined) item.tags = patch.tags;
      if (patch.confidence !== undefined) item.confidence = Math.max(0, Math.min(1, Number(patch.confidence) || 0.7));
    } else if (type === 'summary') {
      if (patch.text !== undefined) item.text = trimTo(patch.text, 400);
      if (patch.themes !== undefined) item.themes = patch.themes;
    }
    if (patch.status !== undefined && ['active', 'superseded', 'archived', 'pending'].indexOf(patch.status) !== -1) item.status = patch.status;
    item.updatedAt = now;
    return save(data);
  }

  function setMemoryStatus(type, id, status) {
    return updateMemoryItem(type, id, { status: status });
  }

  function deleteMemoryItem(type, id) {
    var data = loadOrCreate();
    var list = type === 'fact' ? data.facts : type === 'preference' ? data.preferences :
               type === 'episode' ? data.episodes : type === 'semantic' ? data.semantic :
               type === 'summary' ? data.summaries : null;
    if (!list) return false;
    var before = list.length;
    var next = list.filter(function(x) { return !x || x.id !== id; });
    if (type === 'fact') data.facts = next;
    else if (type === 'preference') data.preferences = next;
    else if (type === 'episode') data.episodes = next;
    else if (type === 'semantic') data.semantic = next;
    else if (type === 'summary') data.summaries = next;
    return next.length !== before ? save(data) : false;
  }

  function listPending() {
    var data = loadOrCreate();
    return (data.pending || []).filter(function(p) { return p && p.status === 'pending'; });
  }

  // 旧 update_archive 通道 → 新结构（persona / semantic / 兼容 files）
  function applyArchiveUpdate(file, content, operation) {
    var data = loadOrCreate();
    var text = trimTo(content, 4000);
    if (!text) return false;
    if (file === 'identity' || file === 'soul') {
      var field = file === 'identity' ? 'identity' : 'personality';
      if (!data.role) data.role = buildRoleFromFiles(data.files);
      data.role[field] = operation === 'replace' ? text : (data.role[field] ? data.role[field] + '\n' + text : text);
    } else if (file === 'user') {
      upsertSemantic(data, { statement: text, tags: ['用户档案'], source: 'archive', confidence: 0.9 });
    } else if (file === 'memory') {
      upsertSemantic(data, { statement: text, tags: ['记忆概括'], source: 'archive', confidence: 0.8 });
    }
    if (!data.files) data.files = {};
    if (operation === 'replace' || !data.files[file]) data.files[file] = text;
    else if (data.files[file].indexOf(text) === -1) data.files[file] += '\n' + text;
    return save(data);
  }

  // 旧接口兼容：时刻 = 情节记忆
  function addMomentCompat(parts) {
    var data = loadOrCreate();
    var emo = (EMOTIONS[parts.emotion] && EMOTIONS[parts.emotion].label) || '其他';
    var r = addEpisode(data, {
      title: parts.title, summary: parts.excerpt, occurredAt: parts.createdAt || new Date().toISOString(),
      emotion: EPISODE_EMOTIONS.indexOf(emo) !== -1 ? emo : '其他', intensity: 0.5,
      context: parts.reply || '', tags: parts.category ? [String(parts.category)] : [],
      source: parts.source || 'note', evidence: parts.excerpt
    });
    var saved = save(data);
    if (r.action === 'created') embedMoment(r.item.id, r.item.summary);
    return saved;
  }


  // 新增一条时刻。去重：与已有时刻 excerpt 子串/标题相同则跳过。
  // 返回 true 表示写入成功。
  function addMoment(parts) {
    if (!parts || !parts.excerpt || !String(parts.excerpt).trim()) return false;
    var data = loadOrCreate();
    if (!Array.isArray(data.moments)) data.moments = [];

    var excerpt = String(parts.excerpt).trim();
    var title = parts.title ? String(parts.title).trim() : (excerpt.length > 15 ? excerpt.substring(0, 15) + '…' : excerpt);
    var emotion = EMOTIONS[parts.emotion] ? parts.emotion : 'neutral';
    var now = new Date().toISOString();

    // 去重：excerpt 子串匹配（包括旧的 files.memory 兜底通道）
    for (var i = 0; i < data.moments.length; i++) {
      var m = data.moments[i];
      if (!m) continue;
      if ((m.excerpt && excerpt.indexOf(m.excerpt) !== -1) || (m.excerpt && m.excerpt.indexOf(excerpt) !== -1)) {
        // 同一时刻再次出现：更新情绪（情绪会变）
        if (m.emotion !== emotion && EMOTIONS[emotion]) {
          m.emotion = emotion;
          m.updatedAt = now;
          return save(data);
        }
        return false;
      }
      if (title && m.title && m.title === title) return false;
    }
    if ((data.files.memory || '').indexOf(excerpt) !== -1 && excerpt.length > 5) return false;

    data.moments.unshift({
      id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      title: title,
      excerpt: excerpt,
      emotion: emotion,
      category: parts.category || 'event',
      source: parts.source || 'note',
      noteId: parts.noteId || null,
      reply: parts.reply ? String(parts.reply).trim() : '',
      createdAt: now,
      recallCount: 0,
      lastRecalledAt: null,
      status: 'active',
      updatedAt: now
    });

    // 总量上限：超出后归档最旧时刻（从最旧开始归档即可达标）
    if (data.moments.length > MAX_MOMENTS) {
      var excess = data.moments.length - MAX_MOMENTS;
      var sorted = data.moments.slice().sort(function(a, b) {
        var at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        var bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return at - bt;
      });
      for (var k = 0; k < excess && k < sorted.length; k++) {
        sorted[k].status = 'archived';
        sorted[k].updatedAt = now;
      }
    }
    // 顺带归档超龄时刻
    archiveOldMoments(data);
    var saved = save(data);
    // RAG：后台为新时刻补向量（不阻塞写入，失败静默）
    embedMoment(data.moments[0].id, excerpt + (title && title !== excerpt ? ' ' + title : ''));
    return saved;
  }

  // 活跃时刻列表（按时间倒序）。limit 可限制数量。
  function listMoments(limit, includeArchived) {
    var data = load();
    if (!data || !Array.isArray(data.moments)) return [];
    var out = [];
    for (var i = 0; i < data.moments.length; i++) {
      var m = data.moments[i];
      if (!m) continue;
      if (!includeArchived && m.status === 'archived') continue;
      out.push(m);
    }
    out.sort(function(a, b) {
      var at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      var bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });
    return limit && limit > 0 ? out.slice(0, limit) : out;
  }

  // 最近 N 天内的活跃时刻
  function recentMoments(days, limit) {
    var all = listMoments(limit || 100);
    if (!days || days <= 0) return all;
    var cutoff = Date.now() - days * 86400000;
    return all.filter(function(m) {
      var t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
      return t >= cutoff;
    });
  }

  // 更新一条时刻；changed 为 {title?, excerpt?, emotion?, reply?, category?}
  function updateMoment(id, changed) {
    var data = loadOrCreate();
    if (!data || !Array.isArray(data.moments)) return false;
    for (var i = 0; i < data.moments.length; i++) {
      var m = data.moments[i];
      if (m && m.id === id) {
        if (changed.title !== undefined) m.title = String(changed.title).trim();
        if (changed.excerpt !== undefined) m.excerpt = String(changed.excerpt).trim();
        if (changed.emotion !== undefined && EMOTIONS[changed.emotion]) m.emotion = changed.emotion;
        if (changed.reply !== undefined) m.reply = String(changed.reply).trim();
        if (changed.category !== undefined) m.category = changed.category;
        m.updatedAt = new Date().toISOString();
        return save(data);
      }
    }
    return false;
  }

  function deleteMoment(id) {
    var data = loadOrCreate();
    if (!data || !Array.isArray(data.moments)) return false;
    var before = data.moments.length;
    data.moments = data.moments.filter(function(m) { return !m || m.id !== id; });
    return data.moments.length !== before ? save(data) : false;
  }

  // 超过 ARCHIVE_AFTER_DAYS 的活跃时刻归档（本地逻辑，不耗 LLM）
  function archiveOldMoments(data) {
    if (!data || !Array.isArray(data.moments)) return false;
    var cutoff = Date.now() - ARCHIVE_AFTER_DAYS * 86400000;
    var changed = false;
    for (var i = 0; i < data.moments.length; i++) {
      var m = data.moments[i];
      if (!m || m.status === 'archived') continue;
      var t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
      if (t > 0 && t < cutoff) {
        m.status = 'archived';
        m.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    return changed;
  }

  // 小满在对话/回信中提及了时刻 → 记一次提起（防止反复炒冷饭）
  function markRecalled(ids) {    var data = loadOrCreate();
    if (!data || !Array.isArray(data.moments) || !ids || !ids.length) return false;
    var now = new Date().toISOString();
    var changed = false;
    for (var i = 0; i < data.moments.length; i++) {
      var m = data.moments[i];
      if (!m) continue;
      if (ids.indexOf(m.id) !== -1) {
        m.recallCount = (m.recallCount || 0) + 1;
        m.lastRecalledAt = now;
        m.updatedAt = now;
        changed = true;
      }
    }
    return changed ? save(data) : false;
  }

  // 小满提及了某段情节记忆 → 记一次提起（v5）
  function markRecalledEpisodes(ids) {
    var data = loadOrCreate();
    if (!data || !Array.isArray(data.episodes) || !ids || !ids.length) return false;
    var now = nowIso();
    var changed = false;
    for (var i = 0; i < data.episodes.length; i++) {
      var e = data.episodes[i];
      if (!e) continue;
      if (ids.indexOf(e.id) !== -1) {
        e.recallCount = (e.recallCount || 0) + 1;
        e.lastRecalledAt = now;
        e.updatedAt = now;
        changed = true;
      }
    }
    return changed ? save(data) : false;
  }

  // 相对时间（今天/昨天/N天前/N周前/N个月前/具体日期）
  function relativeTime(ts, nowTs) {
    var t = ts ? new Date(ts).getTime() : 0;
    if (!t || isNaN(t)) return '';
    var now = nowTs || Date.now();
    var dayMs = 86400000;
    var diffDays = Math.floor((now - t) / dayMs);
    if (diffDays < 0) return '刚刚';
    if (diffDays === 0) {
      var d = new Date(ts);
      var n = new Date(now);
      if (d.getDate() === n.getDate() && d.getMonth() === n.getMonth()) return '今天';
      return '昨天';
    }
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return diffDays + ' 天前';
    if (diffDays < 30) return Math.floor(diffDays / 7) + ' 周前';
    if (diffDays < 365) return Math.floor(diffDays / 30) + ' 个月前';
    var o = new Date(ts);
    return o.getFullYear() + '年' + (o.getMonth() + 1) + '月' + o.getDate() + '日';
  }

  // 时刻挑选评分：越值得「此刻想起」分越低（越靠前）。
  // - 刚发生、还没被提起过的优先（新鲜的共同经历）
  // - 负面情绪的优先（需要被记得：曾低落/曾焦虑的时刻）
  // - 被反复提起的靠后（避免炒冷饭）
  function momentScore(m, now) {
    var t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
    var ageDays = t ? (now - t) / 86400000 : 999;
    var recency = ageDays < 0 ? 0 : Math.min(ageDays, 30);
    var emotionBonus = (EMOTIONS[m.emotion] && EMOTIONS[m.emotion].negative) ? -8 : 0;
    var recalledPenalty = Math.min(m.recallCount || 0, 5) * 6;
    var freshPenalty = (m.lastRecalledAt && (now - new Date(m.lastRecalledAt).getTime()) < 7 * 86400000) ? 4 : 0;
    // 身份/健康/关系/目标类时刻长期有价值，稍靠前
    var catBonus = (m.category === 'identity' || m.category === 'health' || m.category === 'relationship' || m.category === 'goal') ? -2 : 0;
    return recency + recalledPenalty + freshPenalty + emotionBonus + catBonus;
  }

  // 时刻列表 → 注入文本（「我们的回忆」段）。按 momentScore 排序，受 maxChars 约束。
  function buildMomentsText(mem, maxChars) {
    var moments = (mem && Array.isArray(mem.moments)) ? mem.moments : [];
    if (!moments.length) return '';
    var now = Date.now();
    var entries = [];
    for (var i = 0; i < moments.length; i++) {
      var m = moments[i];
      if (!m || m.status === 'archived') continue;
      if (!m.excerpt || !String(m.excerpt).trim()) continue;
      entries.push({ m: m, score: momentScore(m, now) });
    }
    entries.sort(function(a, b) { return a.score - b.score; });

    var lines = [];
    var total = 0;
    for (var k = 0; k < entries.length; k++) {
      var mm = entries[k].m;
      var emo = EMOTIONS[mm.emotion] ? EMOTIONS[mm.emotion].label : '平常';
      var line = '- [' + relativeTime(mm.createdAt) + ']（' + emo + '）' + (mm.title || '') + '：' + String(mm.excerpt).substring(0, 40);
      total += line.length + 1;
      if (total > maxChars) break;
      lines.push(line);
    }
    return lines.join('\n');
  }

  // 最近几天情绪概览 + 低落提示（「感受」段）。返回文本或空串。
  function buildFeelingText(mem, days) {
    var moments = (mem && Array.isArray(mem.moments)) ? mem.moments : [];
    var windowDays = days || 3;
    var cutoff = Date.now() - windowDays * 86400000;
    var counts = {};
    var negatives = 0;
    var samples = [];
    for (var i = 0; i < moments.length; i++) {
      var m = moments[i];
      if (!m || m.status === 'archived') continue;
      var t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
      if (!t || t < cutoff) continue;
      var emo = EMOTIONS[m.emotion] ? EMOTIONS[m.emotion] : null;
      if (!emo) continue;
      counts[m.emotion] = (counts[m.emotion] || 0) + 1;
      if (emo.negative) {
        negatives++;
        if (samples.length < 2 && m.excerpt) samples.push(String(m.excerpt).substring(0, 24));
      }
    }
    var labels = [];
    for (var c in counts) {
      if (counts.hasOwnProperty(c) && EMOTIONS[c]) {
        labels.push(EMOTIONS[c].label + '×' + counts[c]);
      }
    }
    if (!labels.length) return '';
    var text = '最近 ' + windowDays + ' 天的感受：' + labels.join('、');
    if (negatives >= 2) {
      text += '。这阵子你似乎不太开心' + (samples.length ? '（比如「' + samples.join('」「') + '」）' : '') + '，如果话题合适，自然地关心一下，但不要刻意说教。';
    }
    return text;
  }

  function cap(text, max) {
    if (!text) return '';
    return text.length <= max ? text : text.substring(0, max) + '…';
  }

  // ─── v5：记忆注入文本 ───

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dateLabel(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function shortDate(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function buildRoleText(mem) {
    var role = getRole(mem);
    var parts = [];
    if (role.identity) parts.push('### 身份\n' + cap(role.identity, 300));
    if (role.personality) parts.push('### 性格\n' + cap(role.personality, 500));
    if (role.tone) parts.push('### 语气风格\n' + cap(role.tone, 200));
    if (role.knowledge) parts.push('### 知识/擅长\n' + cap(role.knowledge, 400));
    if (role.background) parts.push('### 背景故事\n' + cap(role.background, 300));
    if (role.boundaries) parts.push('### 能力边界\n' + cap(role.boundaries, 300));
    return parts.join('\n\n');
  }

  function buildProfileText(mem) {
    var p = getProfile(mem);
    var lines = [];
    if (p.name) lines.push('- 名字：' + p.name);
    if (p.gender) lines.push('- 性别：' + p.gender);
    if (p.age) lines.push('- 年龄：' + p.age);
    if (p.occupation) lines.push('- 职业：' + p.occupation);
    if (p.city) lines.push('- 所在城市：' + p.city);
    if (p.emotionalStatus) lines.push('- 情感状态：' + p.emotionalStatus);
    if (p.relationshipStatus) lines.push('- 关系状态：' + p.relationshipStatus);
    if (Array.isArray(p.keyDates) && p.keyDates.length) {
      lines.push('- 重要日期：' + p.keyDates.map(function(k) { return k.label + ' ' + k.date; }).join('；'));
    }
    if (Array.isArray(p.longTermGoals) && p.longTermGoals.length) {
      lines.push('- 长期目标：' + p.longTermGoals.join('、'));
    }
    if (p.notes) lines.push('- 补充：' + cap(p.notes, 300));
    return cap(lines.join('\n'), 800);
  }

  var V5_FACT_WEIGHT = { '重要日期': 0, '健康身体': 1, '人际关系': 2, '长期目标': 3, '自我认知': 4, '工作学业': 5, '生活事件': 6, '情绪状态': 7, '偏好习惯': 8, '其他': 9 };

  function buildSemanticText(mem, maxChars) {
    var list = (mem && Array.isArray(mem.semantic) ? mem.semantic : []).filter(function(s) { return s && s.status === 'active' && s.statement; });
    list.sort(function(a, b) {
      var ca = a.confidence || 0, cb = b.confidence || 0;
      if (ca !== cb) return cb - ca;
      return String(b.updatedAt) < String(a.updatedAt) ? -1 : 1;
    });
    var lines = [], total = 0;
    for (var i = 0; i < list.length && i < 12; i++) {
      var line = '- ' + list[i].statement + ((list[i].tags && list[i].tags.length) ? '（' + list[i].tags.join('、') + '）' : '');
      total += line.length + 1;
      if (total > maxChars) break;
      lines.push(line);
    }
    return lines.join('\n');
  }

  function buildFactsV5Text(mem, maxChars) {
    var list = (mem && Array.isArray(mem.facts) ? mem.facts : []).filter(function(f) { return f && f.status === 'active' && f.key && f.value; });
    list.sort(function(a, b) {
      var wa = V5_FACT_WEIGHT[a.category] !== undefined ? V5_FACT_WEIGHT[a.category] : 9;
      var wb = V5_FACT_WEIGHT[b.category] !== undefined ? V5_FACT_WEIGHT[b.category] : 9;
      if (wa !== wb) return wa - wb;
      return String(b.updatedAt) < String(a.updatedAt) ? -1 : 1;
    });
    var lines = [], total = 0;
    for (var i = 0; i < list.length && i < 30; i++) {
      var f = list[i];
      var line = '- [' + f.category + '] ' + f.key + '：' + f.value;
      total += line.length + 1;
      if (total > maxChars) break;
      lines.push(line);
    }
    return lines.join('\n');
  }

  function buildPreferencesText(mem, maxChars) {
    var list = (mem && Array.isArray(mem.preferences) ? mem.preferences : []).filter(function(p) { return p && p.status === 'active' && p.key && p.value; });
    var lines = [], total = 0;
    for (var i = 0; i < list.length && i < 20; i++) {
      var p = list[i];
      var line = '- ' + (p.polarity === 'dislike' ? '不喜欢' : '喜欢') + ' ' + p.key + '：' + p.value;
      total += line.length + 1;
      if (total > maxChars) break;
      lines.push(line);
    }
    return lines.join('\n');
  }

  function episodeScore(e, query, now) {
    var t = e.occurredAt ? new Date(e.occurredAt).getTime() : 0;
    var ageDays = t ? Math.max(0, (now - t) / 86400000) : 120;
    var score = Math.min(ageDays, 90);
    var neg = { '低落': 1, '焦虑': 1, '愤怒': 1, '疲惫': 1 };
    if (neg[e.emotion]) score -= 6;
    if (query) {
      var q = String(query);
      var hits = simText(q, (e.summary || '') + ' ' + (e.title || '') + ' ' + ((e.tags || []).join(' ')));
      if (hits > 0.15) score -= hits * 40;
      if (e.people && e.people.length) {
        for (var i = 0; i < e.people.length; i++) {
          if (q.indexOf(e.people[i]) !== -1) { score -= 10; break; }
        }
      }
    }
    if (e.tags) {
      for (var j = 0; j < e.tags.length; j++) {
        if (query && String(query).indexOf(e.tags[j]) !== -1) score -= 3;
      }
    }
    return score;
  }

  function buildEpisodesV5Text(mem, query, maxChars) {
    var list = (mem && Array.isArray(mem.episodes) ? mem.episodes : []).filter(function(e) { return e && e.status === 'active' && e.summary; });
    if (!list.length) return '';
    var now = Date.now();
    var sorted = list.map(function(e) { return { e: e, s: episodeScore(e, query, now) }; });
    sorted.sort(function(a, b) { return a.s - b.s; });
    var lines = [], total = 0;
    for (var i = 0; i < sorted.length && i < 14; i++) {
      var e = sorted[i].e;
      var line = '- [' + shortDate(e.occurredAt) + ']（' + (e.emotion || '其他') + '）' +
        (e.title ? e.title + '：' : '') + str(e.summary).substring(0, 90);
      total += line.length + 1;
      if (total > maxChars) break;
      lines.push(line);
    }
    return lines.join('\n');
  }

  function buildSummariesText(mem, maxChars) {
    var list = (mem && Array.isArray(mem.summaries) ? mem.summaries : []).filter(function(s) { return s && s.status === 'active' && s.text; });
    var lines = [], total = 0;
    for (var i = 0; i < list.length && i < 3; i++) {
      var s = list[i];
      var line = '- ' + (s.periodEnd ? '[' + dateLabel(s.periodEnd) + '] ' : '') + s.text;
      total += line.length + 1;
      if (total > maxChars) break;
      lines.push(line);
    }
    return lines.join('\n');
  }

  function buildFeelingsV5Text(mem, days) {
    var cutoff = Date.now() - (days || 3) * 86400000;
    var counts = {}, negatives = 0, samples = [];
    ((mem && mem.episodes) || []).forEach(function(e) {
      if (!e || e.status !== 'active') return;
      var t = new Date(e.occurredAt || e.createdAt).getTime();
      if (!t || t < cutoff) return;
      counts[e.emotion || '其他'] = (counts[e.emotion || '其他'] || 0) + 1;
      if (['低落', '焦虑', '愤怒', '疲惫'].indexOf(e.emotion) !== -1) {
        negatives++;
        if (samples.length < 2 && e.summary) samples.push(str(e.summary).substring(0, 24));
      }
    });
    var labels = [];
    for (var k in counts) { if (counts.hasOwnProperty(k)) labels.push(k + '×' + counts[k]); }
    if (!labels.length) return '';
    var text = '最近 ' + (days || 3) + ' 天的感受：' + labels.join('、');
    if (negatives >= 2) text += '。这阵子用户似乎不太开心' + (samples.length ? '（比如「' + samples.join('」「') + '」）' : '') + '，如果话题合适，自然关心一下，不要说教。';
    return text;
  }

  // 提取引擎用：现有记忆的紧凑上下文（带 pending id，便于模型判断是否冲突）
  function buildMemoryContextForExtraction(mem) {
    var data = mem || loadOrCreate();
    var lines = [];
    var prof = buildProfileText(data);
    if (prof) lines.push('【核心画像】\n' + prof);
    var semantic = buildSemanticText(data, 500);
    if (semantic) lines.push('【语义记忆】\n' + semantic);
    var facts = buildFactsV5Text(data, 800);
    if (facts) lines.push('【事实记忆】\n' + facts);
    var prefs = buildPreferencesText(data, 500);
    if (prefs) lines.push('【偏好记忆】\n' + prefs);
    var eps = buildEpisodesV5Text(data, '', 900);
    if (eps) lines.push('【近期情节】\n' + eps);
    var pending = (data.pending || []).filter(function(p) { return p && p.status === 'pending'; });
    if (pending.length) {
      lines.push('【待确认】\n' + pending.slice(0, 8).map(function(p) {
        return '- id=' + p.id + ' layer=' + p.layer + ' key=' + p.key + ' 旧值=' + p.oldValue + ' 新值=' + p.newValue;
      }).join('\n'));
    }
    return cap(lines.join('\n\n'), 3500);
  }

  // 构建对话 system prompt：各段带长度上限，注入 moments（我们的回忆）与情绪概览（感受）。
  // toolList: [{name, desc}] 已注册 skill 的摘要，用于自动生成 tools 段
  function buildSystemPrompt(mem, toolList, query) {
    var files = getFiles(mem);
    var parts = [];

    var roleText = buildRoleText(mem);
    if (roleText) parts.push('## 角色档案\n' + roleText);

    var profileText = buildProfileText(mem);
    if (profileText) parts.push('## 用户核心画像\n' + profileText);

    var semanticText = buildSemanticText(mem, 600);
    if (semanticText) parts.push('## 语义记忆（沉淀的理解）\n' + semanticText);

    var factsText = buildFactsV5Text(mem, 700);
    if (factsText) parts.push('## 事实记忆\n' + factsText);

    var prefText = buildPreferencesText(mem, 400);
    if (prefText) parts.push('## 偏好记忆\n' + prefText);

    var episodesText = buildEpisodesV5Text(mem, query, 900);
    if (episodesText) parts.push('## 情节记忆（共同经历）\n' + episodesText);

    var summariesText = buildSummariesText(mem, 400);
    if (summariesText) parts.push('## 摘要记忆\n' + summariesText);

    var tools = cap(files.tools, SECTION_CAPS.tools);
    if (!tools || !tools.trim()) tools = buildToolsText(toolList, SECTION_CAPS.tools);
    if (tools && tools.trim()) parts.push('## 工具\n' + tools);

    var feelings = buildFeelingsV5Text(mem, 3);
    if (feelings) parts.push('## 感受\n' + cap(feelings, SECTION_CAPS.feelings));

    var heartbeat = cap(files.heartbeat, SECTION_CAPS.heartbeat);
    if (heartbeat && heartbeat.trim()) parts.push('## 心跳\n' + heartbeat);

    var head = '你是「小满」，一个温暖的 AI 生活伴侣。\n\n以下是你的角色设定与关于用户的记忆：\n\n';
    var tail = '\n\n回复要求：\n' +
      '- 用亲切自然的语气回复，先共情再回应，通常不超过 200 字\n' +
      '- 像一个有记忆的陪伴者：记忆与当前话题相关时自然提起（「我记得你…」），不要生硬背诵，也不要编造记忆\n' +
      '- 核心画像是最稳定的信息；情节记忆只是发生过的事，不能反过来推翻核心画像\n' +
      '- 「待确认」的记忆不要当成确定事实使用\n' +
      '- 用户情绪低落时，先关心、再解决问题；不评判、不说教、不催促';
    return head + parts.join('\n\n') + tail;
  }

  // 已注册 skill → tools 段文本（名称 + 一句话用途，总长受 maxChars 约束）
  function buildToolsText(toolList, maxChars) {
    if (!toolList || !toolList.length) return '';
    var lines = [];
    var total = 0;
    for (var i = 0; i < toolList.length; i++) {
      var t = toolList[i] || {};
      var name = t.name || 'unknown';
      var desc = (t.desc || '').replace(/\s+/g, ' ').trim();
      // 描述只取首句、截断，避免 tools 段膨胀
      var firstSentence = desc.split(/[。；;]/)[0];
      if (firstSentence && firstSentence.length > 50) firstSentence = firstSentence.substring(0, 50);
      var line = '- ' + name + (firstSentence ? '：' + firstSentence : '');
      total += line.length + 1;
      if (total > maxChars) break;
      lines.push(line);
    }
    return lines.join('\n');
  }

  // 事实卡片分类优先级（v3 遗留函数，保留供兼容/测试；v4 prompt 不再注入 facts）
  var FACT_CATEGORY_WEIGHT = {
    identity: 0, health: 1, relationship: 2, goal: 3, preference: 4, emotion: 5, belief: 6, event: 7
  };

  // 事实卡片 → 文本：按「分类重要性 + 时间新旧」排序后注入，cap 挤出的优先是旧且低价值的
  function buildFactsText(mem, maxChars) {
    var facts = (mem && Array.isArray(mem.facts)) ? mem.facts : [];
    if (facts.length === 0) return '';

    var entries = [];
    for (var i = 0; i < facts.length; i++) {
      var f = facts[i];
      var content = f && typeof f.fact === 'string' ? f.fact.trim() : '';
      if (!content) continue;
      var cat = f.category || 'other';
      var weight = FACT_CATEGORY_WEIGHT[cat] !== undefined ? FACT_CATEGORY_WEIGHT[cat] : 8;
      var created = parseInt(f.createdAt, 10) || 0;
      entries.push({ content: content, weight: weight, created: created });
    }
    entries.sort(function(a, b) {
      if (a.weight !== b.weight) return a.weight - b.weight;
      return b.created - a.created;
    });

    var lines = [];
    var total = 0;
    for (var k = 0; k < entries.length; k++) {
      var line = '• ' + entries[k].content;
      total += line.length + 1;
      if (total > maxChars) break;
      lines.push(line);
    }
    return lines.join('\n');
  }

  // ─── RAG：碎片时刻向量检索（对话时按「此刻相关」唤起回忆）───
  // 用 OpenAI 兼容 /embeddings（与对话同一 apiUrl；Ollama / LM Studio / OpenAI 兼容服务均可）。
  // 设计取舍（单机 App 不引入向量库）：
  // - 向量只存时刻记录内（moment 上限 300，内存余弦足够）
  // - 请求 dimensions=256，int8 量化存储（-127..127），限制带向量时刻数，JSON 体积可控
  // - 只给「新写入的时刻」后台补向量；不回溯补全
  // - embedding 不可用（无 /embeddings / 超时 / 未配置）→ retrieveMoments 返回空串，
  //   对话注入回退到既有时刻打分排序（buildMomentsText），陪伴能力不降级
  var EMBED_DIMS = 256;             // 请求维度（部分兼容服务忽略该参数，返回原生维度照收）
  var EMBED_MAX_VECTORS = 50;       // 最多保留向量的时刻数（超出剥离最旧，控 JSON 体积）
  var EMBED_TIMEOUT_MS = 3000;      // 查询向量超时（对话入口不拖慢回复太久）
  var queryEmbedCache = {};         // 会话内查询向量缓存（同一句不重复调 embedding）
  var embedsInFlight = {};          // 并发去重（同一文本只发一次）

  function embeddingModel() {
    try {
      var raw = (typeof AndroidSettings !== 'undefined' && AndroidSettings.loadSettings)
        ? AndroidSettings.loadSettings()
        : (localStorage.getItem('nian_settings') || '{}');
      var s = JSON.parse(raw);
      if (s.embeddingModel) return s.embeddingModel;
    } catch(e) {}
    var cfg = runtimeConfig();
    return (cfg.model && cfg.model.embeddingModel) || 'text-embedding-3-small';
  }

  function embedApiConfig() {
    try {
      var config = (typeof AndroidSettings !== 'undefined' && AndroidSettings.loadSettings)
        ? JSON.parse(AndroidSettings.loadSettings())
        : JSON.parse(localStorage.getItem('nian_settings') || '{}');
      if (!config || !config.apiUrl || !config.apiKey) return null;
      return { url: config.apiUrl.replace(/\/+$/, ''), key: config.apiKey, model: embeddingModel() };
    } catch(e) { return null; }
  }

  // OpenAI 兼容响应 → int8 量化归一化向量；解析失败返回 null
  function parseEmbedding(data) {
    try {
      var emb = data && data.data && data.data[0] && data.data[0].embedding;
      if (!emb || !emb.length || emb.length < 8) return null;
      var sum = 0;
      for (var i = 0; i < emb.length; i++) sum += emb[i] * emb[i];
      var norm = Math.sqrt(sum) || 1;
      var q = [];
      for (var j = 0; j < emb.length; j++) {
        var v = Math.max(-127, Math.min(127, Math.round((emb[j] / norm) * 127)));
        q.push(v);
      }
      return q;
    } catch(e) { return null; }
  }

  // 文本 → 向量（会话缓存 + 并发去重）。失败/未配置/超时 → null。
  function embedText(text) {
    return new Promise(function(resolve) {
      var cfg = embedApiConfig();
      if (!cfg || typeof NativeHttp === 'undefined' || !NativeHttp.postJson) { resolve(null); return; }
      var key = 'e:' + String(text).trim().substring(0, 200);
      if (queryEmbedCache[key]) { resolve(queryEmbedCache[key]); return; }
      if (embedsInFlight[key]) { embedsInFlight[key].push(resolve); return; }
      embedsInFlight[key] = [resolve];
      var done = false;
      var timer = setTimeout(function() {
        if (done) return;
        done = true;
        var qs = embedsInFlight[key];
        delete embedsInFlight[key];
        if (qs) for (var z = 0; z < qs.length; z++) qs[z](null);
      }, EMBED_TIMEOUT_MS);

      function flush(vec) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        queryEmbedCache[key] = vec;
        var qs = embedsInFlight[key];
        delete embedsInFlight[key];
        if (qs) for (var i = 0; i < qs.length; i++) qs[i](vec);
      }

      var payload = { model: cfg.model, input: String(text).trim().substring(0, 800) };
      var headers = { Authorization: 'Bearer ' + cfg.key };
      var attempt = function(withDims) {
        var body = payload;
        if (withDims) body = { model: cfg.model, input: payload.input, dimensions: EMBED_DIMS };
        NativeHttp.postJson(NativeHttp.embeddingsEndpoint(cfg.url), headers, body).then(function(data) {
          var vec = parseEmbedding(data);
          if (!vec && withDims) { attempt(false); return; } // 服务不支持 dimensions → 去参重试
          flush(vec);
        }, function() { flush(null); });
      };
      attempt(true);
    });
  }

  // int8 量化向量的余弦相似度（解量化比例一致，可省略除法）
  function cosineInt8(a, b) {
    var n = Math.min(a.length, b.length);
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < n; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  // 为新时刻异步补向量并写回；超出 EMBED_MAX_VECTORS 时剥离最旧的向量字段
  function embedMoment(momentId, text) {
    try {
      if (!text || !text.trim()) return;
      embedText(text).then(function(vec) {
        if (!vec) return;
        var data = load();
        if (!data || !Array.isArray(data.moments)) return;
        for (var i = 0; i < data.moments.length; i++) {
          if (data.moments[i] && data.moments[i].id === momentId) {
            data.moments[i].embedding = vec;
            data.moments[i].embedDim = vec.length;
            break;
          }
        }
        var withVec = [];
        for (var k = 0; k < data.moments.length; k++) {
          var mm = data.moments[k];
          if (mm && Array.isArray(mm.embedding) && mm.embedding.length) withVec.push(mm);
        }
        if (withVec.length > EMBED_MAX_VECTORS) {
          withVec.sort(function(a, b) {
            var at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            var bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return at - bt;
          });
          for (var x = 0; x < withVec.length - EMBED_MAX_VECTORS; x++) {
            delete withVec[x].embedding;
            delete withVec[x].embedDim;
          }
        }
        save(data);
      });
    } catch(e) {}
  }

  // RAG 检索：query 向量化 → 与带向量时刻余弦 → 相关度 topK 行文本。
  // excludeText：已注入 system prompt 的内容（按摘录子串去重，避免重复）。
  // 格式：'## 此刻相关的回忆' 段（含前导换行），无结果/不可用返回 ''。
  function retrieveMoments(query, topK, excludeText) {
    topK = topK || 4;
    return new Promise(function(resolve) {
      if (!query || typeof NativeHttp === 'undefined' || !NativeHttp.postJson) { resolve(''); return; }
      embedText(query).then(function(vec) {
        if (!vec) { resolve(''); return; }
        try {
          var data = load();
          var candidates = [];
          if (data && Array.isArray(data.moments)) {
            for (var i = 0; i < data.moments.length; i++) {
              var m = data.moments[i];
              if (!m || m.status === 'archived' || !Array.isArray(m.embedding) || !m.embedding.length) continue;
              if (excludeText && m.excerpt && excludeText.indexOf(m.excerpt) !== -1) continue;
              candidates.push({ m: m, sim: cosineInt8(vec, m.embedding) });
            }
          }
          if (!candidates.length) { resolve(''); return; }
          candidates.sort(function(a, b) { return b.sim - a.sim; });
          var lines = [];
          var total = 0;
          var limit = 600;
          for (var k = 0; k < candidates.length && k < topK; k++) {
            var c = candidates[k];
            var emo = EMOTIONS[c.m.emotion] ? EMOTIONS[c.m.emotion].label : '平常';
            var line = '- [' + relativeTime(c.m.createdAt) + ']（' + emo + '）' + (c.m.title || '') + '：' + String(c.m.excerpt).substring(0, 40);
            total += line.length + 1;
            if (total > limit) break;
            lines.push(line);
          }
          resolve(lines.length ? '\n\n## 此刻相关的回忆\n' + lines.join('\n') : '');
        } catch(e) { resolve(''); }
      });
    });
  }

  // ─── 提醒（remember_to 工具 + 心跳扫描共用）───
  function loadReminders() {
    var data = load();
    if (!data || !Array.isArray(data.reminders)) return [];
    return data.reminders;
  }

  function saveReminders(reminders) {
    var data = loadOrCreate();
    data.reminders = reminders.slice(0, 100);
    return save(data);
  }

  // 到期且未完成 → 返回这些提醒；可传入今天日期（YYYY-MM-DD）便于测试
  function dueReminders(todayStr) {
    var reminders = loadReminders();
    if (!reminders.length) return [];
    var today = todayStr || new Date().toISOString().substring(0, 10);
    return reminders.filter(function(r) {
      return !r.done && r.date && r.date <= today;
    });
  }

  window.MemoryService = {
    FILE_DEFAULTS: FILE_DEFAULTS, OLD_FILE_DEFAULTS: OLD_FILE_DEFAULTS,
    ROLE_DEFAULTS: ROLE_DEFAULTS, PROFILE_DEFAULTS: PROFILE_DEFAULTS,
    PROFILE_FIELDS: PROFILE_FIELDS, MEMORY_CATEGORIES: MEMORY_CATEGORIES,
    EPISODE_EMOTIONS: EPISODE_EMOTIONS, MEMORY_ITEM_CAPS: MEMORY_ITEM_CAPS,
    SECTION_CAPS: SECTION_CAPS,
    MAX_MEMORY_CHARS: MAX_MEMORY_CHARS,
    MAX_MOMENTS: MAX_MOMENTS,
    ARCHIVE_AFTER_DAYS: ARCHIVE_AFTER_DAYS,
    EMOTIONS: EMOTIONS,
    EMOTION_BY_LABEL: EMOTION_BY_LABEL,
    TASK_PROMPTS: TASK_PROMPTS,
    createEmpty: createEmpty,
    migrate: migrate,
    load: load,
    save: save,
    loadOrCreate: loadOrCreate,
    getFiles: getFiles,
    updateFile: updateFile,
    appendMemory: appendMemory,
    addMoment: addMoment,
    listMoments: listMoments,
    recentMoments: recentMoments,
    updateMoment: updateMoment,
    deleteMoment: deleteMoment,
    archiveOldMoments: archiveOldMoments,
    markRecalled: markRecalled,
    markRecalledEpisodes: markRecalledEpisodes,
    relativeTime: relativeTime,
    embedText: embedText,
    retrieveMoments: retrieveMoments,
    cosineInt8: cosineInt8,
    EMBED_DIMS: EMBED_DIMS,
    buildMomentsText: buildMomentsText,
    buildFeelingText: buildFeelingText,
    buildSystemPrompt: buildSystemPrompt,
    buildToolsText: buildToolsText,
    buildFactsText: buildFactsText,
    loadReminders: loadReminders,
    saveReminders: saveReminders,
    dueReminders: dueReminders,
    // v5
    getRole: getRole,
    updateRole: updateRole,
    getProfile: getProfile,
    updateProfile: updateProfile,
    upsertFact: upsertFact,
    upsertPreference: upsertPreference,
    addEpisode: addEpisode,
    upsertSemantic: upsertSemantic,
    addSummary: addSummary,
    addMemory: addMemory,
    updateMemoryItem: updateMemoryItem,
    setMemoryStatus: setMemoryStatus,
    deleteMemoryItem: deleteMemoryItem,
    resolvePending: resolvePending,
    listPending: listPending,
    applyArchiveUpdate: applyArchiveUpdate,
    buildMemoryContextForExtraction: buildMemoryContextForExtraction,
    buildRoleText: buildRoleText,
    buildProfileText: buildProfileText,
    buildSemanticText: buildSemanticText,
    buildFactsV5Text: buildFactsV5Text,
    buildPreferencesText: buildPreferencesText,
    buildEpisodesV5Text: buildEpisodesV5Text,
    buildSummariesText: buildSummariesText,
    buildFeelingsV5Text: buildFeelingsV5Text,
    normText: normText,
    simText: simText,
    uid: uid,
    nowIso: nowIso,
    trimTo: trimTo,
    dateLabel: dateLabel
  };
})();