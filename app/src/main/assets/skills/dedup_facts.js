// ─── dedup_facts Skill ───
// 事实去重 / 合并 / supersede
// 流程: 取最近 50 条 verified facts → LLM 精判 → 返回 actions
// 不接 embedding（避免引入依赖）；用 LLM 处理语义同义
(function() {
  window.dedupFactsSkill = {
    /**
     * 对候选事实列表做去重判定
     * @param {Object} opts
     * @param {Array<{fact, category, source}>} opts.candidates  待判定的新事实
     * @param {Object} [opts.config] DataService.settings.load()  用于调 LLM
     * @param {number} [opts.lookback=50] 取最近多少条已验证事实做精判
     * @returns {Promise<{candidates: Array}>}
     */
    judge: function(opts) {
      opts = opts || {};
      var candidates = opts.candidates || [];
      var lookback = opts.lookback || 50;
      var config = opts.config;

      return new Promise(function(resolve, reject) {
        if (candidates.length === 0) {
          resolve({ candidates: [] });
          return;
        }

        // 取最近 N 条已验证事实
        var recent = [];
        if (typeof window.__memoryGetRecentFacts === 'function') {
          recent = window.__memoryGetRecentFacts(lookback);
        }

        if (recent.length === 0 || !config || !config.apiUrl || !config.apiKey) {
          // 无已有事实 / 无 API 配置 → 全部 add
          var all = candidates.map(function(c) {
            return { new: c.fact, action: 'add', category: c.category, source: c.source, keywords: c.keywords || [], reason: '无已有事实' };
          });
          resolve({ candidates: all });
          return;
        }

        // 构造 LLM prompt
        var factsList = recent.map(function(f, i) {
          return '[' + i + '] (id=' + f.id + ', cat=' + f.category + ') ' + f.fact;
        }).join('\n');
        var newList = candidates.map(function(c, i) {
          return '[' + i + '] (cat=' + (c.category || 'event') + ') ' + c.fact;
        }).join('\n');

        var systemPrompt = [
          '你是一个事实去重助手。给定已有事实表 + 候选新事实，请判定每个候选的 action:',
          '',
          'action 含义:',
          '- skip: 与已有事实完全重复，无需写入',
          '- update: 与已有事实相关，是同一事实的更新版本（填 targetId + newContent）',
          '- supersede: 与已有事实矛盾，是新事实取代旧事实（填 targetId + reason）',
          '- add: 与已有事实无关，是全新事实',
          '',
          '判定原则:',
          '- 同义不同表达 → update',
          '- 矛盾/反转 → supersede',
          '- 完全独立的新信息 → add',
          '- 字面重复 → skip',
          '',
          '严格按以下 JSON 格式输出（不要任何额外说明）:',
          '{"candidates":[{"new":"...","action":"skip|update|supersede|add","targetId":"fact_xxx(如有)","newContent":"...(update时填)","reason":"...","category":"...","keywords":["..."]}]}'
        ].join('\n');

        var userPrompt = '已有事实 (最近 ' + recent.length + ' 条):\n' + factsList +
          '\n\n候选新事实:\n' + newList;

        var url = (config.apiUrl || '').replace(/\/+$/, '') + '/chat/completions';
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + config.apiKey);
        xhr.timeout = 20000;
        xhr.onload = function() {
          if (xhr.status < 200 || xhr.status >= 300) {
            // 失败 → 降级为全部 add
            resolve({
              candidates: candidates.map(function(c) {
                return { new: c.fact, action: 'add', category: c.category, source: c.source, keywords: c.keywords || [], reason: 'API 失败降级' };
              }),
              degraded: true
            });
            return;
          }
          try {
            var data = JSON.parse(xhr.responseText);
            var text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
            // 清理 think 标签
            text = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
            // 提取 JSON
            var jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              resolve({
                candidates: candidates.map(function(c) {
                  return { new: c.fact, action: 'add', category: c.category, source: c.source, keywords: c.keywords || [], reason: 'JSON 解析失败降级' };
                }),
                degraded: true
              });
              return;
            }
            var parsed = JSON.parse(jsonMatch[0]);
            resolve({ candidates: parsed.candidates || [] });
          } catch(e) {
            resolve({
              candidates: candidates.map(function(c) {
                return { new: c.fact, action: 'add', category: c.category, source: c.source, keywords: c.keywords || [], reason: '异常降级: ' + e.message };
              }),
              degraded: true
            });
          }
        };
        xhr.onerror = xhr.ontimeout = function() {
          resolve({
            candidates: candidates.map(function(c) {
              return { new: c.fact, action: 'add', category: c.category, source: c.source, keywords: c.keywords || [], reason: '网络失败降级' };
            }),
            degraded: true
          });
        };
        xhr.send(JSON.stringify({
          model: config.model || 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          max_tokens: 1500,
          response_format: { type: 'json_object' }
        }));
      });
    }
  };
})();
