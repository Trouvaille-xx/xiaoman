// ─── generate_note_image Skill ───
// 根据一条随记的内容，用 AI 图像模型生成一张配图并挂到该笔记上。
// 依赖：DataService（笔记/设置）、ImageService（图片落盘）、NativeHttp（网络）。
(function() {
  // 配图风格 → prompt 后缀映射（可在 execute 的 style 参数中指定）
  var STYLES = {
    illustration: "插画风格，温暖治愈的扁平插画",
    watercolor: "水彩画风格，柔和的笔触与晕染",
    realistic: "写实摄影风格，自然光影",
    healing: "治愈系风格，柔和的暖色调，给人安慰感",
    minimal: "极简风格，大面积的留白，干净克制",
    none: ""
  };

  // 把笔记 content 剥离 HTML/标记，得到纯文本（供 prompt 使用）
  function plainText(content) {
    if (!content) return "";
    var text = content;
    if (text.indexOf("--isHTML ") === 0) {
      text = text.substring(9);
    }
    text = text.replace(/<img[^>]*>/g, "");
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");
    text = text.replace(/<[^>]+>/g, " ");
    text = text.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    text = text.replace(/\s+/g, " ").trim();
    return text;
  }

  // 构建图像生成 URL：交给统一的端点归一化（裸域名补 /v1，已带端点不重复拼）
  function buildImageUrl(apiUrl) {
    return NativeHttp.imageEndpoint(apiUrl);
  }

  // 从设置读取配图配置（不硬编码密钥，一律读用户设置）
  function resolveConfig() {
    var settings = (typeof DataService !== "undefined" && DataService.settings) ? DataService.settings.load() : null;
    if (!settings) return null;
    var runtimeCfg = (typeof window !== "undefined" && window.NIAN_CONFIG) || {};
    var defaultImageModel = (runtimeCfg.model && runtimeCfg.model.imageModel) || "gpt-image-2";
    // 配图 API 独立配置：imageApiUrl/imageApiKey/imageModel 优先，缺省回退主 API
    var imageApiUrl = settings.imageApiUrl || settings.apiUrl || "";
    var apiKey = settings.imageApiKey || settings.apiKey || "";
    var model = settings.imageModel || defaultImageModel;
    if (!imageApiUrl || !apiKey) return null;
    return { url: buildImageUrl(imageApiUrl), key: apiKey, model: model };
  }

  // 网络请求：Android 走 NativeHttp（原生桥），浏览器走 XHR
  function postJson(url, headers, payload) {
    if (typeof NativeHttp !== "undefined" && NativeHttp.postJson) {
      return NativeHttp.postJson(url, headers, payload);
    }
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      for (var k in headers) {
        if (headers.hasOwnProperty(k)) xhr.setRequestHeader(k, headers[k]);
      }
      xhr.timeout = 120000;
      xhr.ontimeout = function() { reject(new Error("timeout")); };
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch(e) { reject(new Error("parse: " + e.message)); }
        } else {
          reject(new Error("http " + xhr.status + ": " + xhr.responseText.substring(0, 300)));
        }
      };
      xhr.onerror = function() { reject(new Error("network")); };
      xhr.send(JSON.stringify(payload));
    });
  }

  // 生成图片 base64（data[0].b64_json 或 data[0].url 兜底）
  function extractImage(data) {
    if (data && data.data && data.data.length > 0) {
      var item = data.data[0];
      if (item.b64_json) return { base64: item.b64_json, url: null };
      if (item.url) return { base64: null, url: item.url };
    }
    return null;
  }

  // 把生成的图片挂到笔记 content 末尾（保持 --isHTML 规则）
  function attachImageToNote(note, imageId, imageSrc) {
    var onclick = imageId ? " onclick=\"openImagePreview('" + imageId + "')\"" : "";
    var dataAttr = imageId ? ' data-image-id="' + imageId + '"' : "";
    var imgHtml = '<img src="' + imageSrc + '" alt="ai-image"' + onclick + ' onerror="onImageLoadError(this)" style="max-width:100%;border-radius:8px;margin:2px 1px;cursor:pointer"' + dataAttr + '>';
    var content = note.content || "";
    if (content.indexOf("--isHTML ") === 0) {
      note.content = content + imgHtml;
    } else {
      // 纯文本笔记：先转义为 HTML 再追加图片
      var esc = String(content)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/\n/g, "<br>");
      note.content = "--isHTML " + esc + imgHtml;
    }
    return note;
  }

  // 保存笔记数组（Android 走原生存储 + Room 同步，浏览器走 localStorage）
  function saveNotes(notes) {
    if (typeof DataService !== "undefined" && DataService.notes) {
      DataService.notes.save(notes);
    }
  }

  // 通知 UI 刷新（app.js 暴露的钩子）
  function notifyUI(noteId, imageId) {
    if (typeof window.__onNoteImageGenerated === "function") {
      try { window.__onNoteImageGenerated(noteId, imageId); } catch(e) {}
    }
  }

  window.generateNoteImageSkill = {
    definition: {
      name: "generate_note_image",
      description: "根据一条笔记（随记）的内容，用 AI 生成一张配图并挂到该笔记上。调用时机：用户明确要求「给这篇笔记配图」「生成配图」「配张图」「画个插画」等。可用风格：插画(illustration)、水彩(watercolor)、写实(realistic)、治愈(healing)、简约(minimal)。",
      parameters: {
        type: "object",
        properties: {
          noteId: {
            type: "string",
            description: "要配图的笔记 id"
          },
          style: {
            type: "string",
            description: "（可选）配图风格：illustration / watercolor / realistic / healing / minimal，不传则用插画风"
          }
        },
        required: ["noteId"]
      }
    },

    execute: function(args) {
      return new Promise(function(resolve) {
        try {
          if (!args || !args.noteId) {
            resolve({ error: "缺少参数：需要 noteId" });
            return;
          }

          // 1. 找笔记
          var allNotes = (typeof DataService !== "undefined" && DataService.notes) ? DataService.notes.load() : [];
          var note = null;
          for (var i = 0; i < allNotes.length; i++) {
            if (allNotes[i].id === args.noteId) { note = allNotes[i]; break; }
          }
          if (!note) {
            resolve({ error: "未找到指定的笔记" });
            return;
          }

          // 2. 配图配置
          var config = resolveConfig();
          if (!config) {
            resolve({ error: "未配置图像生成 API，请先在设置中填写 API 地址与密钥" });
            return;
          }

          // 3. 构建 prompt：笔记纯文本（截断）+ 风格
          var text = plainText(note.content);
          if (!text) {
            resolve({ error: "笔记内容为空，无法配图" });
            return;
          }
          var styleKey = args.style && STYLES[args.style] ? args.style : "illustration";
          var styleSuffix = STYLES[styleKey] || "";
          var prompt = "根据以下随记内容创作一张配图。" + (styleSuffix ? "要求：" + styleSuffix + "。" : "") + "\n随记内容：" + text.substring(0, 400);
          var size = "1024x1024";

          // 4. 调图像生成 API
          var payload = {
            model: config.model,
            prompt: prompt,
            n: 1,
            size: size,
            response_format: "b64_json"
          };

          postJson(config.url, { Authorization: "Bearer " + config.key }, payload).then(function(data) {
            var img = extractImage(data);
            if (!img) {
              resolve({ error: "图像生成返回了空结果" });
              return;
            }
            // 5. 落盘并拿 imageId（Android 原生桥 / 浏览器 fallback）
            if (typeof ImageService !== "undefined" && ImageService.saveImages) {
              ImageService.saveImages([img.base64], args.noteId).then(function(results) {
                var saved = results && results[0];
                // Android：有 id → 走 https://appassets... 读取；浏览器：id 为空 → 直接内嵌 base64
                var src;
                if (saved && saved.id) {
                  src = "https://appassets.androidplatform.net/images/" + saved.id + ".jpg";
                } else if (saved && saved.path && saved.path.indexOf("data:") === 0) {
                  src = saved.path;
                } else {
                  resolve({ error: "图片保存失败" });
                  return;
                }
                // 6. 挂到笔记
                attachImageToNote(note, saved.id || "", src);
                saveNotes(allNotes);
                notifyUI(note.id, saved.id || "");
                resolve({ success: true, noteId: note.id, imageId: saved.id || "", imageSrc: src, style: styleKey, message: "配图已生成" });
              }, function(e) {
                resolve({ error: "图片保存失败: " + (e && e.message ? e.message : e) });
              });
            } else {
              resolve({ error: "图片存储不可用" });
            }
          }, function(e) {
            var msg = e && e.message ? e.message : String(e);
            if (msg.indexOf("timeout") !== -1) msg = "图像生成超时，请稍后再试";
            else if (msg.indexOf("http 4") === 0) msg = "图像生成失败：" + msg + "（请检查 API 地址、密钥或模型是否正确）";
            else if (msg.indexOf("http 5") === 0) msg = "图像生成服务暂时不可用（" + msg + "）";
            resolve({ error: msg });
          });
        } catch(e) {
          resolve({ error: e.message });
        }
      });
    }
  };
})();
