// 依赖 native-http.js 提供的 window.NativeHttp（在 app.html 中先于 agent.js 加载）。

// ─── Token 估算：CJK 约 1 token/字，其余约 1 token/4 字符 ───
function estimateTokens(text) {
  if (!text) return 0;
  var cjk = 0;
  var other = 0;
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3000 && c <= 0x303F) || (c >= 0xFF00 && c <= 0xFFEF)) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk + other / 4);
}

function truncateText(text, maxChars) {
  if (!text || text.length <= maxChars) return text || "";
  return text.substring(0, maxChars) + "…";
}

// ─── Agent: 小满智能体核心 ───
(function() {
  // 对话历史压缩提示词（供 _summarize 使用）
  var SUMMARY_PROMPT =
    '你是一个对话历史压缩助手。用户正在和 AI 伴侣「小满」对话，请把给定的对话历史压缩成一份简洁的中文摘要，供后续对话继续使用。\n\n' +
    '要求：\n' +
    '- 保留：用户说过的关键信息（个人信息、偏好、习惯、目标、情绪状态）、未完成的请求/待办、重要决定、对话主题\n' +
    '- 丢弃：寒暄、客套、与主题无关的细节\n' +
    '- 用「•」开头的要点列表，语言简洁\n' +
    '- 不超过 400 字\n' +
    '- 只输出摘要本身，不要任何解释';

  function readAgentConfig() {
    try {
      if (typeof window !== 'undefined' && window.DataService && window.DataService.settings) {
        return window.DataService.settings.load() || {};
      }
    } catch (e) {}
    return {};
  }

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  // 从设置读取上下文策略。默认 3000；模型支持长上下文时可调到 32k/128k/1M。
  function applyAgentConfig(self) {
    var cfg = readAgentConfig();
    var budget = Math.max(1000, Math.min(1000000, num(cfg.contextBudgetTokens, 32000)));
    self.contextBudgetTokens = budget;
    self.maxHistory = Math.max(20, Math.min(200, Math.round(budget / 2000)));
    self.maxToolResultChars = Math.max(1200, Math.min(64000, num(cfg.maxToolResultChars, Math.round(budget * 0.15))));
    self.recentKeepCount = Math.max(6, Math.min(60, num(cfg.recentKeepCount, Math.round(budget / 2000))));
    self.summaryMaxChars = Math.max(600, Math.min(8000, num(cfg.summaryMaxChars, Math.round(budget / 40))));
    self.maxUserMessageChars = Math.max(4000, Math.min(100000, num(cfg.maxUserMessageChars, budget * 2)));
  }

  function Agent() {
    this.skills = {};
    this.messages = [];
    this.maxHistory = 20;
    // 输入上下文 token 预算（含 system prompt 与摘要）。超预算时优先对最旧消息做
    // LLM 总结压缩（而不是直接丢弃），总结失败才回退截断。
    this.contextBudgetTokens = 32000;
    this.summaryMaxChars = 600;
    this.recentKeepCount = 6; // 总结后保留的最近消息条数
    this.maxToolResultChars = 1200;
    this.maxUserMessageChars = 4000;
    this.summary = ''; // 对话摘要（压缩后的历史），随 system prompt 注入
    this.summaryCount = 0;
    this._summarizing = false;
    this.onStep = null; // 执行过程事件回调（工具调用/结果/总结），供 UI 展示
    this.onLog = null;  // 每次对话完成后的日志回调（供后台统计/排障）
    this._steps = [];
    applyAgentConfig(this);
  }

  Agent.prototype.reloadConfig = function() {
    applyAgentConfig(this);
    return this;
  };

  // 发射执行过程事件并记录到本轮步骤列表
  Agent.prototype.emitStep = function(step) {
    if (!this._steps) this._steps = [];
    this._steps.push(step);
    if (this.onStep) {
      try { this.onStep(step); } catch (e) {}
    }
  };

  Agent.prototype.registerSkill = function(skill) {
    this.skills[skill.definition.name] = skill;
  };

  Agent.prototype.getToolDefinitions = function() {
    var tools = [];
    for (var name in this.skills) {
      if (this.skills.hasOwnProperty(name)) {
        var s = this.skills[name];
        tools.push({
          type: "function",
          function: {
            name: s.definition.name,
            description: s.definition.description,
            parameters: s.definition.parameters
          }
        });
      }
    }
    return tools;
  };

  // 重新计算消息数组占用 token 数
  function messagesTokens(msgs) {
    var total = 0;
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      total += 4; // role/name 等开销
      total += estimateTokens(m.content || "");
      if (m.tool_calls) {
        total += estimateTokens(JSON.stringify(m.tool_calls));
      }
    }
    return total;
  }

  // 在 token 预算内裁剪历史：总是保留最近一条消息与第一条用户消息
  Agent.prototype.buildContext = function(systemPrompt) {
    var fullSystem = systemPrompt || '';
    if (this.summary) {
      fullSystem = systemPrompt + '\n\n## 对话摘要\n' + this.summary;
    }
    var historyBudget = this.contextBudgetTokens - estimateTokens(fullSystem);
    if (historyBudget < 200) historyBudget = 200;

    var msgs = [];
    for (var i = 0; i < this.messages.length; i++) msgs.push(this.messages[i]);

    while (msgs.length > 1 && messagesTokens(msgs) > historyBudget) {
      // 优先丢最旧的；若只剩两条仍超预算，则截断而非全丢
      if (msgs.length === 2) break;
      msgs.shift();
    }

    // 兜底：仍超预算时对超长消息截断（从最旧开始）
    var guard = 0;
    while (messagesTokens(msgs) > historyBudget && guard++ < 20) {
      var trimmed = false;
      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        if (m.content && m.content.length > 200) {
          m.content = truncateText(m.content, Math.floor(m.content.length * 0.7));
          trimmed = true;
          break;
        }
      }
      if (!trimmed) break;
    }

    var out = [{ role: "system", content: fullSystem }];
    for (var j = 0; j < msgs.length; j++) out.push(msgs[j]);
    return out;
  };

  // 是否超出预算（含 system prompt 与摘要的开销）
  Agent.prototype._isOverBudget = function(systemPrompt) {
    var overhead = estimateTokens(systemPrompt || '') + estimateTokens(this.summary || '');
    return messagesTokens(this.messages) > (this.contextBudgetTokens - overhead);
  };

  // 超预算时：把最旧的消息交给 LLM 压缩为摘要，仅保留最近 recentKeepCount 条。
  // 总结失败（无网络/API 未配置）时回退为直接截断。
  Agent.prototype._ensureBudget = function(systemPrompt) {
    var self = this;
    if (!this._isOverBudget(systemPrompt) || this._summarizing) {
      return Promise.resolve();
    }
    this._summarizing = true;

    var oldMsgs = this.messages.slice(0, -this.recentKeepCount);
    var recentMsgs = this.messages.slice(-this.recentKeepCount);
    if (oldMsgs.length === 0) {
      // 最近消息本身过大 → 交给 buildContext 的兜底截断处理
      this._summarizing = false;
      return Promise.resolve();
    }

    var prevSummary = this.summary;
    return this._summarize(oldMsgs, prevSummary).then(function(text) {
      self.summary = truncateText(text, self.summaryMaxChars);
      self.summaryCount++;
      self.messages = recentMsgs;
      self._summarizing = false;
      self.emitStep({ type: 'summary', summary: truncateText(self.summary, 80), at: Date.now() });
    }, function() {
      // 总结失败：回退为截断
      self.messages = recentMsgs;
      self._summarizing = false;
    });
  };

  // 把消息列表渲染成可压缩的纯文本
  function renderForSummary(msgs) {
    var lines = [];
    var MAX_MSGS = 40;
    var start = msgs.length > MAX_MSGS ? msgs.length - MAX_MSGS : 0;
    for (var i = start; i < msgs.length; i++) {
      var m = msgs[i];
      if (!m) continue;
      var content = m.content ? truncateText(String(m.content), 300) : '';
      if (m.role === 'user') lines.push('用户：' + content);
      else if (m.role === 'assistant') lines.push('小满：' + content);
      else if (m.role === 'tool') lines.push('工具结果：' + truncateText(content, 100));
    }
    return lines.join('\n');
  }

  Agent.prototype._summarize = function(oldMsgs, prevSummary) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var config = window.DataService.settings.load();
      if (!config || !config.apiUrl || !config.apiKey) {
        reject(new Error("API 未配置"));
        return;
      }
      var userContent = '对话历史：\n' + renderForSummary(oldMsgs);
      if (prevSummary) {
        userContent += '\n\n已有摘要（需融合保留，不要丢失其中的信息）：\n' + prevSummary;
      }
      var payload = {
        model: config.model || "gpt-4o",
        messages: [
          { role: "system", content: SUMMARY_PROMPT },
          { role: "user", content: userContent }
        ],
        temperature: 0.3,
        max_tokens: Math.min(2000, Math.max(400, Math.ceil(self.summaryMaxChars / 2)))
      };
      self._callLLM(payload, function(err, response) {
        if (err) {
          reject(err);
          return;
        }
        var text = response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
        if (!text) {
          reject(new Error("Empty summary"));
          return;
        }
        text = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/gi, '').trim();
        if (!text) {
          reject(new Error("Empty summary"));
          return;
        }
        resolve(text);
      });
    });
  };

  // 用已有对话历史重建上下文（切换对话时调用）。summary 为可选的历史摘要。
  Agent.prototype.setHistory = function(msgs, summary) {
    this.messages = [];
    this.summary = typeof summary === 'string' ? summary : '';
    if (!msgs || !msgs.length) return;
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (!m || !m.role) continue;
      if (m.role !== "user" && m.role !== "assistant") continue;
      this.messages.push({
        role: m.role,
        content: typeof m.content === "string" ? truncateText(m.content, this.maxUserMessageChars) : ""
      });
    }
  };

  Agent.prototype.process = function(userMessage, systemPrompt) {
    var self = this;
    self._steps = [];
    self.messages.push({ role: "user", content: truncateText(userMessage, self.maxUserMessageChars) });

    var iterations = 0;
    var maxIterations = 10;

    function finish(ok, textOrErr) {
      var log = {
        ts: Date.now(),
        ok: ok,
        steps: self._steps,
        summaryCount: self.summaryCount
      };
      if (!ok) log.error = textOrErr && textOrErr.message ? textOrErr.message : String(textOrErr);
      if (self.onLog) {
        try { self.onLog(log); } catch (e) {}
      }
    }

    function runLoop(resolve, reject) {
      iterations++;
      if (iterations > maxIterations) {
        finish(true, "思考太久了，我们换个话题聊聊？");
        resolve("思考太久了，我们换个话题聊聊？");
        return;
      }

      // 超预算先压缩旧历史（LLM 总结），失败才截断
      self._ensureBudget(systemPrompt).then(function() {
        var msgs = self.buildContext(systemPrompt);

        var tools = self.getToolDefinitions();
        var payload = {
          model: "",
          messages: msgs,
          temperature: 0.7,
          max_tokens: 1000
        };
        if (tools.length > 0) payload.tools = tools;

        self._callLLM(payload, function(err, response) {
          if (err) {
            finish(false, err);
            reject(err);
            return;
          }

          var choice = response.choices && response.choices[0];
          if (!choice) {
            var emptyErr = new Error("Empty LLM response");
            finish(false, emptyErr);
            reject(emptyErr);
            return;
          }

          var message = choice.message || {};

          if (message.tool_calls && message.tool_calls.length > 0) {
            self.messages.push({
              role: "assistant",
              content: message.content || null,
              tool_calls: message.tool_calls
            });

            var pending = message.tool_calls.length;
            var completed = 0;

    function executeTool(tc) {
      var name = tc.function.name;
      var args = {};
      try { args = JSON.parse(tc.function.arguments); } catch(e) {}

      // 执行过程可见：发射工具调用事件
      self.emitStep({
        type: 'tool_call',
        name: name,
        args: truncateText(JSON.stringify(args || {}), 200),
        at: Date.now()
      });

      var skill = self.skills[name];
      var raw;

      if (!skill) {
        raw = { error: "Skill \"" + name + "\" not found" };
      } else {
        try {
          raw = skill.execute(args);
        } catch(e) {
          raw = { error: e.message };
        }
      }

      // 支持异步 Skill（返回 Promise）
      function finishTool(result) {
        var content;
        if (typeof result === "string") content = result;
        else content = JSON.stringify(result);

        // 执行过程可见：发射工具结果事件（含成败与摘要）
        var isErr = result && typeof result === 'object' && (result.error || result.ok === false);
        self.emitStep({
          type: 'tool_result',
          name: name,
          ok: !isErr,
          summary: truncateText(String(content).replace(/[\r\n]+/g, ' '), 150),
          at: Date.now()
        });

        self.messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: truncateText(content, self.maxToolResultChars)
        });
        completed++;
        if (completed >= pending) {
          runLoop(resolve, reject);
        }
      }

              if (raw && typeof raw.then === "function") {
                raw.then(finishTool, function(err) {
                  finishTool({ error: err.message });
                });
              } else {
                finishTool(raw);
              }
            }

            for (var ti = 0; ti < message.tool_calls.length; ti++) {
              executeTool(message.tool_calls[ti]);
            }
          } else {
            var text = message.content || "";
            self.messages.push({ role: "assistant", content: text });
            finish(true, text);
            resolve(text);
          }
        });
      }, function(err) {
        finish(false, err);
        reject(err);
      });
    }

    return new Promise(function(resolve, reject) {
      runLoop(resolve, reject);
    });
  };

  // 网络调用（带一次失败重试：仅重试 timeout / network / 5xx 等临时错误）
  Agent.prototype._callLLM = function(payload, callback) {
    var self = this;
    var attempts = 0;

    function attempt() {
      attempts++;
      self._callLLMOnce(payload, function(err, response) {
        if (err && attempts < 2 && isRetryable(err)) {
          self.emitStep({ type: 'llm_retry', reason: err.message });
          attempt();
          return;
        }
        callback(err, response);
      });
    }
    attempt();
  };

  function isRetryable(err) {
    var m = err && err.message ? err.message.toLowerCase() : '';
    return m.indexOf('timeout') !== -1 || m.indexOf('network') !== -1 || /http 5\d\d/.test(m) || m.indexOf('econnreset') !== -1;
  }

  // 一次性网络调用（不含重试）
  Agent.prototype._callLLMOnce = function(payload, callback) {
    try {
      var config = window.DataService.settings.load();
      if (!config || !config.apiUrl || !config.apiKey) {
        callback(new Error("API 未配置"));
        return;
      }

      var runtimeCfg = (typeof window !== 'undefined' && window.NIAN_CONFIG) || {};
      payload.model = config.model || (runtimeCfg.model && runtimeCfg.model.defaultModel) || "gpt-4o";

      var url = (typeof NativeHttp !== "undefined" && NativeHttp.chatEndpoint) ? NativeHttp.chatEndpoint(config.apiUrl) : config.apiUrl.replace(/\/+$/, "") + "/chat/completions";
      var headers = { Authorization: "Bearer " + config.apiKey };

      // Android 端走原生桥（无 CORS），浏览器端走 XHR
      NativeHttp.postJson(url, headers, payload).then(function(data) {
        if (data.raw) {
          try { callback(null, JSON.parse(data.raw)); }
          catch (e) { callback(new Error("Parse error: " + e.message)); }
          return;
        }
        callback(null, data);
      }, function(err) {
        callback(err);
      });
    } catch(e) {
      callback(e);
    }
  };

  Agent.prototype.reset = function() {
    this.messages = [];
  };

  window.NianAgent = Agent;
})();
