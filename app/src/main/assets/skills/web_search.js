// ─── web_search Skill ───
(function() {
  window.webSearchSkill = {
    definition: {
      name: "web_search",
      description: "搜索互联网，获取最新的网页信息。可以用来查新闻、百科、知识等。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词"
          }
        },
        required: ["query"]
      }
    },

    execute: function(args) {
      if (!args || !args.query) return { error: "请提供搜索关键词" };
      var query = encodeURIComponent(args.query);

      // 在 WebView 中用 AndroidHttp Bridge
      if (typeof AndroidHttp !== "undefined") {
        var raw = AndroidHttp.get("https://api.duckduckgo.com/?q=" + query + "&format=json&skip_disambig=1");
        try {
          var data = JSON.parse(raw);
          if (data.AbstractText) {
            return { query: args.query, result: data.AbstractText, source: data.AbstractSource || "" };
          }
          if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            var results = data.RelatedTopics.slice(0, 5).map(function(t) {
              return t.Text || (t.Result || "");
            }).filter(function(t) { return t; });
            return { query: args.query, results: results };
          }
          return { query: args.query, result: "未找到相关结果" };
        } catch(e) {
          return { error: "解析失败: " + e.message };
        }
      }

      // 浏览器 fallback：用 fetch
      return fetch("https://api.duckduckgo.com/?q=" + query + "&format=json&skip_disambig=1")
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.AbstractText) {
            return { query: args.query, result: data.AbstractText, source: data.AbstractSource || "" };
          }
          return { query: args.query, result: "未找到相关结果" };
        })
        .catch(function(e) {
          return { error: "搜索失败: " + e.message };
        });
    }
  };
})();
