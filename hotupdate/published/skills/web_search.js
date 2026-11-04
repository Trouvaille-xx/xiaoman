// ─── web_search Skill：DeepSeek 官方 Search API ───
// POST https://api.deepseek.com/v1/tools/search
// Bearer <DeepSeek API Key>；返回 title/url/snippet/summary。
(function() {
  function appSettings() {
    try {
      if (window.DataService && window.DataService.settings) return window.DataService.settings.load() || {};
      if (typeof AndroidSettings !== 'undefined' && AndroidSettings.loadSettings) {
        return JSON.parse(AndroidSettings.loadSettings() || '{}');
      }
      return JSON.parse(localStorage.getItem('nian_settings') || '{}');
    } catch (e) { return {}; }
  }

  function deepseekProviderKey(s) {
    var list = (s && Array.isArray(s.providers)) ? s.providers : [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.apiKey) continue;
      if (p.preset === 'deepseek' || /api\.deepseek\.com/i.test(p.apiUrl || '')) return p.apiKey;
    }
    return '';
  }

  function searchEndpoint(raw) {
    var u = String(raw || '').trim().replace(/\/+$/, '');
    if (!u) return 'https://api.deepseek.com/v1/tools/search';
    if (/\/tools\/search$/i.test(u)) return u;
    if (/\/v1$/i.test(u)) return u + '/tools/search';
    if (/^https?:\/\/[^/]+$/i.test(u)) return u + '/v1/tools/search';
    return u + '/tools/search';
  }

  function resolveConfig() {
    var s = appSettings();
    var key = s.searchApiKey || deepseekProviderKey(s);
    var count = parseInt(s.searchCount, 10);
    if (!isFinite(count) || count < 1) count = 5;
    if (count > 10) count = 10;
    return { key: key, url: searchEndpoint(s.searchApiUrl), count: count };
  }

  window.webSearchSkill = {
    definition: {
      name: "web_search",
      description: "使用 DeepSeek 官方 Search API 搜索互联网，返回标题、URL、摘要和站点，适合查询最新新闻、产品、知识和实时信息。需要配置 DeepSeek 搜索 API Key。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词，支持 site:、-site:、引号精确匹配等操作符"
          }
        },
        required: ["query"]
      }
    },

    execute: function(args) {
      if (!args || !args.query) return { error: "请提供搜索关键词" };
      var cfg = resolveConfig();
      if (!cfg.key) {
        return { error: "未配置 DeepSeek 搜索 API Key。请在 模型设置 → 联网搜索 中填写 DeepSeek API Key。" };
      }
      if (typeof NativeHttp === 'undefined' || !NativeHttp.postJson) {
        return { error: "原生 HTTP 桥不可用" };
      }

      var query = String(args.query).substring(0, 128);
      var payload = {
        query: query,
        count: cfg.count,
        ori_question: query,
        need_content: false
      };

      return NativeHttp.postJson(cfg.url,
        { Authorization: 'Bearer ' + cfg.key }, payload).then(function(data) {
        var rows = data && Array.isArray(data.results) ? data.results : [];
        if (!rows.length) {
          return { query: query, provider: 'deepseek', results: [], message: "没有找到相关结果" };
        }
        var results = rows.slice(0, cfg.count).map(function(r) {
          return {
            title: r.title || '',
            url: r.url || '',
            snippet: String(r.snippet || '').substring(0, 200),
            summary: String(r.summary || '').substring(0, 500),
            site: r.site_name || '',
            date: r.date || '',
            score: r.rerank_score != null ? r.rerank_score : null
          };
        });
        return { query: query, provider: 'deepseek', results: results };
      }, function(e) {
        return { error: "搜索失败: " + ((e && e.message) || e) + "（请检查 DeepSeek Key、余额和网络）" };
      });
    }
  };
})();
