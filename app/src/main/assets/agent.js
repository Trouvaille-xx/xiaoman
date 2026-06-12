// ─── Agent: 念念智能体核心 ───
(function() {
  function Agent() {
    this.skills = {};
    this.messages = [];
    this.maxHistory = 20;
  }

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

  Agent.prototype.process = function(userMessage, systemPrompt) {
    var self = this;
    self.messages.push({ role: "user", content: userMessage });

    var iterations = 0;
    var maxIterations = 10;

    function runLoop(resolve, reject) {
      iterations++;
      if (iterations > maxIterations) {
        resolve("思考太久了，我们换个话题聊聊？");
        return;
      }

      var msgs = [{ role: "system", content: systemPrompt }];
      var recent = self.messages.slice(-self.maxHistory);
      for (var i = 0; i < recent.length; i++) {
        msgs.push(recent[i]);
      }

      var tools = self.getToolDefinitions();
      var payload = {
        model: "",
        messages: msgs,
        temperature: 0.7,
        max_tokens: 2000
      };
      if (tools.length > 0) payload.tools = tools;

      self._callLLM(payload, function(err, response) {
        if (err) {
          reject(err);
          return;
        }

        var choice = response.choices && response.choices[0];
        if (!choice) {
          reject(new Error("Empty LLM response"));
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
              self.messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: typeof result === "string" ? result : JSON.stringify(result)
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
          resolve(text);
        }
      });
    }

    return new Promise(function(resolve, reject) {
      runLoop(resolve, reject);
    });
  };

  Agent.prototype._callLLM = function(payload, callback) {
    try {
      var config = window.DataService.settings.load();
      if (!config || !config.apiUrl || !config.apiKey) {
        callback(new Error("API 未配置"));
        return;
      }

      payload.model = config.model || "gpt-4o";

      var url = config.apiUrl.replace(/\/+$/, "") + "/chat/completions";

      var xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Authorization", "Bearer " + config.apiKey);

      xhr.timeout = 30000;
      xhr.ontimeout = function() {
        callback(new Error("Request timeout"));
      };

      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText);
            callback(null, data);
          } catch(e) {
            callback(new Error("Parse error: " + e.message));
          }
        } else {
          callback(new Error("HTTP " + xhr.status + ": " + xhr.responseText));
        }
      };

      xhr.onerror = function() {
        callback(new Error("Network error"));
      };

      xhr.send(JSON.stringify(payload));
    } catch(e) {
      callback(e);
    }
  };

  Agent.prototype.reset = function() {
    this.messages = [];
  };

  window.NianAgent = Agent;
})();
