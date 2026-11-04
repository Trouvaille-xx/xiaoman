// ─── 模型设置：服务商 / 模型 / 四类模型管理 ───
// 数据保存在 settings.providers + settings.activeModels，并同步回旧的
// apiUrl/apiKey/model、embedding*/rerank*/image* 字段，保持 Agent/RAG 兼容。
(function() {
  var PRESETS = [
    { key: 'custom', name: '自定义服务商', short: '自', color: '#2bbbad', url: '', format: 'openai' },
    { key: 'deepseek', name: 'DeepSeek', short: 'D', color: '#4d6bfe', url: 'https://api.deepseek.com/v1', format: 'openai' },
    { key: 'zhipu', name: 'Zhipu', short: 'Z', color: '#1a73e8', url: 'https://open.bigmodel.cn/api/paas/v4', format: 'openai' },
    { key: 'silicon', name: 'Silicon', short: 'S', color: '#6a5acd', url: 'https://api.siliconflow.cn/v1', format: 'openai' },
    { key: 'openai', name: 'OpenAI', short: 'O', color: '#10a37f', url: 'https://api.openai.com/v1', format: 'openai' },
    { key: 'anthropic', name: 'Anthropic', short: 'A', color: '#d97757', url: 'https://api.anthropic.com/v1', format: 'anthropic' },
    { key: 'opencode', name: 'OpenCode Go', short: 'OC', color: '#5b5bd6', url: 'https://opencode.ai/zen/go/v1', format: 'openai' },
    { key: 'moonshot', name: 'Moonshot', short: 'K', color: '#1f1f1f', url: 'https://api.moonshot.cn/v1', format: 'openai' },
    { key: 'doubao', name: 'Doubao', short: '豆', color: '#3370ff', url: 'https://ark.cn-beijing.volces.com/api/v3', format: 'openai' },
    { key: 'minimax', name: 'MiniMax', short: 'M', color: '#ff6b35', url: 'https://api.minimax.chat/v1', format: 'openai' },
    { key: 'qwen', name: 'Qwen AI Platform', short: 'Q', color: '#6b5cff', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', format: 'openai' },
    { key: 'gemini', name: 'Gemini', short: 'G', color: '#4285f4', url: 'https://generativelanguage.googleapis.com/v1beta', format: 'gemini' }
  ];
  var KINDS = [
    { id: 'text', label: '文本模型' },
    { id: 'embedding', label: '向量模型' },
    { id: 'rerank', label: '重排模型' },
    { id: 'image', label: '生图模型' }
  ];
  var state = {
    kind: 'text',
    view: 'list',
    providerId: null,
    providerTab: 'config',
    isNew: false,
    draft: null,
    syncList: [],
    syncSearch: ''
  };

  function settings() {
    try { return window.DataService.settings.load() || {}; } catch (e) { return {}; }
  }
  function saveSettings(s) {
    try { window.DataService.settings.save(s); return true; } catch (e) { return false; }
  }
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
    else if (typeof alert === 'function') alert(msg);
  }
  function baseUrl(u) {
    var v = String(u || '').trim().replace(/\/+$/, '');
    v = v.replace(/\/(chat\/completions|completions|embeddings|rerank|models|images\/generations)$/i, '');
    try {
      if (window.NativeHttp && window.NativeHttp.apiBase) return window.NativeHttp.apiBase(v);
    } catch (e) {}
    return v;
  }
  function endpoint(base, path) {
    var b = baseUrl(base);
    return b ? b + path : '';
  }
  function preset(key) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === key) return PRESETS[i];
    return PRESETS[0];
  }
  function presetForProvider(p) {
    if (p.preset) return preset(p.preset);
    var host = '';
    try { host = new URL(p.apiUrl).hostname.toLowerCase(); } catch (e) {}
    if (/silicon/.test(host)) return preset('silicon');
    if (/deepseek/.test(host)) return preset('deepseek');
    if (/opencode/.test(host)) return preset('opencode');
    if (/openai/.test(host)) return preset('openai');
    if (/anthropic/.test(host)) return preset('anthropic');
    if (/moonshot/.test(host)) return preset('moonshot');
    if (/dashscope|qwen/.test(host)) return preset('qwen');
    return PRESETS[0];
  }
  function inferKind(id) {
    var s = String(id || '').toLowerCase();
    if (/rerank/.test(s)) return 'rerank';
    if (/embed|bge|m3e|gte|jina|text-embedding/.test(s)) return 'embedding';
    if (/image|flux|stable-diffusion|dall|qwen-image|wanx|kling|seedream/.test(s)) return 'image';
    return 'text';
  }
  function kindLabel(k) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].id === k) return KINDS[i].label;
    return '文本模型';
  }
  function activeFor(s, kind) {
    return (s.activeModels && s.activeModels[kind]) || null;
  }
  function findProvider(providers, id) {
    for (var i = 0; i < providers.length; i++) if (providers[i].id === id) return providers[i];
    return null;
  }
  function findModel(provider, modelId) {
    if (!provider) return null;
    for (var i = 0; i < (provider.models || []).length; i++) {
      if (provider.models[i].id === modelId) return provider.models[i];
    }
    return null;
  }

  function migrateLegacy(s) {
    var providers = [];
    function add(apiUrl, apiKey, format, name, modelId, kind) {
      if (!apiUrl || !modelId) return;
      var base = baseUrl(apiUrl);
      var key = String(apiKey || '');
      var p = null;
      for (var i = 0; i < providers.length; i++) {
        if (providers[i].apiUrl === base && String(providers[i].apiKey || '') === key) { p = providers[i]; break; }
      }
      if (!p) {
        var pr = presetForProvider({ apiUrl: base });
        p = {
          id: uid('prov'), name: name || pr.name, preset: pr.key,
          apiUrl: base, apiKey: key, format: format || 'openai', models: []
        };
        providers.push(p);
      }
      if (!findModel(p, modelId)) {
        p.models.push({ id: modelId, name: modelId, kind: kind, enabled: true });
      }
    }
    add(s.apiUrl, s.apiKey, s.format, '', s.model, 'text');
    add(s.embeddingApiUrl, s.embeddingApiKey, 'openai', '', s.embeddingModel, 'embedding');
    add(s.rerankApiUrl, s.rerankApiKey || s.embeddingApiKey, 'openai', '', s.rerankModel, 'rerank');
    add(s.imageApiUrl || s.apiUrl, s.imageApiKey || s.apiKey, 'openai', '', s.imageModel, 'image');
    s.providers = providers;
    s.activeModels = s.activeModels || {};
    for (var k = 0; k < KINDS.length; k++) {
      var kind = KINDS[k].id;
      if (s.activeModels[kind]) continue;
      for (var p = 0; p < providers.length; p++) {
        for (var m = 0; m < providers[p].models.length; m++) {
          var model = providers[p].models[m];
          if (model.kind === kind && model.enabled !== false) {
            s.activeModels[kind] = { providerId: providers[p].id, modelId: model.id };
            break;
          }
        }
        if (s.activeModels[kind]) break;
      }
    }
    // 迁移后立即落盘，保证 provider id 稳定（否则每次打开都会生成新 id）
    saveSettings(s);
    return providers;
  }

  function ensureProviders(s) {
    if (Array.isArray(s.providers) && s.providers.length) {
      for (var i = 0; i < s.providers.length; i++) {
        var p = s.providers[i];
        p.apiUrl = baseUrl(p.apiUrl);
        p.format = p.format || 'openai';
        p.name = p.name || '服务商';
        p.models = Array.isArray(p.models) ? p.models : [];
        for (var j = 0; j < p.models.length; j++) {
          var m = p.models[j];
          m.kind = m.kind || inferKind(m.id);
          m.name = m.name || m.id;
          m.enabled = m.enabled !== false;
        }
      }
      s.activeModels = s.activeModels || {};
      // 合并同 API 地址 + 同 Key 的重复服务商（例如旧数据里 embedding/rerank 被拆成两个 Silicon）
      var merged = [];
      for (var a = 0; a < s.providers.length; a++) {
        var cur = s.providers[a];
        var same = null;
        for (var b = 0; b < merged.length; b++) {
          if (merged[b].apiUrl === cur.apiUrl && String(merged[b].apiKey || '') === String(cur.apiKey || '') &&
              String(merged[b].format || 'openai') === String(cur.format || 'openai')) { same = merged[b]; break; }
        }
        if (!same) { merged.push(cur); continue; }
        for (var c = 0; c < (cur.models || []).length; c++) {
          if (!findModel(same, cur.models[c].id)) same.models.push(cur.models[c]);
        }
        for (var k = 0; k < KINDS.length; k++) {
          var activeRef = s.activeModels[KINDS[k].id];
          if (activeRef && activeRef.providerId === cur.id) activeRef.providerId = same.id;
        }
      }
      if (merged.length !== s.providers.length) {
        s.providers = merged;
        saveSettings(s);
      }
      return s.providers;
    }
    return migrateLegacy(s);
  }

  function deriveLegacy(s, providers) {
    var active = s.activeModels || {};
    function pick(kind) {
      var a = active[kind];
      if (!a) return null;
      var p = findProvider(providers, a.providerId);
      var m = findModel(p, a.modelId);
      if (!p || !m) return null;
      return { p: p, m: m };
    }
    var t = pick('text');
    if (t) {
      s.apiUrl = t.p.apiUrl;
      s.apiKey = t.p.apiKey;
      s.model = t.m.id;
      s.format = t.p.format || 'openai';
    }
    var e = pick('embedding');
    if (e) {
      s.embeddingApiUrl = endpoint(e.p.apiUrl, '/embeddings');
      s.embeddingApiKey = e.p.apiKey;
      s.embeddingModel = e.m.id;
    } else {
      delete s.embeddingApiUrl; delete s.embeddingApiKey; delete s.embeddingModel;
    }
    var r = pick('rerank');
    if (r) {
      s.rerankApiUrl = endpoint(r.p.apiUrl, '/rerank');
      s.rerankApiKey = r.p.apiKey;
      s.rerankModel = r.m.id;
    } else {
      delete s.rerankApiUrl; delete s.rerankApiKey; delete s.rerankModel;
    }
    var im = pick('image');
    if (im) {
      s.imageModel = im.m.id;
      s.imageApiUrl = im.p.apiUrl;
      s.imageApiKey = im.p.apiKey;
    } else {
      delete s.imageModel; delete s.imageApiUrl; delete s.imageApiKey;
    }
  }

  function persist(s, providers) {
    s.providers = providers;
    deriveLegacy(s, providers);
    saveSettings(s);
    if (window.nianAgent && window.nianAgent.reloadConfig) {
      try { window.nianAgent.reloadConfig(); } catch (e) {}
    }
  }

  function setHeader(title, back, showAdd) {
    var titleEl = document.getElementById('settingsTitle');
    var backEl = document.getElementById('settingsBackBtn');
    var actions = document.getElementById('settingsHeaderActions');
    if (titleEl) titleEl.textContent = title;
    if (backEl) backEl.onclick = back || (window.backToSettingsMenu || function() {});
    if (actions) {
      actions.innerHTML = showAdd
        ? '<div class="settings-add-btn" onclick="ModelSettings.openAddProvider()" title="添加服务商">＋</div>'
        : '';
    }
  }

  function renderRoot() {
    var root = document.getElementById('modelSettingsRoot');
    if (!root) return;
    if (state.view === 'addProvider') renderAddProvider(root);
    else if (state.view === 'provider') renderProvider(root);
    else if (state.view === 'sync') renderSync(root);
    else renderList(root);
  }

  function renderList(root) {
    state.view = 'list';
    setHeader('模型设置', window.backToSettingsMenu, true);
    var s = settings();
    var providers = ensureProviders(s);
    var active = s.activeModels || {};
    var counts = { text: 0, embedding: 0, rerank: 0, image: 0 };
    providers.forEach(function(p) {
      (p.models || []).forEach(function(m) { if (counts[m.kind] != null) counts[m.kind]++; });
    });
    var html = '<div class="model-kind-tabs">';
    KINDS.forEach(function(k) {
      html += '<div class="model-kind-tab' + (state.kind === k.id ? ' active' : '') + '" onclick="ModelSettings.setKind(\'' + k.id + '\')">' + k.label + (counts[k.id] ? ' ' + counts[k.id] : '') + '</div>';
    });
    html += '</div>';

    var rows = [];
    providers.forEach(function(p) {
      (p.models || []).forEach(function(m) {
        if (m.kind === state.kind) rows.push({ p: p, m: m });
      });
    });
    html += '<div class="model-list">';
    if (!rows.length) {
      html += '<div class="model-empty">还没有' + kindLabel(state.kind) + '<br>点击右上角 ＋ 添加服务商</div>';
    } else {
      rows.forEach(function(x) {
        var isActive = active[x.m.kind] && active[x.m.kind].providerId === x.p.id && active[x.m.kind].modelId === x.m.id;
        var mid = encodeURIComponent(x.m.id);
        html += '<div class="model-row' + (isActive ? ' active' : '') + '" onclick="ModelSettings.setActive(\'' + esc(x.p.id) + '\',\'' + mid + '\')">' +
          '<div class="model-row-main">' +
          '<div class="model-row-name">' + esc(x.m.name || x.m.id) + '</div>' +
          '<div class="model-row-sub">' + esc(x.p.name) + ' · ' + esc(x.m.id) + '</div>' +
          '</div>' +
          (isActive ? '<span class="model-active-badge">当前</span>' : '') +
          '<label class="model-switch" onclick="event.stopPropagation()">' +
          '<input type="checkbox" ' + (x.m.enabled !== false ? 'checked' : '') + ' onchange="ModelSettings.toggleModel(\'' + esc(x.p.id) + '\',\'' + mid + '\',this.checked)">' +
          '<span></span></label>' +
          '</div>';
      });
    }
    html += '</div>';

    html += '<div class="model-section-title">已添加服务商</div><div class="provider-list">';
    if (!providers.length) {
      html += '<div class="model-empty" style="padding:16px;">暂无服务商</div>';
    } else {
      providers.forEach(function(p) {
        var pr = presetForProvider(p);
        html += '<div class="provider-row" onclick="ModelSettings.openProvider(\'' + esc(p.id) + '\')">' +
          '<div class="provider-avatar" style="background:' + pr.color + '">' + esc(pr.short) + '</div>' +
          '<div class="provider-row-main"><div class="provider-row-name">' + esc(p.name) + '</div>' +
          '<div class="provider-row-sub">' + (p.models || []).length + ' 个模型 · ' + esc(p.apiUrl || '未设置地址') + '</div></div>' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted)"><polyline points="9 18 15 12 9 6"/></svg>' +
          '</div>';
      });
    }
    html += '</div>';

    // 高级：上下文预算 + RAG 索引
    html += '<div class="model-section-title">高级</div><div class="model-advanced">' +
      '<label>上下文预算（tokens）</label>' +
      '<input id="mgrContextBudget" type="number" min="1000" max="1000000" step="1000" value="' + esc(s.contextBudgetTokens || 128000) + '">' +
      '<div class="model-form-actions"><button class="model-mini-btn primary" onclick="ModelSettings.saveAdvanced()">保存预算</button></div>' +
      '<div id="mgrRagStatus" style="font-size:12px;color:var(--text-muted);margin-top:10px;line-height:1.6;"></div>' +
      '<div class="model-form-actions"><button class="model-mini-btn" onclick="ModelSettings.rebuildRag()">重建笔记向量索引</button></div>' +
      '</div>' +
      '<div class="model-section-title">联网搜索</div><div class="model-advanced">' +
      '<label>DeepSeek 搜索 API 地址</label>' +
      '<input id="mgrSearchUrl" value="' + esc(s.searchApiUrl || 'https://api.deepseek.com/v1/tools/search') + '" placeholder="https://api.deepseek.com/v1/tools/search">' +
      '<label style="margin-top:10px;">DeepSeek Search API Key</label>' +
      '<input id="mgrSearchKey" type="password" value="' + esc(s.searchApiKey || '') + '" placeholder="留空则自动使用已添加的 DeepSeek 服务商 Key">' +
      '<label style="margin-top:10px;">返回条数（1-10）</label>' +
      '<input id="mgrSearchCount" type="number" min="1" max="10" value="' + esc(s.searchCount || 5) + '">' +
      '<div class="model-form-actions"><button class="model-mini-btn primary" onclick="ModelSettings.saveSearch()">保存搜索配置</button>' +
      '<button class="model-mini-btn" onclick="ModelSettings.testSearch()">测试搜索</button></div>' +
      '<div id="mgrSearchStatus" style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.6;"></div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.6;">DeepSeek 官方 API：POST /v1/tools/search，Bearer 鉴权。</div>' +
      '</div>';

    root.innerHTML = html;
    updateRagStatus();
  }

  function renderAddProvider(root) {
    state.view = 'addProvider';
    setHeader('添加服务商', ModelSettings.backToList, false);
    var html = '<div class="model-section-title" style="margin-top:0;">推荐</div><div class="provider-list">';
    PRESETS.forEach(function(p) {
      html += '<div class="provider-row" onclick="ModelSettings.createProvider(\'' + p.key + '\')">' +
        '<div class="provider-avatar" style="background:' + p.color + '">' + esc(p.short) + '</div>' +
        '<div class="provider-row-main"><div class="provider-row-name">' + esc(p.name) + '</div>' +
        '<div class="provider-row-sub">' + esc(p.url || '手动填写 API 地址') + '</div></div>' +
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted)"><polyline points="9 18 15 12 9 6"/></svg>' +
        '</div>';
    });
    html += '</div>';
    root.innerHTML = html;
  }

  function currentProvider() {
    if (state.isNew) return state.draft;
    var s = settings();
    var providers = ensureProviders(s);
    return findProvider(providers, state.providerId);
  }

  function renderProvider(root) {
    state.view = 'provider';
    var p = currentProvider();
    if (!p) { state.view = 'list'; renderList(root); return; }
    setHeader(p.name || '服务商', ModelSettings.backToList, false);
    var pr = presetForProvider(p);
    var html = '<div class="model-tabbar">' +
      '<div class="model-tab' + (state.providerTab === 'config' ? ' active' : '') + '" onclick="ModelSettings.setProviderTab(\'config\')">配置</div>' +
      '<div class="model-tab' + (state.providerTab === 'models' ? ' active' : '') + '" onclick="ModelSettings.setProviderTab(\'models\')">模型</div>' +
      '</div>';

    if (state.providerTab === 'config') {
      html += '<div class="settings-group" style="padding:14px;">' +
        '<div class="model-form-row"><label>服务商名称</label><input id="mgrProviderName" value="' + esc(p.name) + '" placeholder="服务商名称"></div>' +
        '<div class="model-form-row"><label>API 密钥</label><input id="mgrProviderKey" type="password" value="' + esc(p.apiKey || '') + '" placeholder="sk-..."></div>' +
        '<div class="model-form-row"><label>API 地址</label><input id="mgrProviderUrl" value="' + esc(p.apiUrl || '') + '" placeholder="https://api.example.com/v1"></div>' +
        '<div class="model-form-row"><label>接口格式</label><select id="mgrProviderFormat">' +
        '<option value="openai"' + (p.format === 'openai' ? ' selected' : '') + '>OpenAI Chat</option>' +
        '<option value="responses"' + (p.format === 'responses' ? ' selected' : '') + '>OpenAI Responses</option>' +
        '<option value="anthropic"' + (p.format === 'anthropic' ? ' selected' : '') + '>Anthropic</option>' +
        '<option value="gemini"' + (p.format === 'gemini' ? ' selected' : '') + '>Gemini</option>' +
        '</select><div style="font-size:11px;color:var(--text-muted);margin-top:6px;">当前对话与 RAG 使用 OpenAI 兼容接口；Anthropic/Gemini 适配后续开放。</div></div>' +
        '<div class="model-form-actions"><button class="model-mini-btn primary" onclick="ModelSettings.saveProvider()">' + (state.isNew ? '创建服务商' : '保存配置') + '</button>' +
        (!state.isNew ? '<button class="model-mini-btn danger" onclick="ModelSettings.deleteProvider()">删除服务商</button>' : '') +
        '</div></div>';
    } else {
      if (state.isNew) {
        html += '<div class="model-empty">先到「配置」保存服务商，再同步或添加模型。</div>';
      } else {
        html += '<div class="model-form-actions" style="margin-bottom:12px;">' +
          '<button class="model-mini-btn primary" onclick="ModelSettings.syncProvider()">同步模型</button>' +
          '<button class="model-mini-btn" onclick="ModelSettings.focusManualModel()">手动添加模型</button>' +
          '</div>';
        html += '<div class="model-list">';
        if (!(p.models || []).length) {
          html += '<div class="model-empty">还没有模型<br>同步或手动添加</div>';
        } else {
          p.models.forEach(function(m) {
            var mid = encodeURIComponent(m.id);
            html += '<div class="model-row" style="cursor:default;">' +
              '<div class="model-row-main"><div class="model-row-name">' + esc(m.name || m.id) + '</div>' +
              '<div class="model-row-sub">' + esc(m.id) + '</div></div>' +
              '<select style="width:92px;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font-size:11px;" onchange="ModelSettings.changeKind(\'' + esc(p.id) + '\',\'' + mid + '\',this.value)">' +
              KINDS.map(function(k) { return '<option value="' + k.id + '"' + (m.kind === k.id ? ' selected' : '') + '>' + k.label + '</option>'; }).join('') +
              '</select>' +
              '<label class="model-switch" onclick="event.stopPropagation()"><input type="checkbox" ' + (m.enabled !== false ? 'checked' : '') + ' onchange="ModelSettings.toggleModel(\'' + esc(p.id) + '\',\'' + mid + '\',this.checked)"><span></span></label>' +
              '<button class="model-mini-btn danger" onclick="ModelSettings.removeModel(\'' + esc(p.id) + '\',\'' + mid + '\')">删</button>' +
              '</div>';
          });
        }
        html += '</div>';
        html += '<div class="model-section-title">手动添加模型</div>' +
          '<div class="settings-group" style="padding:14px;">' +
          '<div class="model-form-row"><label>模型 ID</label><input id="mgrManualId" placeholder="例如 Qwen/Qwen3-Embedding-8B"></div>' +
          '<div class="model-form-row"><label>显示名称（可选）</label><input id="mgrManualName" placeholder="留空使用模型 ID"></div>' +
          '<div class="model-form-row"><label>模型类型</label><select id="mgrManualKind">' +
          KINDS.map(function(k) { return '<option value="' + k.id + '">' + k.label + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="model-form-actions"><button class="model-mini-btn primary" onclick="ModelSettings.addManualModel()">添加模型</button></div>' +
          '</div>';
      }
    }
    root.innerHTML = html;
  }

  function renderSync(root) {
    state.view = 'sync';
    setHeader('同步模型', function() { state.view = 'provider'; state.providerTab = 'models'; renderRoot(); }, false);
    var p = currentProvider();
    if (!p) { state.view = 'list'; renderList(root); return; }
    var q = String(state.syncSearch || '').toLowerCase();
    var list = state.syncList.filter(function(m) { return !q || String(m.id).toLowerCase().indexOf(q) !== -1; });
    var selected = state.syncList.filter(function(m) { return m.selected; }).length;
    var html = '<div class="settings-group" style="padding:14px;">' +
      '<div class="model-form-row"><input id="mgrSyncSearch" value="' + esc(state.syncSearch) + '" placeholder="搜索模型" oninput="ModelSettings.filterSync(this.value)"></div>' +
      '<div class="model-form-actions" style="justify-content:space-between;align-items:center;">' +
      '<button class="model-mini-btn" onclick="ModelSettings.selectAllSync()">全选 / 取消全选</button>' +
      '<span style="font-size:12px;color:var(--text-muted);">已选 ' + selected + ' / ' + state.syncList.length + '</span>' +
      '</div></div>' +
      '<div class="model-list" style="margin-top:10px;">';
    if (!list.length) html += '<div class="model-empty">没有匹配的模型</div>';
    list.forEach(function(m) {
      var idx = state.syncList.indexOf(m);
      html += '<label class="model-sync-row"><input type="checkbox" ' + (m.selected ? 'checked' : '') + ' onchange="ModelSettings.toggleSync(' + idx + ',this.checked)">' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(m.id) + '</span>' +
        '<span class="model-model-kind">' + kindLabel(m.kind) + '</span></label>';
    });
    html += '</div><div class="model-form-actions" style="margin-top:14px;"><button class="model-mini-btn primary" onclick="ModelSettings.addSyncSelected()">添加所选模型</button></div>';
    root.innerHTML = html;
  }

  function updateRagStatus() {
    var el = document.getElementById('mgrRagStatus');
    if (!el) return;
    if (!window.NoteRAG) { el.textContent = 'NoteRAG 未加载'; return; }
    var notes = [];
    try { notes = window.DataService.notes.load() || []; } catch (e) {}
    var st = window.NoteRAG.stats(notes);
    el.textContent = st.enabled
      ? ('向量索引：' + st.indexed + ' / ' + st.total + ' 条 · ' + st.model)
      : '未配置向量模型，笔记 RAG 不可用';
  }

  var ModelSettings = {
    renderRoot: renderRoot,
    setKind: function(kind) { state.kind = kind; state.view = 'list'; renderRoot(); },
    openAddProvider: function() { state.view = 'addProvider'; renderRoot(); },
    backToList: function() { state.isNew = false; state.draft = null; state.view = 'list'; renderRoot(); },
    createProvider: function(key) {
      var pr = preset(key);
      state.draft = {
        id: uid('prov'), name: pr.name, preset: pr.key,
        apiUrl: pr.url, apiKey: '', format: pr.format, models: []
      };
      state.isNew = true;
      state.providerId = state.draft.id;
      state.providerTab = 'config';
      state.view = 'provider';
      renderRoot();
    },
    openProvider: function(id) {
      state.providerId = id; state.isNew = false; state.draft = null;
      state.providerTab = 'config'; state.view = 'provider'; renderRoot();
    },
    setProviderTab: function(tab) { state.providerTab = tab; renderRoot(); },
    saveProvider: function() {
      var wasNew = state.isNew;
      var p = currentProvider();
      if (!p) return;
      var name = document.getElementById('mgrProviderName').value.trim();
      var key = document.getElementById('mgrProviderKey').value.trim();
      var url = document.getElementById('mgrProviderUrl').value.trim();
      var format = document.getElementById('mgrProviderFormat').value;
      if (!name) { toast('请填写服务商名称'); return; }
      if (!url) { toast('请填写 API 地址'); return; }
      p.name = name; p.apiKey = key; p.apiUrl = baseUrl(url); p.format = format;
      var s = settings();
      var providers = ensureProviders(s);
      if (state.isNew) {
        p.id = p.id || uid('prov');
        providers.push(p);
        state.providerId = p.id;
        state.isNew = false;
        state.draft = null;
        state.providerTab = 'models';
      }
      persist(s, providers);
      toast(wasNew ? '服务商已保存' : '配置已保存');
      renderRoot();
    },
    deleteProvider: function() {
      var p = currentProvider();
      if (!p) return;
      if (!confirm('删除服务商「' + p.name + '」及其模型？')) return;
      var s = settings();
      var providers = ensureProviders(s).filter(function(x) { return x.id !== p.id; });
      s.activeModels = s.activeModels || {};
      KINDS.forEach(function(k) {
        if (s.activeModels[k.id] && s.activeModels[k.id].providerId === p.id) delete s.activeModels[k.id];
      });
      persist(s, providers);
      state.view = 'list'; state.providerId = null;
      toast('服务商已删除');
      renderRoot();
    },
    setActive: function(providerId, modelIdEncoded) {
      var modelId = decodeURIComponent(modelIdEncoded);
      var s = settings();
      var providers = ensureProviders(s);
      var p = findProvider(providers, providerId);
      var m = findModel(p, modelId);
      if (!p || !m) return;
      m.enabled = true;
      s.activeModels = s.activeModels || {};
      s.activeModels[m.kind] = { providerId: providerId, modelId: modelId };
      persist(s, providers);
      toast('已切换到 ' + (m.name || m.id));
      renderRoot();
    },
    toggleModel: function(providerId, modelIdEncoded, checked) {
      var modelId = decodeURIComponent(modelIdEncoded);
      var s = settings();
      var providers = ensureProviders(s);
      var p = findProvider(providers, providerId);
      var m = findModel(p, modelId);
      if (!p || !m) return;
      m.enabled = !!checked;
      if (!checked && s.activeModels && s.activeModels[m.kind] &&
          s.activeModels[m.kind].providerId === providerId && s.activeModels[m.kind].modelId === modelId) {
        var replacement = null;
        providers.forEach(function(pp) {
          if (replacement) return;
          (pp.models || []).forEach(function(mm) {
            if (!replacement && mm.kind === m.kind && mm.enabled !== false) replacement = { providerId: pp.id, modelId: mm.id };
          });
        });
        if (replacement) s.activeModels[m.kind] = replacement;
        else delete s.activeModels[m.kind];
      }
      persist(s, providers);
      renderRoot();
    },
    changeKind: function(providerId, modelIdEncoded, kind) {
      var modelId = decodeURIComponent(modelIdEncoded);
      var s = settings();
      var providers = ensureProviders(s);
      var p = findProvider(providers, providerId);
      var m = findModel(p, modelId);
      if (!p || !m) return;
      var old = m.kind;
      m.kind = kind;
      if (s.activeModels && s.activeModels[old] && s.activeModels[old].providerId === providerId && s.activeModels[old].modelId === modelId) delete s.activeModels[old];
      persist(s, providers);
      renderRoot();
    },
    removeModel: function(providerId, modelIdEncoded) {
      var modelId = decodeURIComponent(modelIdEncoded);
      var s = settings();
      var providers = ensureProviders(s);
      var p = findProvider(providers, providerId);
      if (!p) return;
      p.models = (p.models || []).filter(function(m) { return m.id !== modelId; });
      KINDS.forEach(function(k) {
        if (s.activeModels && s.activeModels[k.id] && s.activeModels[k.id].providerId === providerId && s.activeModels[k.id].modelId === modelId) delete s.activeModels[k.id];
      });
      persist(s, providers);
      renderRoot();
    },
    addManualModel: function() {
      var p = currentProvider();
      if (!p) return;
      var id = document.getElementById('mgrManualId').value.trim();
      var name = document.getElementById('mgrManualName').value.trim() || id;
      var kind = document.getElementById('mgrManualKind').value;
      if (!id) { toast('请填写模型 ID'); return; }
      var s = settings();
      var providers = ensureProviders(s);
      var target = state.isNew ? p : findProvider(providers, p.id);
      if (!target) return;
      if (!findModel(target, id)) target.models.push({ id: id, name: name, kind: kind, enabled: true });
      if (!state.isNew) persist(s, providers);
      toast('模型已添加');
      renderRoot();
    },
    focusManualModel: function() {
      var el = document.getElementById('mgrManualId');
      if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
    },
    syncProvider: function() {
      var p = currentProvider();
      if (!p) return;
      if (state.isNew) { toast('请先保存服务商配置'); return; }
      if (p.format !== 'openai') { toast('该接口格式暂不支持自动同步，请手动添加模型'); return; }
      if (!p.apiUrl || !p.apiKey) { toast('请先填写 API 地址和密钥'); return; }
      var url = endpoint(p.apiUrl, '/models');
      toast('正在同步模型…');
      window.NativeHttp.getJson(url, { Authorization: 'Bearer ' + p.apiKey }).then(function(resp) {
        if (!resp || !resp.ok || (resp.status && (resp.status < 200 || resp.status >= 300))) throw new Error((resp && resp.error) || ('HTTP ' + (resp && resp.status)));
        var data = JSON.parse(resp.data || '{}');
        var list = data.data || data.models || [];
        var existing = {};
        (p.models || []).forEach(function(m) { existing[m.id] = 1; });
        state.syncList = [];
        list.forEach(function(item) {
          var id = typeof item === 'string' ? item : (item.id || item.model || '');
          if (!id) return;
          state.syncList.push({ id: id, kind: inferKind(id), selected: !existing[id] });
        });
        if (!state.syncList.length) { toast('服务商没有返回模型'); return; }
        state.view = 'sync'; state.syncSearch = '';
        renderRoot();
      }).catch(function(e) {
        toast('同步失败：' + (e.message || e));
      });
    },
    filterSync: function(q) { state.syncSearch = q; renderRoot(); },
    toggleSync: function(index, checked) {
      if (state.syncList[index]) state.syncList[index].selected = !!checked;
      renderRoot();
    },
    selectAllSync: function() {
      var all = state.syncList.every(function(m) { return m.selected; });
      state.syncList.forEach(function(m) { m.selected = !all; });
      renderRoot();
    },
    addSyncSelected: function() {
      var p = currentProvider();
      if (!p) return;
      var s = settings();
      var providers = ensureProviders(s);
      var target = findProvider(providers, p.id);
      if (!target) { toast('服务商未保存'); return; }
      var added = 0;
      state.syncList.forEach(function(m) {
        if (!m.selected) return;
        if (!findModel(target, m.id)) {
          target.models.push({ id: m.id, name: m.id, kind: m.kind, enabled: true });
          added++;
        }
      });
      persist(s, providers);
      state.view = 'provider'; state.providerTab = 'models';
      toast('已添加 ' + added + ' 个模型');
      renderRoot();
    },
    saveAdvanced: function() {
      var el = document.getElementById('mgrContextBudget');
      var n = el ? parseInt(el.value, 10) : NaN;
      if (!isFinite(n) || n < 1000) { toast('上下文预算至少 1000 tokens'); return; }
      n = Math.min(1000000, n);
      var s = settings();
      s.contextBudgetTokens = n;
      saveSettings(s);
      if (window.nianAgent && window.nianAgent.reloadConfig) {
        try { window.nianAgent.reloadConfig(); } catch (e) {}
      }
      toast('上下文预算已保存：' + n + ' tokens');
    },
    saveSearch: function() {
      var urlEl = document.getElementById('mgrSearchUrl');
      var keyEl = document.getElementById('mgrSearchKey');
      var countEl = document.getElementById('mgrSearchCount');
      var url = urlEl ? urlEl.value.trim() : '';
      var key = keyEl ? keyEl.value.trim() : '';
      var count = countEl ? parseInt(countEl.value, 10) : 5;
      if (!url) url = 'https://api.deepseek.com/v1/tools/search';
      if (!isFinite(count) || count < 1) count = 5;
      count = Math.min(10, count);
      var s = settings();
      s.searchApiUrl = url;
      if (key) s.searchApiKey = key; else delete s.searchApiKey;
      s.searchCount = count;
      saveSettings(s);
      toast('搜索配置已保存');
    },
    testSearch: function() {
      var el = document.getElementById('mgrSearchStatus');
      if (el) el.textContent = '搜索中…';
      ModelSettings.saveSearch();
      if (typeof window.webSearchSkill === 'undefined') {
        if (el) el.textContent = 'web_search 未加载';
        return;
      }
      window.webSearchSkill.execute({ query: 'DeepSeek' }).then(function(r) {
        if (!el) return;
        if (r && r.error) { el.textContent = '失败：' + r.error; return; }
        var n = (r && r.results && r.results.length) || 0;
        var first = r && r.results && r.results[0];
        el.textContent = '成功：' + n + ' 条' + (first ? ' · ' + (first.title || first.url) : '');
      }, function(e) {
        if (el) el.textContent = '失败：' + (e && e.message ? e.message : e);
      });
    },
    rebuildRag: function() {
      var el = document.getElementById('mgrRagStatus');
      if (!window.NoteRAG) { if (el) el.textContent = 'NoteRAG 未加载'; return; }
      if (!window.NoteRAG.enabled()) { if (el) el.textContent = '请先在向量模型中启用一个模型'; return; }
      var notes = [];
      try { notes = window.DataService.notes.load() || []; } catch (e) {}
      if (el) el.textContent = '索引中… 0 / ' + notes.length;
      window.NoteRAG.rebuildIndex(notes, function(done, total) {
        if (el) el.textContent = '索引中… ' + done + ' / ' + total;
      }).then(function(r) {
        if (el) el.textContent = (r && r.ok)
          ? ('向量索引完成：' + r.indexed + ' / ' + r.total + ' 条')
          : ('索引失败：' + ((r && r.error) || '未知错误'));
      }, function(e) {
        if (el) el.textContent = '索引失败：' + (e && e.message ? e.message : e);
      });
    }
  };

  window.ModelSettings = ModelSettings;
})();
