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

      // Android 端：走原生异步 GET（后台线程，不阻塞 JS）；浏览器端：fetch
      var request = (typeof NativeHttp !== 'undefined' && typeof AndroidHttp !== 'undefined')
        ? NativeHttp.getAsync("https://api.duckduckgo.com/?q=" + query + "&format=json&skip_disambig=1").then(function(resp) {
            if (!resp.ok) throw new Error(resp.error || "request failed");
            return JSON.parse(resp.data);
          })
        : fetch("https://api.duckduckgo.com/?q=" + query + "&format=json&skip_disambig=1")
            .then(function(r) { return r.json(); });

      return request.then(function(data) {
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
        })
        .catch(function(e) {
          return { error: "搜索失败: " + e.message };
        });
    }
  };
})();
