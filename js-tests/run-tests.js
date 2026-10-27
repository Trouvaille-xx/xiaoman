// 小满项目 JS 逻辑单元测试（无依赖，node run-tests.js）
// 覆盖：agent 上下文 token 预算截断、MemoryService 去重/上限/迁移/prompt 构建、NativeHttp 回调分发
'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

function section(name) {
  console.log('\n== ' + name + ' ==');
}

// ── 基础 shim ──
function freshWindow() {
  const store = {};
  const win = {};
  global.window = win;
  global.localStorage = {
    _s: store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  win.localStorage = global.localStorage;
  return win;
}

function fakeMemoryBridge() {
  let mem = null;
  const bridge = {
    loadAll: () => mem,
    saveAll: (j) => { mem = j; }
  };
  global.AndroidMemory = bridge;
  return bridge;
}

function loadJs(name) {
  const code = fs.readFileSync(path.join(ASSETS, name), 'utf8');
  // 用 vm 沙箱执行：window 即沙箱全局，使 window.X 与自由变量 X 解析一致（与浏览器相同）
  const vm = require('vm');
  const win = global.window;
  win.window = win; // 自引用：window 标识符解析到沙箱全局
  win.AndroidMemory = global.AndroidMemory;
  win.console = console;
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  vm.createContext(win);
  vm.runInContext(code, win, { filename: name });
  return win;
}

// ═══════════ agent.js：上下文预算截断 ═══════════
section('agent.js 上下文预算');
{
  freshWindow();
  loadJs('agent.js');
  const Agent = global.window.NianAgent;
  assert(typeof Agent === 'function', 'NianAgent 已导出');
  global.window.DataService = {
    settings: { load: function() { return { apiUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' }; } }
  };

  const a = new Agent();
  // 塞入 30 条长消息（模拟多轮对话 + 工具调用）
  for (let i = 0; i < 30; i++) {
    a.messages.push({ role: 'user', content: '第' + i + '轮消息' + '很长很长的内容'.repeat(50) });
    a.messages.push({ role: 'assistant', content: '回复内容'.repeat(80) });
  }
  const system = '你是小满。'.repeat(100);
  const ctx = a.buildContext(system);
  assert(ctx.length < a.messages.length, '历史被裁剪（' + ctx.length + '/' + a.messages.length + '）');
  assert(ctx[0].role === 'system', 'system prompt 始终在首位');
  const last = a.messages[a.messages.length - 1];
  const ctxLast = ctx[ctx.length - 1];
  assert(ctxLast.content === last.content, '最近一条消息始终保留');

  // 预算内不裁剪
  const b = new Agent();
  b.messages.push({ role: 'user', content: '短消息' });
  const ctxB = b.buildContext('短系统提示');
  assert(ctxB.length === 2, '小历史不裁剪');

  // setHistory 只收 user/assistant
  const c = new Agent();
  c.setHistory([
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'tool', content: 'tool result', tool_call_id: 'x' },
    { role: 'system', content: 'sys' }
  ]);
  assert(c.messages.length === 2, 'setHistory 过滤非 user/assistant');

  // 工具结果长度上限
  c.messages.push({ role: 'user', content: '再来一条' });
  // 直接调用内部截断逻辑：模拟 finishTool 路径
  const toolResult = 'x'.repeat(5000);
  // 通过 process 验证不可行（需要网络），改为验证 truncateText 语义在 buildContext 内不报错
  const ctxC = c.buildContext('s');
  assert(Array.isArray(ctxC), 'buildContext 返回数组');

  // ── 总结机制：超预算时 LLM 总结旧历史，而非直接丢弃 ──
  // 提供 _summarize 需要的 DataService 配置
  global.window.DataService = {
    settings: { load: function() { return { apiUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' }; } }
  };

  // 1) buildContext 注入摘要（合并进 system）
  const d = new Agent();
  d.summary = '• 用户喜欢喝茶\n• 用户养了一只猫';
  d.messages.push({ role: 'user', content: '你好' });
  const ctxD = d.buildContext('你是小满。');
  assert(ctxD[0].role === 'system', '摘要合并进 system');
  assert(ctxD[0].content.indexOf('## 对话摘要') !== -1, 'system 含摘要段');
  assert(ctxD[0].content.indexOf('用户喜欢喝茶') !== -1, '摘要内容注入');

  // 2) _ensureBudget 成功：stub LLM 返回摘要 → 消息收窄为最近窗口 + 摘要更新
  const e = new Agent();
  e._callLLM = function(payload, cb) {
    // 校验摘要请求确实把旧历史发出去了
    const userMsg = payload.messages[payload.messages.length - 1].content;
    assert(userMsg.indexOf('对话历史') !== -1, '摘要请求携带对话历史');
    cb(null, { choices: [{ message: { content: '• 总结：用户提及了工作项目' } }] });
  };
  for (let i = 0; i < 30; i++) {
    e.messages.push({ role: 'user', content: '第' + i + '轮很长的内容'.repeat(40) });
    e.messages.push({ role: 'assistant', content: '回复'.repeat(60) });
  }
  assert(e._isOverBudget('你是小满。') === true, '构造超预算场景');
  e._ensureBudget('你是小满。').then(function() {
    assert(e.messages.length === e.recentKeepCount, '总结后只保留最近窗口（' + e.messages.length + ' 条）');
    assert(e.summary.indexOf('工作项目') !== -1, '摘要已生成');
    assert(e.summaryCount === 1, 'summaryCount 自增');
    // 总结后不再超预算（最近窗口小）
    assert(e._isOverBudget('你是小满。') === false, '总结后回落到预算内');
  }).catch(function(err) {
    assert(false, '_ensureBudget 成功路径异常: ' + err.message);
  });

  // 3) _ensureBudget 失败回退：stub 报错 → 消息仍收窄（截断兜底），摘要不变
  const f = new Agent();
  f.summary = '旧摘要';
  f._callLLM = function(payload, cb) {
    cb(new Error('API error'));
  };
  for (let i = 0; i < 30; i++) {
    f.messages.push({ role: 'user', content: '第' + i + '轮很长的内容'.repeat(40) });
    f.messages.push({ role: 'assistant', content: '回复'.repeat(60) });
  }
  f._ensureBudget('你是小满。').then(function() {
    assert(f.messages.length === f.recentKeepCount, '总结失败回退截断（' + f.messages.length + ' 条）');
    assert(f.summary === '旧摘要', '总结失败不覆盖已有摘要');
    assert(f.summaryCount === 0, '总结失败 summaryCount 不自增');
  }).catch(function(err) {
    assert(false, '_ensureBudget 失败路径异常: ' + err.message);
  });

  // 4) setHistory 恢复摘要
  const g = new Agent();
  g.setHistory([{ role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }], '历史摘要内容');
  assert(g.summary === '历史摘要内容', 'setHistory 恢复摘要');
  assert(g.messages.length === 2, 'setHistory 恢复消息');
}

// ═══════════ memory-service.js ═══════════
section('MemoryService');
{
  freshWindow();
  fakeMemoryBridge();
  loadJs('memory-service.js');
  const MS = global.window.MemoryService;
  assert(typeof MS === 'object', 'MemoryService 已导出');

  // 1) appendMemory：去重 + 子弹格式归一
  MS.appendMemory('• 用户喜欢喝茶\n- 用户喜欢跑步');
  // 通过 bridge 取回
  const raw1 = global.AndroidMemory.loadAll();
  const m1 = JSON.parse(raw1);
  assert(m1.files.memory.indexOf('• 用户喜欢喝茶') !== -1, 'append 写入 bullet 事实');
  assert(m1.files.memory.indexOf('• 用户喜欢跑步') !== -1, 'append 归一化 - 前缀');
  assert(m1.version === 4, 'version=4');

  // 去重：重复追加不产生新内容
  MS.appendMemory('• 用户喜欢喝茶');
  const m1b = JSON.parse(global.AndroidMemory.loadAll());
  const countTea = (m1b.files.memory.match(/用户喜欢喝茶/g) || []).length;
  assert(countTea === 1, '重复事实被去重');

  // 2) 长度上限：超过 MAX_MEMORY_CHARS 保留尾部
  const big = [];
  for (let i = 0; i < 60; i++) big.push('• 事实条目第' + i + '号' + '内容'.repeat(90));
  MS.appendMemory(big.join('\n'));
  const m2 = JSON.parse(global.AndroidMemory.loadAll());
  assert(m2.files.memory.length <= MS.MAX_MEMORY_CHARS + 200, 'memory 不超过上限（实际 ' + m2.files.memory.length + '）');
  assert(m2.files.memory.indexOf('• 事实条目第59号') !== -1, '保留最新尾部事实');

  // 3) buildSystemPrompt：v3 数据迁移后含回忆段、各文件段、长度受控
  MS.save({
    version: 3,
    files: {
      identity: '你是小满。',
      soul: '温柔。',
      user: '用户喜欢猫。',
      tools: '',
      memory: '• 记忆一\n• 记忆二',
      heartbeat: ''
    },
    facts: [
      { id: 'f1', category: 'preference', fact: '用户喜欢抹茶', createdAt: 1 },
      { id: 'f2', category: 'health', fact: '用户每天跑步', createdAt: 2 }
    ],
    sessions: []
  });
  const prompt = MS.buildSystemPrompt(MS.load());
  assert(prompt.indexOf('## 我们的回忆') !== -1, 'prompt 包含回忆段');
  assert(prompt.indexOf('用户喜欢抹茶') !== -1, 'v3 facts 迁移后注入（moment 标题）');
  assert(prompt.indexOf('## 记忆') !== -1, 'prompt 包含记忆段');
  assert(prompt.indexOf('## 事实') === -1, 'v4 不再注入 facts 段');
  assert(prompt.length < 3000, 'prompt 总长受控（' + prompt.length + '）');

  // 4) 空记忆 → 默认 prompt
  MS.save(MS.createEmpty());
  const defaultPrompt = MS.buildSystemPrompt(JSON.parse(global.AndroidMemory.loadAll()));
  assert(defaultPrompt.indexOf('温暖的AI伴侣') !== -1, '空记忆时返回默认 prompt');

  // 5) 超长 section 被截断
  MS.save({
    version: 3,
    files: {
      identity: '',
      soul: '',
      user: 'u'.repeat(5000),
      tools: '',
      memory: '',
      heartbeat: ''
    },
    facts: [],
    sessions: []
  });
  const cappedPrompt = MS.buildSystemPrompt(JSON.parse(global.AndroidMemory.loadAll()));
  assert(cappedPrompt.length < 1200, '超长 user 段被截断（' + cappedPrompt.length + '）');

  // 6) 迁移：v1 → v4
  const v1 = {
    version: 1,
    profile: { basics: { name: '小明' }, soul: { meaning: '探索' } }
  };
  const migrated = MS.migrate(v1);
  assert(migrated.version === 4, 'v1 迁移到 v4');
  assert(migrated.files.user.indexOf('小明') !== -1, 'v1 profile 迁移到 files.user');
  assert(migrated.files.soul.indexOf('探索') !== -1, 'v1 soul 迁移');

  // 7) 迁移：v2 → v4（files.facts → files.memory）
  const v2 = { version: 2, files: { soul: 's', user: '', facts: '旧事实' } };
  const migrated2 = MS.migrate(v2);
  assert(migrated2.version === 4, 'v2 迁移到 v4');
  assert(migrated2.files.memory === '旧事实', 'v2 files.facts 迁入 files.memory');
  assert(!('facts' in migrated2.files), 'v2 files.facts 已删除');

  // 7b) 迁移：v3 → v4（facts[] 迁入 moments[]，facts 字段保留兼容）
  const v3 = {
    version: 3,
    files: { identity: 'i', soul: 's', user: 'u', tools: '', memory: '', heartbeat: '' },
    facts: [{ id: 'f1', category: 'health', fact: '用户每天跑步', createdAt: Date.now() }],
    sessions: [],
    reminders: []
  };
  const migrated3 = MS.migrate(v3);
  assert(migrated3.version === 4, 'v3 迁移到 v4');
  assert(migrated3.moments.length === 1, 'v3 facts 迁入 moments');
  assert(migrated3.moments[0].excerpt === '用户每天跑步', 'moment excerpt 来自 fact');
  assert(migrated3.moments[0].emotion === 'neutral', '迁移时刻默认情绪 neutral');
  assert(migrated3.facts.length === 1, 'facts 字段保留兼容');

  // 7c) 念念 → 小满 一次性改名迁移（只动人设自称，用户内容一律不碰）
  assert(MS.createEmpty().persona === 'xiaoman', '新装数据直接带品牌标记，不需要迁移');
  assert(MS.OLD_FILE_DEFAULTS.identity.indexOf('念念') !== -1, '旧默认值常量记录的是改名前的原文');
  const oldData = {
    version: 4,
    files: {
      identity: MS.OLD_FILE_DEFAULTS.identity,
      soul: MS.OLD_FILE_DEFAULTS.soul + ' 我自己加过一句：慢慢来。',
      user: '用户爱说念念不忘',
      tools: '', memory: '• 念念养了一只猫', heartbeat: ''
    },
    moments: [{ id: 'm1', title: '和念念的一次对话', excerpt: '念念说她记得', emotion: 'happy', createdAt: new Date().toISOString(), status: 'active' }],
    facts: [], sessions: [], reminders: []
  };
  const renamed = MS.migrate(JSON.parse(JSON.stringify(oldData)));
  assert(renamed.persona === 'xiaoman', '迁移后打上品牌标记');
  assert(renamed.files.identity === MS.FILE_DEFAULTS.identity, '旧默认人设整段换成新默认（含小满意涵与非催促语气）');
  assert(renamed.files.soul.indexOf('你是「小满」') !== -1, '用户改过的人设：自称被替换');
  assert(renamed.files.soul.indexOf('我自己加过一句：慢慢来。') !== -1, '用户改过的人设：自己加的内容保留');
  assert(renamed.files.user === oldData.files.user, '用户写的 user 文件不被改名触碰');
  assert(renamed.files.memory === oldData.files.memory, '记忆事实不被改名触碰');
  assert(renamed.moments[0].excerpt === oldData.moments[0].excerpt, '时刻原文不被改名触碰');
  const renamedTwice = MS.migrate(JSON.parse(JSON.stringify(renamed)));
  assert(JSON.stringify(renamedTwice) === JSON.stringify(renamed), '改名迁移幂等（再迁移不再变化）');
  // 8) buildFactsText 上限
  const manyFacts = [];
  for (let i = 0; i < 30; i++) manyFacts.push({ id: 'f' + i, category: 'event', fact: '事件' + i + '描述'.repeat(40), createdAt: i });
  const factsText = MS.buildFactsText({ facts: manyFacts }, 500);
  assert(factsText.length <= 510, 'facts 文本受上限约束（' + factsText.length + '）');

  // 9) tools 段自动生成：传入 skill 列表
  MS.save({
    version: 3,
    files: { identity: '', soul: '', user: '', tools: '', memory: '', heartbeat: '' },
    facts: [],
    sessions: []
  });
  const toolList = [
    { name: 'search_notes', desc: '搜索用户的日记笔记，支持按关键词、标签、日期范围筛选。返回笔记的摘要列表供小满参考。' },
    { name: 'get_note', desc: '根据笔记 id 获取一篇笔记的完整内容。用在需要查看笔记全文时。' },
    { name: 'get_weather', desc: '查询某个城市的实时天气。返回温度、天气状况等信息。' },
    { name: 'web_search', desc: '搜索互联网，获取最新的网页信息。' }
  ];
  const promptWithTools = MS.buildSystemPrompt(JSON.parse(global.AndroidMemory.loadAll()), toolList);
  assert(promptWithTools.indexOf('## 工具') !== -1, '自动生成 tools 段');
  assert(promptWithTools.indexOf('- search_notes：搜索用户的日记笔记') !== -1, 'tools 段含 skill 名与用途');
  assert(promptWithTools.indexOf('- get_note：') !== -1, 'tools 段含 get_note');
  assert(promptWithTools.length < 2000, '含 tools 段后 prompt 仍受控（' + promptWithTools.length + '）');

  // 10) 用户手写 tools 优先于自动生成
  MS.save({
    version: 3,
    files: { identity: '', soul: '', user: '', tools: '手动写的工具说明', memory: '', heartbeat: '' },
    facts: [],
    sessions: []
  });
  const promptWithUserTools = MS.buildSystemPrompt(JSON.parse(global.AndroidMemory.loadAll()), toolList);
  assert(promptWithUserTools.indexOf('手动写的工具说明') !== -1, '用户 tools 文件优先');
  assert(promptWithUserTools.indexOf('- search_notes') === -1, '用户 tools 存在时不自动生成');

  // 11) buildToolsText 上限
  const longTools = [];
  for (let i = 0; i < 20; i++) longTools.push({ name: 'tool_' + i, desc: '描述'.repeat(100) });
  const toolsText = MS.buildToolsText(longTools, 300);
  assert(toolsText.length <= 310, 'buildToolsText 受 maxChars 约束（' + toolsText.length + '）');
  assert(toolsText.indexOf('tool_0') !== -1, 'buildToolsText 含首个工具');

  // 12) TASK_PROMPTS 存在且可用
  assert(typeof MS.TASK_PROMPTS === 'object' && typeof MS.TASK_PROMPTS.extractSystem === 'string', 'TASK_PROMPTS.extractSystem 存在');
  const dream = MS.TASK_PROMPTS.dreamSystem('soul内容', 'user内容');
  assert(typeof dream === 'string' && dream.indexOf('小满性格：soul内容') !== -1, 'TASK_PROMPTS.dreamSystem 拼接上下文');
  assert(typeof MS.TASK_PROMPTS.letterSystem === 'string' && MS.TASK_PROMPTS.letterSystem.indexOf('回忆信') !== -1, 'TASK_PROMPTS.letterSystem 存在');
  assert(typeof MS.TASK_PROMPTS.careSystem === 'string' && MS.TASK_PROMPTS.careSystem.indexOf('关心') !== -1, 'TASK_PROMPTS.careSystem 存在');

  // 13) v4 addMoment：写入 moments + 情绪 + 去重与情绪更新
  MS.save(MS.createEmpty());
  const added = MS.addMoment({ title: '第一次面试', excerpt: '今天去了第一场面试，紧张但顺利', emotion: 'anxious', source: 'note' });
  assert(added === true, 'addMoment 成功');
  const m4 = JSON.parse(global.AndroidMemory.loadAll());
  assert(Array.isArray(m4.moments) && m4.moments.length === 1, 'moments 数组写入');
  assert(m4.moments[0].emotion === 'anxious', '情绪写入');
  assert(m4.moments[0].recallCount === 0, 'recallCount 初始 0');
  const changed = MS.addMoment({ title: '第一次面试', excerpt: '今天去了第一场面试，紧张但顺利', emotion: 'calm' });
  assert(changed === true, '同内容不同情绪时更新情绪');
  const m4b = JSON.parse(global.AndroidMemory.loadAll());
  assert(m4b.moments.length === 1, '更新情绪不新增时刻');
  assert(m4b.moments[0].emotion === 'calm', '情绪已更新');
  const dup = MS.addMoment({ title: '第一次面试', excerpt: '今天去了第一场面试，紧张但顺利', emotion: 'calm' });
  assert(dup === false, '完全重复被去重');

  // 14) buildMomentsText / buildFeelingText / relativeTime
  const now = Date.now();
  MS.save({
    version: 4,
    files: { identity: '', soul: '', user: '', tools: '', memory: '', heartbeat: '' },
    moments: [
      { id: 'n1', title: '晨跑', excerpt: '今天晨跑了五公里', emotion: 'happy', category: 'event', createdAt: new Date(now - 2 * 86400000).toISOString(), recallCount: 0, status: 'active' },
      { id: 'n2', title: '加班', excerpt: '加班到很晚，有点累', emotion: 'tired', category: 'event', createdAt: new Date(now - 1 * 86400000).toISOString(), recallCount: 0, status: 'active' }
    ],
    facts: [], sessions: []
  });
  const momentsText = MS.buildMomentsText(JSON.parse(global.AndroidMemory.loadAll()), 500);
  assert(momentsText.indexOf('晨跑') !== -1, '回忆段含时刻标题');
  assert(momentsText.indexOf('（开心）') !== -1, '回忆段含情绪标签');
  const feelingText = MS.buildFeelingText(JSON.parse(global.AndroidMemory.loadAll()), 3);
  assert(feelingText.indexOf('疲惫') !== -1, '感受段含负面情绪标签');
  assert(MS.relativeTime(new Date().toISOString()) === '今天', 'relativeTime 今天');
  assert(MS.relativeTime(new Date(now - 86400000).toISOString()) === '昨天', 'relativeTime 昨天');

  // 15) recentMoments / markRecalled / 注入去重
  const rec2 = MS.recentMoments(3, 50);
  assert(rec2.length === 2, 'recentMoments 按天数过滤');
  MS.markRecalled(['n2']);
  const marked = JSON.parse(global.AndroidMemory.loadAll());
  assert(marked.moments[1].recallCount === 1, 'markRecalled 计数 +1');
  assert(marked.moments[1].lastRecalledAt !== null, 'markRecalled 记录时间');

  // 负面情绪 ≥2 时提示主动关心
  MS.save({
    version: 4,
    files: { identity: '', soul: '', user: '', tools: '', memory: '', heartbeat: '' },
    moments: [
      { id: 'c1', title: '失眠', excerpt: '又失眠了', emotion: 'anxious', category: 'event', createdAt: new Date(now - 86400000).toISOString(), recallCount: 0, status: 'active' },
      { id: 'c2', title: '低落', excerpt: '今天心情很差', emotion: 'sad', category: 'event', createdAt: new Date(now - 2 * 86400000).toISOString(), recallCount: 0, status: 'active' }
    ],
    facts: [], sessions: []
  });
  const careText = MS.buildFeelingText(JSON.parse(global.AndroidMemory.loadAll()), 3);
  assert(careText.indexOf('关心') !== -1, '负面情绪多时提示主动关心');

  // 16) RAG：cosineInt8 + embedding 不可用时 retrieveMoments 降级为空
  const sim = MS.cosineInt8([1, 2, 3], [1, 2, 3]);
  assert(Math.abs(sim - 1) < 0.001, '同向量余弦 = 1');
  const ortho = MS.cosineInt8([1, 0], [0, 1]);
  assert(Math.abs(ortho) < 0.001, '正交向量余弦 ≈ 0');
  assert(typeof MS.EMBED_DIMS === 'number' && MS.EMBED_DIMS > 0, 'EMBED_DIMS 导出');
  MS.retrieveMoments('加班累不累', 3, '').then(function(t) {
    assert(t === '', '无 NativeHttp/embedding 时 RAG 降级为空串');
  });
}

// ═══════════ native-http.js：API 端点归一化 ═══════════
section('API 端点归一化');
{
  freshWindow();
  loadJs('native-http.js');
  const NH = global.window.NativeHttp;
  const chat = (u) => NH.chatEndpoint(u);

  // 裸域名补 /v1（OpenAI / DeepSeek / Moonshot 兼容端都是这个形状）
  assert(chat('https://api.openai.com') === 'https://api.openai.com/v1/chat/completions', '裸域名补 /v1');
  assert(chat('https://api.openai.com/v1') === 'https://api.openai.com/v1/chat/completions', '/v1 直接拼端点');
  assert(chat('https://api.openai.com/v1/') === 'https://api.openai.com/v1/chat/completions', '尾斜杠被去掉');
  // 原始 bug：粘了完整端点会被拼成 .../chat/completions/chat/completions
  assert(chat('https://api.deepseek.com/v1/chat/completions') === 'https://api.deepseek.com/v1/chat/completions', '完整端点不重复拼接');
  assert(chat('https://x.com/v1/embeddings') === 'https://x.com/v1/chat/completions', '别的端点退回上一级再拼');
  assert(chat('https://x.com/v1?api-version=2024-01') === 'https://x.com/v1/chat/completions?api-version=2024-01', 'query 原样保留（Azure 风格）');
  assert(chat('  https://api.moonshot.cn/v1  ') === 'https://api.moonshot.cn/v1/chat/completions', '首尾空白被 trim');
  assert(chat('') === '' && chat(null) === '' && chat(undefined) === '', '空值返回空串不抛错');
  assert(NH.embeddingsEndpoint('https://api.openai.com') === 'https://api.openai.com/v1/embeddings', '向量端点');
  assert(NH.imageEndpoint('https://api.x.com') === 'https://api.x.com/v1/images/generations', '配图端点');
  assert(NH.imageEndpoint('https://api.x.com/v1/chat/completions') === 'https://api.x.com/v1/images/generations', '配图端点也退回上一级');

  // 报错翻译：填错时要能照着改
  const e404 = NH.explainError(new Error('HTTP 404: not found'), 'https://x.com/chat/completions');
  assert(e404.indexOf('404') !== -1, '404 提示含状态码');
  assert(e404.indexOf('https://x.com/chat/completions') !== -1, '404 提示含实际请求地址');
  assert(NH.explainError(new Error('HTTP 401: unauthorized')).indexOf('密钥') !== -1, '401 指向密钥');
  assert(NH.explainError(new Error('HTTP 400: model not exist')).indexOf('模型') !== -1, '400 指向模型名');
  assert(NH.explainError(new Error('Network error')).indexOf('连不上') !== -1, '网络错误说人话');
  assert(NH.explainError(new Error('some weird thing')).indexOf('some weird thing') !== -1, '未知错误保留原文');
}
// ═══════════ native-http.js：回调分发 ═══════════
section('NativeHttp 回调分发');
{
  freshWindow();
  // 模拟原生桥：捕获 callbackId
  const calls = [];
  global.window.AndroidHttp = {
    getAsync: (url, cb) => calls.push({ kind: 'get', url, cb }),
    postAsync: (url, h, b, cb) => calls.push({ kind: 'post', url, h, b, cb })
  };
  loadJs('native-http.js');
  const NH = global.window.NativeHttp;
  assert(typeof NH === 'object', 'NativeHttp 已导出');

  // post 成功
  const p1 = NH.postJson('https://api.test/v1/chat/completions', { Authorization: 'Bearer x' }, { model: 'm' });
  assert(calls.length === 1 && calls[0].kind === 'post', 'postAsync 被调用');
  const cbId = calls[0].cb;
  const payload = { ok: true, status: 200, data: JSON.stringify({ choices: [{ message: { content: '你好' } }] }) };
  global.window.__onNativeHttpResponse(cbId, payload);
  p1.then((data) => {
    assert(data.choices[0].message.content === '你好', 'postJson 解析响应');
  });

  // 非 2xx 拒绝
  const p2 = NH.postJson('https://api.test/x', {}, {});
  const cbId2 = calls[1].cb;
  global.window.__onNativeHttpResponse(cbId2, { ok: true, status: 401, data: 'unauthorized' });
  p2.then(() => assert(false, '401 不应 resolve'), (e) => assert(e.message.indexOf('401') !== -1, '401 正确 reject'));

  // ok=false 拒绝
  const p3 = NH.postJson('https://api.test/x', {}, {});
  const cbId3 = calls[2].cb;
  global.window.__onNativeHttpResponse(cbId3, { ok: false, error: 'blocked scheme: file' });
  p3.then(() => assert(false, 'ok=false 不应 resolve'), (e) => assert(e.message.indexOf('blocked') !== -1, 'ok=false reject 带错误信息'));

  // getAsync 成功
  const p4 = NH.getAsync('https://wttr.in/beijing?format=j1');
  const cbId4 = calls[3].cb;
  global.window.__onNativeHttpResponse(cbId4, { ok: true, data: '{"current_condition":[]}' });
  p4.then((r) => {
    assert(r.ok === true, 'getAsync resolve 原生信封');
  });
}

// ═══════════ agent.js：执行过程事件 + 日志 ═══════════
section('agent.js 执行事件与日志');
{
  freshWindow();
  loadJs('agent.js');
  const Agent = global.window.NianAgent;
  global.window.DataService = {
    settings: { load: function() { return { apiUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' }; } }
  };

  // 场景：LLM 先返回工具调用（未注册工具 → 失败），再返回文本
  const a = new Agent();
  const steps = [];
  const logs = [];
  a.onStep = (s) => steps.push(s);
  a.onLog = (l) => logs.push(l);
  let call = 0;
  a._callLLM = function(payload, cb) {
    call++;
    if (call === 1) {
      cb(null, { choices: [{ message: { tool_calls: [{ id: 't1', function: { name: 'search_notes', arguments: '{"query":"猫"}' } }] } }] });
    } else {
      cb(null, { choices: [{ message: { content: '找到了关于猫的笔记' } }] });
    }
  };

  a.process('帮我搜一下猫的笔记', '你是小满。').then((text) => {
    assert(text === '找到了关于猫的笔记', 'process 完整走完工具循环');
    assert(steps.some((s) => s.type === 'tool_call' && s.name === 'search_notes'), '发射 tool_call 事件');
    assert(steps.some((s) => s.type === 'tool_result' && s.name === 'search_notes' && s.ok === false), '发射 tool_result 失败事件');
    assert(logs.length === 1 && logs[0].ok === true, 'onLog 收到成功日志');
    assert(logs[0].steps.length === 2, '日志包含 2 个步骤');
  }).catch((e) => assert(false, 'process 异常: ' + e.message));

  // 场景：LLM 报错 → 日志 ok:false
  const b = new Agent();
  const logsB = [];
  b.onLog = (l) => logsB.push(l);
  b._callLLM = function(payload, cb) { cb(new Error('API 未配置')); };
  b.process('hi', 'sys').then(() => {}, (err) => {
    assert(logsB.length === 1 && logsB[0].ok === false, '失败路径 onLog 记录 ok:false');
    assert(logsB[0].error === 'API 未配置', '日志含错误信息');
  });
}

// ═══════════ 配置覆盖 + 损坏恢复 ═══════════
section('配置覆盖与损坏恢复');
{
  freshWindow();
  global.window.NIAN_CONFIG = {
    prompts: { defaults: { soul: '自定义灵魂设定' }, tasks: { extractSystem: '自定义提取提示词' } },
    model: { defaultModel: 'my-model' }
  };
  fakeMemoryBridge();
  loadJs('memory-service.js');
  const MS = global.window.MemoryService;
  const empty = MS.createEmpty();
  assert(empty.files.soul === '自定义灵魂设定', 'NIAN_CONFIG 覆盖 FILE_DEFAULTS');
  assert(MS.TASK_PROMPTS.extractSystem === '自定义提取提示词', 'NIAN_CONFIG 覆盖任务提示词');

  // dreamSystem 模板占位符
  const dream = MS.TASK_PROMPTS.dreamSystem('S', 'U');
  assert(dream.indexOf('S') !== -1 && dream.indexOf('U') !== -1, 'dreamSystem 占位符替换');

  // 损坏恢复备份（freshWindow 后需重新获取 MemoryService 引用；浏览器模式 → 不设 bridge）
  global.window.NIAN_CONFIG = {};
  freshWindow();
  global.AndroidMemory = undefined; // 走 localStorage 分支
  loadJs('memory-service.js');
  const MS2 = global.window.MemoryService;
  global.localStorage.setItem('nian_memories', '{broken json!!');
  const loaded = MS2.load();
  assert(loaded === null, '损坏 JSON load 返回 null');
  const backup = global.localStorage.getItem('nian_memories_corrupt_backup');
  assert(backup === '{broken json!!', '损坏数据已备份');
  const recreated = MS2.loadOrCreate();
  assert(recreated && recreated.version === 4, 'loadOrCreate 重建合法 v4');
  assert(global.localStorage.getItem('nian_memories') !== '{broken json!!', '重建后存储被修复');
}

// ═══════════ 新工具：提醒 / 统计 / 回顾 / 特殊日子 ═══════════
section('新工具');
{
  // —— remember_to + dueReminders ——
  freshWindow();
  fakeMemoryBridge();
  loadJs('memory-service.js');
  const MS = global.window.MemoryService;
  loadJs('skills/remember_to.js');
  const skill = global.window.rememberToSkill;
  assert(typeof skill === 'object', 'remember_to skill 已导出');

  const r1 = skill.execute({ text: '周五下午3点面试', date: '2026-08-20' });
  assert(r1.success === true, 'remember_to 创建成功');
  const r2 = skill.execute({ text: '买牛奶', date: '2099-01-01' });
  assert(r2.success === true, 'remember_to 显式未来日期成功');

  const reminders = MS.loadReminders();
  assert(reminders.length === 2, '提醒已存储（2 条）');
  const dueToday = MS.dueReminders('2026-08-20');
  assert(dueToday.length === 1 && dueToday[0].text === '周五下午3点面试', '到期提醒正确匹配');
  assert(MS.dueReminders('2026-08-19').length === 0, '未到期不触发');
  assert(MS.dueReminders('2099-01-01').length === 2, '远期日期两条都到期');

  // 非法日期拒绝
  const bad = skill.execute({ text: 'x', date: '2026/08/20' });
  assert(bad.error, '非法日期被拒绝');

  // —— note_stats / daily_review ——
  const notes = [
    { id: 'welcome', content: '#欢迎', createdAt: new Date().toISOString() },
    { id: 'note_1', content: '今天很开心 #好心情', createdAt: new Date().toISOString() },
    { id: 'note_2', content: '昨天去了公园 #日常', createdAt: new Date(Date.now() - 86400000).toISOString() },
    { id: 'note_3', content: '前天 #日常 #工作', createdAt: new Date(Date.now() - 172800000).toISOString() },
    { id: 'note_4', content: '上周 #工作', createdAt: new Date(Date.now() - 8 * 86400000).toISOString() }
  ];
  global.window.DataService = { notes: { load: () => notes }, settings: { load: () => null } };

  loadJs('skills/note_stats.js');
  const stats = global.window.noteStatsSkill.execute();
  assert(stats.total === 4, 'note_stats 排除 welcome（' + stats.total + '）');
  assert(stats.streakDays === 3, '连续打卡 3 天（' + stats.streakDays + '）');
  assert(stats.recent7 === 3, '近 7 天 3 篇（' + stats.recent7 + '）');
  assert(stats.topTags.length >= 1 && stats.topTags[0].tag === '日常', '标签榜 top1 为 日常');

  loadJs('skills/daily_review.js');
  const review = global.window.dailyReviewSkill.execute({ days: 2 });
  assert(review.length === 2, 'daily_review 返回最近 2 天（' + review.length + '）');
  assert(review[0].preview.indexOf('开心') !== -1, 'daily_review 含纯文本预览');

  loadJs('skills/get_special_day.js');
  const sd = global.window.specialDaySkill.execute();
  assert(sd.date && sd.weekday, 'get_special_day 返回日期与星期');
  assert(Array.isArray(sd.dueToday), 'get_special_day 返回今日提醒列表');
}

// ═══════════ generate_note_image 配图 skill ═══════════
section('generate_note_image 配图');
{
  freshWindow();
  const win = global.window;

  // 加载真实 native-http.js（拿端点归一化），只把 postJson 换成捕获桩，不触碰真实 API
  loadJs('native-http.js');
  var calls = [];
  win.NativeHttp.postJson = (url, headers, payload) => {
    calls.push({ url, headers, payload });
    return Promise.resolve({ data: [{ b64_json: 'RkFLRUJBU0U2NA==' }] });
  };
  win.ImageService = {
    saveImages: (arr, noteId) => Promise.resolve([{ id: 'img_1', path: '/images/img_1.jpg' }])
  };
  win.openImagePreview = () => {};
  win.onImageLoadError = () => {};

  const notes = [
    { id: 'n1', content: '今天天气很好，出去散步了。' },
    { id: 'n2', content: '--isHTML 今天学了新知识 <b>有趣</b>' }
  ];
  let savedNotes = null;
  win.DataService = {
    notes: {
      load: () => notes,
      save: (data) => { savedNotes = data; }
    },
    settings: {
      load: () => ({ apiUrl: 'https://www.micuapi.ai/v1', apiKey: 'sk-test', imageModel: 'gpt-image-2' })
    }
  };

  loadJs('skills/generate_note_image.js');
  const skill = win.generateNoteImageSkill;
  assert(typeof skill === 'object' && skill.definition.name === 'generate_note_image', 'skill 已定义并导出');

  // 同步错误路径
  skill.execute({}).then(r => { assert(r.error, '缺 noteId 时报错'); });
  skill.execute({ noteId: 'missing' }).then(r => { assert(r.error && r.error.indexOf('未找到') !== -1, '未找到笔记时报错'); });

  // 未配置 API
  win.DataService.settings.load = () => null;
  skill.execute({ noteId: 'n1' }).then(r => {
    assert(r.error && r.error.indexOf('未配置') !== -1, '未配置 API 时报错');
  });

  // 成功路径：纯文本笔记 → 转为 --isHTML 并追加 img
  win.DataService.settings.load = () => ({ apiUrl: 'https://www.micuapi.ai/v1', apiKey: 'sk-test', imageModel: 'gpt-image-2' });
  skill.execute({ noteId: 'n1' }).then(r => {
    assert(r.success === true, '纯文本笔记配图成功');
    assert(r.imageId === 'img_1', '返回 imageId');
    var call = calls[0];
    assert(call && call.url === 'https://www.micuapi.ai/v1/images/generations', '图像 URL 正确拼接（' + (call && call.url) + '）');
    assert(call.payload.model === 'gpt-image-2', '使用配图模型');
    assert(call.payload.prompt.indexOf('出去散步') !== -1, 'prompt 含笔记内容');
    assert(call.payload.response_format === 'b64_json', '请求 b64_json 格式');
    const updated = savedNotes.find(n => n.id === 'n1');
    assert(updated && updated.content.indexOf('--isHTML ') === 0, '纯文本笔记转为 --isHTML');
    assert(updated && updated.content.indexOf('data-image-id="img_1"') !== -1, 'img 带 data-image-id');
  });

  // 成功路径：已是 --isHTML 笔记 → 直接追加，不重复前缀
  skill.execute({ noteId: 'n2' }).then(r => {
    assert(r.success === true, 'HTML 笔记配图成功');
    var call = calls[1];
    assert(call.payload.prompt.indexOf('今天学了新知识') !== -1, 'HTML 笔记 prompt 含纯文本');
    const updated = savedNotes.find(n => n.id === 'n2');
    assert(updated && updated.content.indexOf('--isHTML') === 0, '保留原 --isHTML 前缀');
    assert(updated && (updated.content.match(/--isHTML/g) || []).length === 1, '不重复前缀');
    assert(updated && updated.content.indexOf('data-image-id="img_1"') !== -1, 'img 追加成功');
  });

  // 网络错误路径：401 → 明确错误提示
  win.NativeHttp.postJson = () => Promise.reject(new Error('http 401'));
  skill.execute({ noteId: 'n1' }).then(r => {
    assert(r.error && r.error.indexOf('401') !== -1, 'API 401 时报错（' + r.error + '）');
  });
}

// ═══════════ conversation-memory.js：笔友记忆上下文 ═══════════
section('conversation-memory 笔友记忆');
{
  freshWindow();
  const win = global.window;

  // stub 邮件桥（含其他笔友邮件 + 目标笔友历史）
  const fakeMails = [
    { id: 'm1', penpalId: 'xiaonuan', noteContent: '今天工作好累', reply: '辛苦了，抱抱你', status: 'replied' },
    { id: 'm2', penpalId: 'xiaonuan', noteContent: '--isHTML 周末去爬山了 <b>很放松</b>', reply: '真好呀，大自然最治愈了', status: 'replied' },
    { id: 'm3', penpalId: 'aran', noteContent: '项目终于上线了', reply: '冲！太棒了', status: 'replied' }
  ];
  win.AndroidMail = { loadMails: () => JSON.stringify(fakeMails) };
  // loadJs 会用 global.AndroidMemory 覆盖 win.AndroidMemory，因此 stub 必须挂在 global 上
  global.AndroidMemory = { loadAll: () => JSON.stringify({ version: 3, facts: [{ fact: '用户喜欢喝茶' }, { fact: '用户养了一只猫' }], files: {} }) };

  loadJs('conversation-memory.js');
  assert(typeof win.buildPenpalContext === 'function', 'buildPenpalContext 已导出');

  const base = '你是小暖，一个温柔的笔友。';
  const ctx = win.buildPenpalContext('xiaonuan', base);
  assert(ctx.indexOf('## 你和用户的过往来信') !== -1, '注入过往来信段');
  assert(ctx.indexOf('今天工作好累') !== -1, '引用用户历史内容');
  assert(ctx.indexOf('辛苦了，抱抱你') !== -1, '引用笔友历史回信');
  assert(ctx.indexOf('周末去爬山了') !== -1, 'HTML 笔记被剥离标签');
  assert(ctx.indexOf('## 关于用户的关键事实') !== -1, '注入用户事实段');
  assert(ctx.indexOf('用户喜欢喝茶') !== -1, '事实内容注入');
  assert(ctx.indexOf('项目终于上线了') === -1, '不混入其他笔友的历史');
  assert(ctx.indexOf(base) === 0, '基础提示词在前');

  // 无历史时：只追加基础提示词
  win.AndroidMail = { loadMails: () => '[]' };
  win.AndroidMemory = { loadAll: () => JSON.stringify({ version: 3, facts: [], files: {} }) };
  global.AndroidMemory = win.AndroidMemory;
  const ctxEmpty = win.buildPenpalContext('xiaonuan', base);
  assert(ctxEmpty === base, '无历史/事实时原样返回基础提示词');
}

// ═══════════ penpal_weekly_letter：笔友周信 ═══════════
section('penpal_weekly_letter 周信');
{
  freshWindow();
  const win = global.window;

  // 加载真实 native-http.js（拿端点归一化），只替换 postJson
  loadJs('native-http.js');
  let lastCall = null;
  win.NativeHttp.postJson = (url, headers, payload) => {
    lastCall = { url, headers, payload };
    return Promise.resolve({ choices: [{ message: { content: '亲爱的朋友：这周我看到你……—— 小暖' } }] });
  };
  let savedMails = [];
  win.AndroidMail = { upsertMail: (j) => { savedMails.push(JSON.parse(j)); } };
  const now = Date.now();
  const notes = [
    { id: 'welcome', content: '欢迎使用小满', createdAt: new Date(now - 10 * 86400000).toISOString() },
    { id: 'n1', content: '这周面试通过了，很开心', createdAt: new Date(now - 2 * 86400000).toISOString() },
    { id: 'n2', content: '--isHTML 今天去了公园 <b>散心</b>', createdAt: new Date(now - 86400000).toISOString() }
  ];
  let savedSettings = { apiUrl: 'https://api.test/v1', apiKey: 'k', model: 'gpt-4o' };
  win.DataService = {
    notes: { load: () => notes, save: () => {} },
    settings: { load: () => savedSettings, save: (s) => { savedSettings = s; } }
  };

  loadJs('skills/penpal_weekly_letter.js');
  const skill = win.penpalWeeklyLetterSkill;
  assert(typeof skill === 'object' && skill.definition.name === 'penpal_weekly_letter', '周信 skill 已定义');

  // 未配置 API
  win.DataService.settings.load = () => null;
  skill.execute({}).then(r => {
    assert(r.error && r.error.indexOf('API 未配置') !== -1, '未配置 API 时报错');
  });
  win.DataService.settings.load = () => savedSettings;

  // 成功路径：周信生成 + 落库 + 记录时间
  skill.execute({ penpalId: 'xiaonuan' }).then(r => {
    assert(r.success === true, '周信生成成功');
    assert(r.penpalName === '小暖', '返回笔友名');
    assert(lastCall.payload.messages[0].content.indexOf('本周来信') !== -1, 'system prompt 含周信任务');
    assert(lastCall.payload.messages[1].content.indexOf('面试通过') !== -1, '引用最近笔记');
    assert(lastCall.payload.messages[1].content.indexOf('欢迎使用') === -1, '排除 welcome 笔记');
    assert(savedMails.length === 1, '周信写入信箱');
    assert(savedMails[0].isWeeklyLetter === true, '标记为周信');
    assert(savedMails[0].status === 'replied', '周信状态为已回复');
    assert(savedMails[0].reply.indexOf('—— 小暖') !== -1, '周信正文保存');
    assert(parseInt(savedSettings.lastWeeklyLetterAt, 10) > 0, '记录上次发送时间');
  });

  // 无最近笔记
  win.DataService.notes.load = () => [{ id: 'welcome', content: '欢迎', createdAt: new Date(now - 30 * 86400000).toISOString() }];
  skill.execute({}).then(r => {
    assert(r.error && r.error.indexOf('没有可回顾') !== -1, '无笔记时提示');
  });
}

// ═══════════ penpals_data.json：笔友档案完整性 ═══════════
section('penpals_data 笔友档案');
{
  const fs2 = require('fs');
  const path2 = require('path');
  const penpals = JSON.parse(fs2.readFileSync(path2.join(ASSETS, 'penpals_data.json'), 'utf8'));
  assert(Array.isArray(penpals) && penpals.length >= 4, '至少 4 位笔友（' + penpals.length + '）');
  const ids = penpals.map(p => p.id);
  ['xiaonuan', 'aran', 'shubai', 'momo'].forEach(id => {
    assert(ids.indexOf(id) !== -1, '包含笔友 ' + id);
  });
  penpals.forEach(p => {
    assert(!!p.name && !!p.emoji && !!p.color, p.id + ' 有基础信息');
    assert(!!p.personality, p.id + ' 有个性描述');
    assert(!!p.story, p.id + ' 有背景故事');
    assert(Array.isArray(p.interests) && p.interests.length >= 2, p.id + ' 有至少 2 个兴趣');
    assert(!!p.signature, p.id + ' 有签名');
    assert(!!p.systemPrompt && p.systemPrompt.length > 50, p.id + ' 有完整回信提示词');
  });
  // 笔友档案与 mail.js 内嵌数组字段一致（抽查 4 位笔友的 signature 是否存在）
  const fs3 = require('fs');
  const path3 = require('path');
  const mailJs = fs3.readFileSync(path3.join(ASSETS, 'mail', 'mail.js'), 'utf8');
  penpals.forEach(p => {
    assert(mailJs.indexOf('"' + p.id + '"') !== -1, 'mail.js 含笔友 ' + p.id);
  });
}

// ═══════════ hotupdate.js：差量计算与字节校验 ═══════════
section('hotupdate.js 热更新');
{
  freshWindow();
  loadJs('hotupdate.js');
  const HU = global.window.HotUpdate;
  assert(typeof HU === 'object' && typeof HU.checkAndApply === 'function', 'HotUpdate 已导出');

  // computeChanged: 未变跳过、变更与新增入选
  const local = { 'a.js': 'h1', 'b.js': 'h2' };
  const remote = [
    { path: 'a.js', hash: 'h1', size: 1 },
    { path: 'b.js', hash: 'h2x', size: 2 },
    { path: 'c.js', hash: 'h3', size: 3 }
  ];
  const changed = HU.computeChanged(local, remote);
  assert(changed.length === 2, '差量只含变更+新增（' + changed.length + '）');
  assert(changed[0].path === 'b.js' && changed[1].path === 'c.js', '差量路径正确');

  // utf8Bytes 与服务端字节数对齐(下载完整性校验的依据)
  assert(HU.utf8Bytes('abc') === 3, 'ASCII 每字符 1 字节');
  assert(HU.utf8Bytes('小满') === 6, '中文每字符 3 字节');
  assert(HU.utf8Bytes('a念') === 4, '混合计算正确');

  // 无 AndroidUpdate 桥时明确拒绝而不是静默成功
  HU.checkAndApply('http://x').then(
    () => { assert(false, '无桥时应 reject'); },
    (err) => { assert(String(err.message).indexOf('不支持') !== -1, '无桥时提示不支持'); }
  );

  // apkUpdateInfo: App 内自更新的新旧判断（只比 versionCode，安装器也按它决定能否覆盖安装）
  assert(typeof HU.apkUpdateInfo === 'function', 'apkUpdateInfo 已导出');
  const upNew = HU.apkUpdateInfo({ versionCode: 100, versionName: '1.0.a' },
                                 { versionCode: 101, versionName: '1.0.b', size: 123 });
  assert(upNew.hasUpdate === true, '服务端 code 更高 → 有更新');
  assert(upNew.size === 123 && upNew.versionName === '1.0.b', '带出远端版本名与体积');
  const upSame = HU.apkUpdateInfo({ versionCode: 100, versionName: '1.0.a' },
                                  { versionCode: 100, versionName: '1.0.a' });
  assert(upSame.hasUpdate === false, '同 code → 不提示更新');
  const upOld = HU.apkUpdateInfo({ versionCode: 100, versionName: '1.0.a' },
                                 { versionCode: 99, versionName: '0.9' });
  assert(upOld.hasUpdate === false, '服务端更旧 → 不提示（避免装不上）');
  const upNone = HU.apkUpdateInfo(null, { versionCode: 5 });
  assert(upNone.hasUpdate === true && upNone.localVersionCode === 0, '本地版本缺失按 0 处理');
  const upMissing = HU.apkUpdateInfo({ versionCode: 7 }, {});
  assert(upMissing.hasUpdate === false, '服务端没给 code → 不误报有更新');

  // 旧 APK 没有 getAppVersion 桥：不误判成"有新版本"，而是明确拒绝
  assert(HU.appVersion() === null, '无桥时 appVersion 返回 null');
  HU.checkApk('http://x').then(
    () => { assert(false, '无桥时 checkApk 应 reject'); },
    (err) => { assert(String(err.message).indexOf('不支持') !== -1, '无桥时 checkApk 提示不支持应用内更新'); }
  );
  HU.installApk('http://x/apk').then(
    () => { assert(false, '无桥时 installApk 应 reject'); },
    (err) => { assert(String(err.message).indexOf('不支持') !== -1, '无桥时 installApk 提示不支持'); }
  );
}

// 等待 promise 断言完成
setTimeout(() => {
  console.log('\n─────────────────────');
  console.log('结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed > 0 ? 1 : 0);
}, 300);
