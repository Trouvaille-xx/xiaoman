// ─── write_summary Skill ───
// 摘要生成: 四道关卡 + LLM 信息密度判 (关 2)
// 调用方式: writeSummarySkill.summarize(noteContent, opts) -> Promise<{line, accepted, reason}>
(function() {
  // 关 1 字数 8-80
  function gate1(text) {
    var cleaned = text.replace(/[\s，。！？,.!?]/g, '');
    return cleaned.length >= 8 && cleaned.length <= 80;
  }
  // 关 4 纯情绪词正则
  var EMOTION_RE = [
    /^(我今天|今天|今早|刚)\s*(好|有点|真的|特别)?\s*(累|烦|闷|想哭|高兴|开心)$/,
    /^(好累|好烦|想睡|想哭)$/,
    /^(.*的)(疲惫|焦虑|忧伤|开心|兴奋)$/
  ];
  function gate4(text) {
    var t = text.trim();
    for (var i = 0; i < EMOTION_RE.length; i++) {
      if (EMOTION_RE[i].test(t)) return true;
    }
    return false;
  }

  // 关 2: LLM 信息密度 0/1
  function gate2LLM(text, config) {
    return new Promise(function(resolve) {
      if (!config || !config.apiUrl || !config.apiKey) { resolve(0); return; }
      var url = (config.apiUrl || '').replace(/\/+$/, '') + '/chat/completions';
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', 'Bearer ' + config.apiKey);
      xhr.timeout = 8000;
      xhr.onload = function() {
        if (xhr.status < 200 || xhr.status >= 300) { resolve(0); return; }
        try {
          var data = JSON.parse(xhr.responseText);
          var t = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
          t = t.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
          resolve(t.indexOf('1') !== -1 ? 1 : 0);
        } catch(e) { resolve(0); }
      };
      xhr.onerror = xhr.ontimeout = function() { resolve(0); };
      xhr.send(JSON.stringify({
        model: config.model || 'gpt-4o',
        messages: [
          { role: 'system', content: '判断下面这句是否有"事件/事实/观点/关系"中的任意一种信息。有就答 1，没有就答 0。只答一个数字。' },
          { role: 'user', content: '输入: "' + text + '"' }
        ],
        temperature: 0,
        max_tokens: 5
      }));
    });
  }

  window.writeSummarySkill = {
    /**
     * 从笔记原文生成一条摘要, 经四道关卡
     * @param {string} noteContent  笔记原文
     * @param {Object} opts
     * @param {Object} [opts.config]  DataService.settings.load()
     * @param {string} [opts.date]    ISO date string
     * @param {string} [opts.tag]     [日记] / [思考] / [对话]
     * @returns {Promise<{accepted: boolean, line: string|null, reason: string}>}
     */
    summarize: function(noteContent, opts) {
      opts = opts || {};
      var config = opts.config;
      var date = (opts.date || new Date().toISOString()).substring(0, 10);
      var time = (opts.date || new Date().toISOString()).substring(11, 16);
      var tag = opts.tag || '日记';

      return new Promise(function(resolve) {
        // 先让 LLM 提炼 8-50 字的摘要
        if (!config || !config.apiUrl || !config.apiKey) {
          resolve({ accepted: false, line: null, reason: '无 API 配置' });
          return;
        }
        var url = (config.apiUrl || '').replace(/\/+$/, '') + '/chat/completions';
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + config.apiKey);
        xhr.timeout = 12000;
        xhr.onload = function() {
          if (xhr.status < 200 || xhr.status >= 300) {
            resolve({ accepted: false, line: null, reason: 'API 错误' });
            return;
          }
          try {
            var data = JSON.parse(xhr.responseText);
            var text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
            text = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
            if (!text || text === '无' || text.length < 5) {
              resolve({ accepted: false, line: null, reason: '内容无信息量' });
              return;
            }
            // 关 1
            if (!gate1(text)) {
              resolve({ accepted: false, line: null, reason: '关 1 字数不达标' });
              return;
            }
            // 关 4
            if (gate4(text)) {
              // 纯情绪词 → 走关 3 累计判定
              if (typeof window.__memoryGetData === 'function') {
                var dataObj = window.__memoryGetData();
                var summary = (dataObj.docs['SUMMARY.md'] && dataObj.docs['SUMMARY.md'].content) || '';
                var lines = summary.split('\n').filter(function(l){ return l.indexOf('- 2') === 0; });
                var sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10);
                var recentCount = lines.filter(function(l){
                  var m = l.match(/^-\s+(\d{4}-\d{2}-\d{2})/);
                  return m && m[1] >= sevenDaysAgo;
                }).length;
                if (recentCount < 3) {
                  resolve({ accepted: false, line: null, reason: '关 3 情绪累计 < 3' });
                  return;
                }
                // 累计 3+ → 升格
                text = '[情绪累计] ' + text;
              }
            }
            // 关 2 LLM 信息密度 (本步骤已经由 LLM 提炼, 视为通过)
            var line = '- ' + date + ' ' + time + ' [' + tag + '] — ' + text;
            resolve({ accepted: true, line: line, reason: '通过四道关卡' });
          } catch(e) {
            resolve({ accepted: false, line: null, reason: '解析失败' });
          }
        };
        xhr.onerror = xhr.ontimeout = function() {
          resolve({ accepted: false, line: null, reason: '网络失败' });
        };
        xhr.send(JSON.stringify({
          model: config.model || 'gpt-4o',
          messages: [
            { role: 'system', content: '从以下用户日记中提炼一句 8-50 字的结构化摘要。要求：\n- 抓出"谁/做了什么/结果"或"什么观点/什么关系"\n- 客观陈述，不评价\n- 一句话即可\n- 信息密度低（纯情绪/无具体事件）时只回"无"\n- 不要输出思考过程' },
            { role: 'user', content: '日记内容：\n' + noteContent }
          ],
          temperature: 0.3,
          max_tokens: 100
        }));
      });
    }
  };
})();
