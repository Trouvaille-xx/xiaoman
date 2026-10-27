// ─── MemoryEngine：每轮对话后的记忆提取 / 冲突识别 / 写入 ───
// 依赖 memory-service.js（MemoryService）与 native-http.js（NativeHttp）。
// 设计：一次 LLM 调用完成「事实提取 → 与现有记忆比较 → 输出写入动作」，
// 本地再做去重、冲突待确认、结构化落盘。失败静默，不影响对话。
(function() {
  'use strict';

  var EXTRACT_PROMPT = [
    '你是长期陪伴记忆系统的「事实提取 + 记忆比较」引擎。你只负责从本轮对话中提取值得长期记住的信息，并判断如何写入。',
    '',
    '严格输出一个 JSON 对象，不要输出解释、Markdown 或代码块。结构如下：',
    '{',
    '  "intent": "记录随笔|倾诉情绪|寻求安慰|寻求建议|单纯闲聊|回顾过去|确认记忆|不明确|其他",',
    '  "facts": [{"category":"情绪状态|生活事件|人际关系|工作学业|健康身体|自我认知|重要日期|长期目标|偏好习惯|其他","key":"","value":"","confidence":0.8,"evidence":"","context":""}],',
    '  "preferences": [{"key":"","value":"","polarity":"like|dislike","tags":[],"confidence":0.8,"evidence":"","context":""}],',
    '  "episodes": [{"title":"","summary":"","occurredAt":"","emotion":"低落|焦虑|愤怒|疲惫|平静|开心|迷茫|期待|其他","intensity":0.5,"context":"","people":[],"tags":[],"evidence":""}],',
    '  "profile": {"name":"","gender":"","age":"","occupation":"","city":"","emotionalStatus":"","relationshipStatus":"","keyDates":[{"label":"","date":""}],"longTermGoals":[]},',
    '  "semantic": [{"statement":"","tags":[],"confidence":0.7,"evidence":""}],',
    '  "resolutions": [{"id":"","resolution":"accept_new|keep_old|keep_both_by_context|reject_both"}]',
    '}',
    '',
    '规则：',
    '1. 只提取用户明确说出的内容；不要从小满的回复或语气里臆断。',
    '2. 寒暄、客套、无信息量的情绪宣泄不记录，对应数组留空。',
    '3. facts 只存稳定属性（姓名、职业、城市、健康、长期目标、关系等）。本轮发生的事件只写 episodes，不要写进 facts。',
    '4. 同一个对象必须使用相同的 key：例如「咖啡」的喜欢与后来的不喜欢都用 key=咖啡，不要拆成两条；偏好变化时输出当前状态。',
    '5. preferences 用于喜好与习惯；polarity 只能是 like 或 dislike。',
    '6. episodes 用于带时间的事件/经历，一句 summary 讲清「发生了什么 + 用户感受」；同一件事只输出一条。',
    '7. 用户说「今天/昨晚/上周/下周三」等相对时间时，按【当前日期】换算成具体日期填入 occurredAt；只有用户明确提到时间才填，否则留空。',
    '8. 用户讲事件或情绪时，episodes.emotion 和 intensity（0-1）必填。',
    '9. 重要日期（生日/纪念日/约定日期）写入 profile.keyDates 或 facts 的「重要日期」分类，confidence 0.95。',
    '10. 用户提到自己的名字/性别/年龄/职业/城市/情感或关系状态时，填入 profile 对应字段；不确定的字段省略。',
    '11. semantic 用于沉淀的抽象理解（如「用户正处于工作低谷期」「用户习惯深夜倾诉」），不是事实复述。',
    '12. 与【现有记忆】重复的内容不要重复输出；新信息更完整时可输出更新后的值。',
    '13. 与现有记忆明显相反时（例如以前讨厌、现在喜欢），正常输出新值；系统会向用户确认。',
    '14. 「可能、好像、偶尔、有点、暂时、不确定」等表述 confidence ≤0.5。',
    '15. 场景不同（例如工作日 vs 周末）不算矛盾，请在 context 里写清场景；单纯的状态变化不要用场景解释。',
    '16. 如果用户本轮在回应【待确认】中的问题，请在 resolutions 里给出对应 id 与 resolution。',
    '17. 如果本轮只是在回答【待确认】里的问题，只输出 resolutions 与真正新增的信息；不要重复输出正在被确认的同一条记忆。',
    '18. 没有新记忆时也必须输出完整 JSON（数组为空）。'
  ].join('\n');

  function getConfig() {
    try {
      if (typeof DataService !== 'undefined' && DataService.settings) return DataService.settings.load();
    } catch (e) {}
    try {
      if (typeof AndroidSettings !== 'undefined' && AndroidSettings && AndroidSettings.loadSettings) {
        var raw = AndroidSettings.loadSettings();
        return raw ? JSON.parse(raw) : null;
      }
    } catch (e) {}
    try {
      var cached = localStorage.getItem('nian_settings');
      return cached ? JSON.parse(cached) : null;
    } catch (e) {}
    return null;
  }

  // 模型偶尔会包 ```json 或带前后解释：尽量取出第一个完整 JSON 对象
  function parseJson(text) {
    if (!text) return null;
    var s = String(text)
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\/?think>/gi, '')
      .trim();
    s = s.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(s.substring(start, end + 1)); } catch (e) { return null; }
  }

  function buildPrompt(context, userMessage, assistantText) {
    var d = new Date();
    var today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return EXTRACT_PROMPT +
      '\n\n【当前日期】' + today +
      '\n\n【现有记忆】\n' + (context || '（暂无记忆）') +
      '\n\n【本轮对话】\n用户：' + String(userMessage || '').substring(0, 1200) +
      '\n小满：' + String(assistantText || '').substring(0, 800) +
      '\n\n请输出提取结果 JSON。';
  }

  function extract(userMessage, assistantText, mem) {
    return new Promise(function(resolve) {
      try {
        var cfg = getConfig();
        if (!cfg || !cfg.apiUrl || !cfg.apiKey) { resolve(null); return; }
        if (typeof NativeHttp === 'undefined' || !NativeHttp.postJson) { resolve(null); return; }
        var S = window.MemoryService;
        var context = (S && S.buildMemoryContextForExtraction) ? S.buildMemoryContextForExtraction(mem) : '';
        var url = NativeHttp.chatEndpoint(cfg.apiUrl);
        var payload = {
          model: cfg.model || 'gpt-4o',
          messages: [
            { role: 'system', content: buildPrompt(context, userMessage, assistantText) },
            { role: 'user', content: '请输出 JSON。' }
          ],
          temperature: 0.2,
          max_tokens: 1600
        };
        NativeHttp.postJson(url, { Authorization: 'Bearer ' + cfg.apiKey }, payload).then(function(data) {
          var text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          resolve(parseJson(text));
        }, function() { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  function blankStats() {
    return {
      created: { facts: 0, preferences: 0, episodes: 0, semantic: 0 },
      duplicates: 0,
      contextual: 0,
      pending: [],
      profileChanges: [],
      resolutions: []
    };
  }

  function bump(stats, result, key) {
    if (!result) return;
    if (result.action === 'created') stats.created[key]++;
    else if (result.action === 'duplicate') stats.duplicates++;
    else if (result.action === 'contextual') { stats.contextual++; stats.created[key]++; }
    else if (result.action === 'pending' && result.pending) stats.pending.push(result.pending);
  }

  // 「姓名」类事实兜底映射到核心画像，防止模型只输出 facts 不输出 profile
  var FACT_TO_PROFILE = {
    '姓名': 'name', '名字': 'name', '性别': 'gender', '年龄': 'age', '职业': 'occupation',
    '工作': 'occupation', '城市': 'city', '所在地': 'city', '所在城市': 'city',
    '情感状态': 'emotionalStatus', '恋爱状态': 'emotionalStatus', '关系状态': 'relationshipStatus'
  };

  function apply(mem, parsed) {
    var S = window.MemoryService;
    var stats = blankStats();
    if (!mem || !parsed || !S) return stats;

    // 1) 先处理用户对「待确认」的回应
    (parsed.resolutions || []).forEach(function(r) {
      if (!r || !r.id || !r.resolution) return;
      if (S.resolvePending(r.id, r.resolution, mem)) stats.resolutions.push({ id: r.id, resolution: r.resolution });
    });

    // 2) 核心画像
    var profilePatch = {};
    if (parsed.profile && typeof parsed.profile === 'object') {
      S.PROFILE_FIELDS.forEach(function(f) {
        if (parsed.profile[f] !== undefined && parsed.profile[f] !== null && String(parsed.profile[f]).trim()) {
          profilePatch[f] = String(parsed.profile[f]).trim();
        }
      });
      if (Array.isArray(parsed.profile.keyDates) && parsed.profile.keyDates.length) profilePatch.keyDates = parsed.profile.keyDates;
      if (Array.isArray(parsed.profile.longTermGoals) && parsed.profile.longTermGoals.length) profilePatch.longTermGoals = parsed.profile.longTermGoals;
    }

    // 3) 事实（先写入，便于兜底映射 profile）
    var factResults = [];
    (parsed.facts || []).forEach(function(f) {
      if (!f || !f.key || !f.value) return;
      // 已经写进核心画像的字段不再重复进事实记忆
      var mapped = FACT_TO_PROFILE[String(f.key).trim()];
      if (mapped && parsed.profile && parsed.profile[mapped] &&
          S.normText(parsed.profile[mapped]) === S.normText(f.value)) return;
      var r = S.upsertFact(mem, f);
      factResults.push({ input: f, result: r });
      bump(stats, r, 'facts');
    });
    factResults.forEach(function(x) {
      var field = FACT_TO_PROFILE[String(x.input.key).trim()];
      if (!field || profilePatch[field]) return;
      if (mem.profile && mem.profile[field]) return;
      profilePatch[field] = String(x.input.value).trim();
    });
    if (Object.keys(profilePatch).length) {
      var pr = S.updateProfile(profilePatch, { allowNotes: false }, mem);
      stats.profileChanges = stats.profileChanges.concat(pr.changes || []);
      if (pr.pending) stats.pending = stats.pending.concat(pr.pending);
    }

    // 4) 偏好
    (parsed.preferences || []).forEach(function(p) {
      if (!p || !p.key || !p.value) return;
      bump(stats, S.upsertPreference(mem, p), 'preferences');
    });

    // 5) 情节（时序）
    (parsed.episodes || []).forEach(function(e) {
      if (!e || (!e.summary && !e.title)) return;
      bump(stats, S.addEpisode(mem, e), 'episodes');
    });

    // 6) 语义沉淀
    (parsed.semantic || []).forEach(function(s) {
      if (!s || !s.statement) return;
      bump(stats, S.upsertSemantic(mem, s), 'semantic');
    });

    // 7) 摘要（如果模型给了）
    (parsed.summaries || []).forEach(function(s) {
      if (!s || !s.text) return;
      S.addSummary(mem, s);
    });

    return stats;
  }

  // 主入口：一轮对话结束后调用。
  // opts: {userMessage, assistantText, mem?, save?}
  // 传入 mem 时在副本上操作且不落盘（测试/沙盒用）。
  function processTurn(opts) {
    opts = opts || {};
    var S = window.MemoryService;
    if (!S) return Promise.resolve({ ok: false, error: 'memory-service-missing' });
    var mem = opts.mem || S.loadOrCreate();
    return extract(opts.userMessage, opts.assistantText, mem).then(function(parsed) {
      if (!parsed) return { ok: false, error: 'extract-failed' };
      var stats = apply(mem, parsed);
      if (!opts.mem && opts.save !== false) S.save(mem);
      var questions = (stats.pending || []).filter(Boolean).map(function(p) { return p && p.question; }).filter(Boolean);
      if (!questions.length && parsed.confirmation_question) questions.push(String(parsed.confirmation_question));
      stats.ok = true;
      stats.parsed = parsed;
      stats.questions = questions;
      return stats;
    });
  }

  // 供测试/调试：只提取不写入
  function extractOnly(userMessage, assistantText, mem) {
    return extract(userMessage, assistantText, mem || (window.MemoryService && MemoryService.loadOrCreate()));
  }

  // L2 摘要记忆：把近期情节浓缩成一段结论（含主题与情绪趋势）。
  // 传入 mem 时在副本上操作且不落盘；不传时读写实际记忆。
  function makeSummary(mem) {
    return new Promise(function(resolve) {
      try {
        var S = window.MemoryService;
        var cfg = getConfig();
        if (!S || !cfg || !cfg.apiUrl || !cfg.apiKey) { resolve(null); return; }
        if (typeof NativeHttp === 'undefined' || !NativeHttp.postJson) { resolve(null); return; }
        var useMem = mem || S.loadOrCreate();
        var eps = (useMem.episodes || []).filter(function(e) { return e && e.status === 'active' && e.summary; }).slice(0, 30);
        if (!eps.length) { resolve(null); return; }
        var dates = eps.map(function(e) { return new Date(e.occurredAt || e.createdAt).getTime(); }).filter(function(t) { return t > 0; });
        var periodStart = dates.length ? S.dateLabel(Math.min.apply(null, dates)) : '';
        var periodEnd = dates.length ? S.dateLabel(Math.max.apply(null, dates)) : '';
        var lines = eps.map(function(e) {
          return S.dateLabel(e.occurredAt) + '（' + (e.emotion || '其他') + '）' + (e.title ? e.title + '：' : '') + e.summary;
        }).join('\n');
        var sys = '你是记忆整理助手。请把给定时段的情节记忆浓缩成 1-3 句「摘要记忆」，并给出主题标签与情绪趋势。\n' +
          '只输出 JSON：{"text":"","themes":[],"emotionTrend":"","periodStart":"","periodEnd":""}。\n' +
          '要求：只基于给定内容，不编造；text 不超过 120 字；themes 2-4 个短标签；emotionTrend 一句话。';
        var user = '【核心画像】\n' + S.buildProfileText(useMem) +
          '\n\n【语义记忆】\n' + S.buildSemanticText(useMem, 400) +
          '\n\n【情节记忆】\n' + lines;
        NativeHttp.postJson(NativeHttp.chatEndpoint(cfg.apiUrl), { Authorization: 'Bearer ' + cfg.apiKey }, {
          model: cfg.model || 'gpt-4o',
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
          temperature: 0.3,
          max_tokens: 500
        }).then(function(data) {
          var text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          var parsed = parseJson(text);
          if (!parsed || !parsed.text) { resolve(null); return; }
          parsed.periodStart = parsed.periodStart || periodStart;
          parsed.periodEnd = parsed.periodEnd || periodEnd;
          var r = S.addSummary(useMem, parsed);
          if (!mem) S.save(useMem);
          resolve(r && r.item ? r.item : null);
        }, function() { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  window.MemoryEngine = {
    prompt: EXTRACT_PROMPT,
    extract: extract,
    extractOnly: extractOnly,
    parseJson: parseJson,
    apply: apply,
    processTurn: processTurn,
    makeSummary: makeSummary,
    blankStats: blankStats
  };
})();
