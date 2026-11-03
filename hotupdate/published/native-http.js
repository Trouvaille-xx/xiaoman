// ─── NativeHttp: 统一网络通道 ───
// Android 端走 AndroidHttp.getAsync/postAsync 原生桥（后台线程 + 回调，无 CORS、不阻塞 JS 线程），
// 浏览器端回退 XHR/fetch。
(function() {
  var pending = {};
  var seq = 0;

  function nextId() {
    seq++;
    return "req_" + Date.now() + "_" + seq;
  }

  // 原生桥回调入口（MainActivity.HttpInterface 调用 window.NativeHttp.__onResponse；
  // 同时保留旧的 window.__onNativeHttpResponse 别名兼容）
  function handleNativeResponse(id, payload) {
    var p = pending[id];
    delete pending[id];
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    if (payload && payload.ok) {
      p.resolve(payload);
    } else {
      p.reject(new Error((payload && payload.error) || "unknown error"));
    }
  }
  window.__onNativeHttpResponse = handleNativeResponse;

  // 兼容两种回调名：MainActivity 用 NativeHttp.__onResponse，旧实现用 __onNativeHttpResponse
  function callBridge(fnName, args) {
    return new Promise(function(resolve, reject) {
      if (typeof AndroidHttp === "undefined" || AndroidHttp === null) {
        reject(new Error("no native bridge"));
        return;
      }
      var id = nextId();
      pending[id] = { resolve: resolve, reject: reject };
      var timer = setTimeout(function() {
        if (pending[id]) {
          delete pending[id];
          reject(new Error("请求超时（90s 未收到响应，请检查网络/API 配置）"));
        }
      }, 90000);
      pending[id].timer = timer;
      try {
        // 关键：必须通过 AndroidHttp 对象直接调用（不能变量引用），
        // Android 的 @JavascriptInterface 代理对象不支持 this 重新绑定。
        if (fnName === "getAsync") {
          AndroidHttp.getAsync(args[0], id);
        } else if (fnName === "getAsyncWithHeaders") {
          AndroidHttp.getAsyncWithHeaders(args[0], args[1], id);
        } else if (fnName === "postAsync") {
          AndroidHttp.postAsync(args[0], args[1], args[2], id);
        }
      } catch (e) {
        delete pending[id];
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  // 原生通道：返回 Promise<{ok, status?, data?, error?}>
  function getAsync(url) {
    if (typeof AndroidHttp !== "undefined" && AndroidHttp !== null) {
      return callBridge("getAsync", [url]);
    }
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url);
      xhr.timeout = 30000;
      xhr.ontimeout = function() { reject(new Error("Request timeout")); };
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, data: xhr.responseText });
        else reject(new Error("HTTP " + xhr.status + ": " + xhr.responseText.substring(0, 500)));
      };
      xhr.onerror = function() { reject(new Error("Network error")); };
      xhr.send();
    });
  }

  // OpenCode Zen 端点要求 x-opencode-session 路由头；会话 ID 持久化，避免每次请求换路由
  function withProviderHeaders(url, headers) {
    var h = {};
    var src = headers || {};
    for (var k in src) { if (src.hasOwnProperty(k)) h[k] = src[k]; }
    try {
      var host = new URL(url).hostname.toLowerCase();
      if (/(^|\.)opencode\.ai$/.test(host) && !h['x-opencode-session']) {
        var sid = null;
        try { sid = localStorage.getItem('nian_opencode_session'); } catch (e) {}
        if (!sid) {
          sid = 'niannote-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
          try { localStorage.setItem('nian_opencode_session', sid); } catch (e) {}
        }
        h['x-opencode-session'] = sid;
      }
    } catch (e) {}
    return h;
  }

  // 原生通道：返回 Promise<{ok, status?, data?, error?}>，data 为响应文本
  function postAsync(url, headers, body) {
    headers = withProviderHeaders(url, headers);
    if (typeof AndroidHttp !== "undefined" && AndroidHttp !== null) {
      return callBridge("postAsync", [
        url,
        JSON.stringify(headers || {}),
        typeof body === "string" ? body : JSON.stringify(body || {})
      ]);
    }
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      var h = headers || {};
      for (var k in h) {
        if (h.hasOwnProperty(k)) xhr.setRequestHeader(k, h[k]);
      }
      xhr.timeout = 60000;
      xhr.ontimeout = function() { reject(new Error("Request timeout")); };
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, status: xhr.status, data: xhr.responseText });
        else reject(new Error("HTTP " + xhr.status + ": " + xhr.responseText.substring(0, 500)));
      };
      xhr.onerror = function() { reject(new Error("Network error")); };
      xhr.send(typeof body === "string" ? body : JSON.stringify(body || {}));
    });
  }

  // 带请求头的 GET（拉取 /models 等）
  function getJson(url, headers) {
    if (typeof AndroidHttp !== "undefined" && AndroidHttp !== null) {
      return callBridge("getAsyncWithHeaders", [url, JSON.stringify(headers || {})]);
    }
    return fetch(url, { headers: headers || {} }).then(function(r) {
      return r.text().then(function(t) {
        if (r.status < 200 || r.status >= 300) throw new Error("HTTP " + r.status + ": " + t.substring(0, 500));
        return { ok: true, status: r.status, data: t };
      });
    });
  }

  // 便捷方法：POST 并解析 JSON，2xx 才 resolve；返回 Promise<解析后的对象或 {raw} >
  function postJson(url, headers, body) {
    return postAsync(url, headers, body).then(function(resp) {
      if (resp.ok && resp.status !== undefined && (resp.status < 200 || resp.status >= 300)) {
        throw new Error("HTTP " + resp.status + ": " + String(resp.data || "").substring(0, 500));
      }
      if (!resp.ok) throw new Error(resp.error || "unknown error");
      try {
        return JSON.parse(resp.data);
      } catch (e) {
        return { raw: resp.data };
      }
    });
  }

  // ─── API 端点归一化 ───
  // 用户会这样填：https://api.openai.com/v1 · https://api.openai.com/v1/ ·
  //              https://api.openai.com · https://api.deepseek.com/v1/chat/completions
  // 归一规则：已带具体端点就退回上一级（避免拼成 .../chat/completions/chat/completions）；
  //          只填主机名就补 /v1；?query 原样保留（兼容 Azure 风格 api-version）。
  function apiBase(raw) {
    var u = String(raw == null ? "" : raw).trim().replace(/\/+$/, "");
    if (!u) return "";
    var query = "";
    var qi = u.indexOf("?");
    if (qi !== -1) { query = u.slice(qi); u = u.slice(0, qi).replace(/\/+$/, ""); }
    u = u.replace(/\/(chat\/completions|completions|embeddings|images\/generations)$/i, "");
    var m = /^(https?:\/\/[^/?#]+)$/i.exec(u);
    if (m) u = m[1] + "/v1";
    return u + query;
  }

  function apiEndpoint(raw, path) {
    var base = apiBase(raw);
    if (!base) return "";
    var query = "";
    var qi = base.indexOf("?");
    if (qi !== -1) { query = base.slice(qi); base = base.slice(0, qi); }
    return base + path + query;
  }

  // 把底层报错翻译成「照着改就能好」的提示；第二参是实际请求的 URL（404 时打出来最关键）
  function explainError(err, url) {
    var msg = String((err && err.message) || err || "").trim();
    var m = /HTTP\s+(\d{3})/i.exec(msg);
    var code = m ? parseInt(m[1], 10) : 0;
    var at = url ? ("（实际请求 " + url + "）") : "";
    if (code === 401 || code === 403) return "密钥无效或没有权限（HTTP " + code + "）。检查 API 密钥是否填对、余额是否充足。";
    if (code === 404) return "地址不对（HTTP 404）" + at + "。多数服务要带 /v1，例如 https://api.deepseek.com/v1";
    if (code === 400) return "请求被拒绝（HTTP 400）" + at + "。最常见是「模型选择」里的名称该服务不支持。";
    if (code === 429) return "请求太频繁或额度用尽（HTTP 429），稍后再试。";
    if (code >= 500) return "对方服务出错（HTTP " + code + "），不是你的配置问题，稍后再试。";
    if (/timeout|超时/i.test(msg)) return "请求超时" + at + "。检查网络，或换一个更近的 API 地址。";
    if (/network error|failed to fetch|unknownhost|unable to resolve|no native bridge|connect|网络/i.test(msg)) return "连不上" + at + "。检查地址是否写错、手机是否联网。";
    return (msg || "未知错误") + at;
  }
  window.NativeHttp = {
    getAsync: getAsync,
    getJson: getJson,
    postAsync: postAsync,
    postJson: postJson,
    apiBase: apiBase,
    chatEndpoint: function(raw) { return apiEndpoint(raw, "/chat/completions"); },
    embeddingsEndpoint: function(raw) { return apiEndpoint(raw, "/embeddings"); },
    imageEndpoint: function(raw) { return apiEndpoint(raw, "/images/generations"); },
    explainError: explainError,
    // MainActivity.HttpInterface 异步桥回调入口
    __onResponse: handleNativeResponse
  };
})();
