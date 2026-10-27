// ─── xiaoman Win 后台管理系统 ───
// 本地零依赖 Node 服务：管理工具开关 / 默认提示词 / 模型默认值 / 遥测日志查看。
// 用法: node admin/server.js [port]   (默认 8787) → 打开 http://127.0.0.1:8787
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2], 10) || 8787;
const ADMIN_DIR = __dirname;
const ASSETS_DIR = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const CONFIG_FILE = path.join(ADMIN_DIR, 'config.json');
const LOG_FILE = path.join(ADMIN_DIR, 'logs.jsonl');
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const TARGET_FILE = path.join(ASSETS_DIR, 'app-config.js');

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function defaultConfig() {
  return {
    version: 1,
    tools: {
      enabled: null,
      catalog: [
        { name: 'search_notes', desc: '搜索日记笔记（关键词/标签/日期）', category: '记忆' },
        { name: 'get_note', desc: '按 id 获取笔记全文', category: '记忆' },
        { name: 'note_stats', desc: '日记统计（总数/连续天数/标签榜）', category: '记忆' },
        { name: 'daily_review', desc: '回顾最近几天的日记', category: '记忆' },
        { name: 'create_note', desc: '帮用户创建新笔记', category: '写作' },
        { name: 'update_archive', desc: '把用户个人信息写入记忆档案', category: '记忆' },
        { name: 'remember_to', desc: '记住待办并在指定日期提醒', category: '关怀' },
        { name: 'get_special_day', desc: '查询节日/节气/今日提醒', category: '关怀' },
        { name: 'send_proactive_mail', desc: '小满主动给用户发信', category: '关怀' },
        { name: 'web_search', desc: '联网搜索（DuckDuckGo）', category: '网络' },
        { name: 'get_weather', desc: '实时天气（wttr.in）', category: '网络' },
        { name: 'run_insight', desc: '深度洞察分析（16 种模式）', category: '洞察' },
        { name: 'list_insight_modes', desc: '列出可用洞察模式', category: '洞察' },
        { name: 'generate_note_image', desc: '根据随记内容生成配图', category: '创作' },
        { name: 'penpal_weekly_letter', desc: '笔友每周来信（回顾最近一周笔记）', category: '关怀' }
      ]
    },
    prompts: {
      defaults: {
        identity: '',
        soul: '',
        user: '',
        tools: '',
        memory: '',
        heartbeat: ''
      },
      tasks: {
        extractSystem: '',
        dreamSystem: ''
      },
      caps: {
        identity: 300, soul: 500, user: 500, tools: 400, memory: 800, heartbeat: 150, facts: 500
      },
      insight: [],
      penpals: {
        xiaonuan: '',
        aran: '',
        shubai: '',
        momo: ''
      }
    },
    model: {
      defaultModel: 'gpt-4o'
    },
    telemetry: {
      url: 'http://127.0.0.1:8787/api/logs'
    }
  };
}

function logLine(line) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(line) + '\n', 'utf8');
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    }
  } catch (e) {}
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// 从客户端 insight_prompts.js 提取内置洞察模式列表（供后台"加载内置"编辑）
function extractInsightDefaults() {
  try {
    const src = fs.readFileSync(path.join(ASSETS_DIR, 'insight', 'insight_prompts.js'), 'utf8');
    const m = src.match(/INSIGHT_PROMPTS\s*=\s*(\[[\s\S]*?\])\s*;?/);
    if (!m) return [];
    const arr = JSON.parse(m[1]);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// 生成客户端 app-config.js（只导出非空/有效配置，保持最小体积）
function buildAppConfig(cfg) {
  const out = {
    version: 1,
    tools: { enabled: Array.isArray(cfg.tools.enabled) ? cfg.tools.enabled : null }
  };
  const p = cfg.prompts || {};
  const pd = {};
  Object.keys(p.defaults || {}).forEach((k) => {
    if (typeof p.defaults[k] === 'string' && p.defaults[k].trim()) pd[k] = p.defaults[k];
  });
  const pt = {};
  Object.keys(p.tasks || {}).forEach((k) => {
    if (typeof p.tasks[k] === 'string' && p.tasks[k].trim()) pt[k] = p.tasks[k];
  });
  const pc = {};
  Object.keys(p.caps || {}).forEach((k) => {
    if (typeof p.caps[k] === 'number' && p.caps[k] > 0) pc[k] = p.caps[k];
  });
  const pp = {};
  Object.keys(p.penpals || {}).forEach((k) => {
    if (typeof p.penpals[k] === 'string' && p.penpals[k].trim()) pp[k] = p.penpals[k];
  });
  const prompts = {};
  if (Object.keys(pd).length) prompts.defaults = pd;
  if (Object.keys(pt).length) prompts.tasks = pt;
  if (Object.keys(pc).length) prompts.caps = pc;
  if (Array.isArray(p.insight) && p.insight.length) prompts.insight = p.insight;
  if (Object.keys(pp).length) prompts.penpals = pp;
  if (Object.keys(prompts).length) out.prompts = prompts;
  if (cfg.model && cfg.model.defaultModel) out.model = { defaultModel: cfg.model.defaultModel };
  if (cfg.model && cfg.model.imageModel) {
    if (!out.model) out.model = {};
    out.model.imageModel = cfg.model.imageModel;
  }
  if (cfg.model && cfg.model.embeddingModel) {
    if (!out.model) out.model = {};
    out.model.embeddingModel = cfg.model.embeddingModel;
  }
  if (cfg.telemetry && cfg.telemetry.url) out.telemetry = { url: cfg.telemetry.url };
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0];

  // 管理界面
  if (url === '/' || url === '/index.html') {
    const html = fs.readFileSync(path.join(ADMIN_DIR, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // API
  if (req.method === 'GET' && url === '/api/config') {
    sendJson(res, 200, readJson(CONFIG_FILE, defaultConfig()));
    return;
  }
  if (req.method === 'POST' && url === '/api/config') {
    try {
      const body = await readBody(req);
      const cfg = JSON.parse(body);
      // 与内置默认合并，保证结构完整
      const merged = defaultConfig();
      merged.version = 1;
      merged.tools = Object.assign({}, merged.tools, cfg.tools || {});
      merged.prompts = Object.assign({}, merged.prompts, cfg.prompts || {});
      merged.model = Object.assign({}, merged.model, cfg.model || {});
      merged.telemetry = Object.assign({}, merged.telemetry, cfg.telemetry || {});
      writeJson(CONFIG_FILE, merged);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { error: '配置 JSON 解析失败: ' + e.message });
    }
    return;
  }
  if (req.method === 'POST' && url === '/api/export') {
    try {
      const cfg = readJson(CONFIG_FILE, defaultConfig());
      const appCfg = buildAppConfig(cfg);
      const js = '// 运行时配置（由 Win 后台导出生成，勿手改；如需恢复默认在后台重新导出）\nwindow.NIAN_CONFIG = ' +
        JSON.stringify(appCfg, null, 2) + ';\n';
      fs.writeFileSync(TARGET_FILE, js, 'utf8');
      sendJson(res, 200, { ok: true, target: TARGET_FILE, size: js.length });
    } catch (e) {
      sendJson(res, 500, { error: '导出失败: ' + e.message });
    }
    return;
  }
  if (req.method === 'GET' && url === '/api/insight-defaults') {
    sendJson(res, 200, { insight: extractInsightDefaults() });
    return;
  }
  if (req.method === 'POST' && url === '/api/logs') {
    try {
      const body = await readBody(req);
      const entries = JSON.parse(body);
      if (Array.isArray(entries)) {
        entries.forEach((e) => logLine(e));
      }
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { error: '日志格式错误' });
    }
    return;
  }
  if (req.method === 'GET' && url === '/api/logs') {
    try {
      const limit = Math.min(parseInt((req.url || '').split('?')[1] ? new URLSearchParams((req.url || '').split('?')[1]).get('limit') || '100' : '100', 10) || 100, 500);
      if (!fs.existsSync(LOG_FILE)) {
        sendJson(res, 200, { logs: [] });
        return;
      }
      const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
      const logs = lines.slice(-limit).map((l) => {
        try { return JSON.parse(l); } catch (e) { return { raw: l }; }
      });
      sendJson(res, 200, { logs });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }
  if (req.method === 'GET' && url === '/api/health') {
    sendJson(res, 200, { ok: true, port: PORT });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log('小满 Win 后台已启动: http://127.0.0.1:' + PORT);
  console.log('配置: ' + CONFIG_FILE);
  console.log('日志: ' + LOG_FILE);
  console.log('导出目标: ' + TARGET_FILE);
});
