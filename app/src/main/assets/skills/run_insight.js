// ─── run_insight Skill ───
// 对笔记进行深度洞察分析。AI 根据笔记内容自主选择最合适的分析模式。
(function() {
  // 构建汇总所有洞察模式的元提示词
  function buildMetaPrompt(methods) {
    var header = "你是一个全方位的深度洞察分析师。你可以从以下多种分析视角切入，请根据日记内容自主选择最合适的模式（也可以融合多个模式）。\n\n";
    var footer = "\n\n请先快速判断这篇日记的性质（情绪记录/深度反思/日常记录/问题求助等），然后选择最匹配的分析模式，按照该模式的要求进行深入分析。\n\n如果内容涉及多个层面，可以融合多种模式。分析结果要深入、有洞察力，不要泛泛而谈。";

    var modeList = methods.map(function(m, idx) {
      return "【模式" + (idx + 1) + "】" + m.name + "：" + m.desc + "\n分析方向：" + m.systemPrompt.split("。")[0] + "。";
    }).join("\n\n");

    return header + modeList + footer;
  }

  // 获取所有洞察模式（从 app.js 暴露的接口或加载 DataService 中的自定义提示词）
  function getMethods() {
    if (typeof window.getInsightMethods === "function") {
      return window.getInsightMethods();
    }
    return [];
  }

  window.runInsightSkill = {
    definition: {
      name: "run_insight",
      description: "对一篇笔记进行深度洞察分析。AI 会根据笔记内容自主选择最合适的分析模式（如 5why追问、ACT疗法、盲区探索、灵魂拷问、价值澄清等 16 种模式）。也可以指定具体模式。结果返回分析文本。",
      parameters: {
        type: "object",
        properties: {
          noteId: {
            type: "string",
            description: "要分析的笔记 id"
          },
          modeId: {
            type: "string",
            description: "（可选）指定分析模式 id。不传则 AI 根据笔记内容自动选择最合适的模式"
          }
        },
        required: ["noteId"]
      }
    },

    execute: function(args) {
      return new Promise(function(resolve, reject) {
        try {
          if (!args || !args.noteId) {
            // 触发 UI 选择器流程，不再返回错误
            if (typeof window.openInsightPicker === 'function') {
              window.openInsightPicker(false, null);
              resolve({ ui: "picker_opened", message: "请选择要分析的笔记" });
            } else {
              resolve({ error: "缺少参数：需要 noteId" });
            }
            return;
          }

          // 1. 获取笔记
          var allNotes = window.DataService.notes.load();
          if (!allNotes || !allNotes.length) {
            resolve({ error: "没有找到笔记" });
            return;
          }

          var note = null;
          for (var i = 0; i < allNotes.length; i++) {
            if (allNotes[i].id === args.noteId) {
              note = allNotes[i];
              break;
            }
          }

          if (!note) {
            resolve({ error: "未找到指定的笔记" });
            return;
          }

          // 2. 获取洞察模式列表
          var methods = getMethods();
          if (!methods || !methods.length) {
            resolve({ error: "洞察系统不可用" });
            return;
          }

          // 3. 获取 API 配置
          var config = window.DataService.settings.load();
          if (!config || !config.apiUrl || !config.apiKey) {
            resolve({ error: "API 未配置，请先在设置中配置 API 地址和密钥" });
            return;
          }

          // 4. 提取笔记纯文本
          var noteContent = note.content;
          if (noteContent.indexOf("--isHTML ") === 0) {
            noteContent = noteContent.substring(9);
          }
          noteContent = noteContent.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

          // 5. 构建 systemPrompt
          var systemPrompt;
          var selectedModeName;

          if (args.modeId) {
            // 指定模式 → 用该模式的 systemPrompt
            var mode = null;
            for (var mi = 0; mi < methods.length; mi++) {
              if (methods[mi].id === args.modeId) {
                mode = methods[mi];
                break;
              }
            }
            if (!mode) {
              resolve({ error: "未找到指定的分析模式: " + args.modeId + "，可用模式请不传 modeId 让 AI 自动选择" });
              return;
            }
            systemPrompt = mode.systemPrompt;
            selectedModeName = mode.name;
          } else {
            // 未指定模式 → 用元提示词，AI 自主选择
            systemPrompt = buildMetaPrompt(methods);
            selectedModeName = "AI 自主选择";
          }

          // 6. 调用 LLM
          var url = config.apiUrl.replace(/\/+$/, "") + "/chat/completions";
          var payload = {
            model: config.model || "gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: "以下是我的日记内容，请进行分析：\n\n" + noteContent }
            ],
            temperature: 0.8,
            max_tokens: 2000
          };

          var xhr = new XMLHttpRequest();
          xhr.open("POST", url);
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.setRequestHeader("Authorization", "Bearer " + config.apiKey);
          xhr.timeout = 60000;

          xhr.ontimeout = function() {
            resolve({ error: "洞察分析超时" });
          };

          xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                var data = JSON.parse(xhr.responseText);
                var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                if (text) {
                  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<\/?think>/gi, "").trim();
                  resolve({
                    modeName: selectedModeName,
                    analysis: text
                  });
                } else {
                  resolve({ error: "AI 返回了空结果" });
                }
              } catch(e) {
                resolve({ error: "解析失败: " + e.message });
              }
            } else {
              resolve({ error: "API 请求失败: HTTP " + xhr.status });
            }
          };

          xhr.onerror = function() {
            resolve({ error: "网络请求失败" });
          };

          xhr.send(JSON.stringify(payload));
        } catch(e) {
          resolve({ error: e.message });
        }
      });
    }
  };
})();
