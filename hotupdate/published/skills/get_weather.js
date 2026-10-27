// ─── get_weather Skill ───
(function() {
  window.getWeatherSkill = {
    definition: {
      name: "get_weather",
      description: "查询某个城市的实时天气。返回温度、天气状况等信息。",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "城市名称，如 北京、上海、东京、London"
          }
        },
        required: ["city"]
      }
    },

    execute: function(args) {
      if (!args || !args.city) return { error: "请指定城市" };
      var city = encodeURIComponent(args.city.trim());

      // Android 端：走原生异步 GET（后台线程，不阻塞 JS）；浏览器端：fetch
      var request = (typeof NativeHttp !== 'undefined' && typeof AndroidHttp !== 'undefined')
        ? NativeHttp.getAsync("https://wttr.in/" + city + "?format=j1").then(function(resp) {
            if (!resp.ok) throw new Error(resp.error || "request failed");
            return JSON.parse(resp.data);
          })
        : fetch("https://wttr.in/" + city + "?format=j1").then(function(r) { return r.json(); });

      return request.then(function(data) {
          var cc = data.current_condition && data.current_condition[0];
          if (cc) {
            return {
              city: args.city.trim(),
              weather: cc.temp_C + "°C," + cc.weatherDesc[0].value + "," + cc.humidity + "%湿度,风" + cc.windspeedKmph + "km/h"
            };
          }
          return { city: args.city.trim(), weather: "未知" };
        })
        .catch(function(e) {
          return { error: "获取天气失败: " + e.message };
        });
    }
  };
})();
