// ─── list_insight_modes Skill ───
// 让念念了解有哪些洞察模式可用
(function() {
  window.listInsightModesSkill = {
    definition: {
      name: "list_insight_modes",
      description: "列出所有可用的洞察分析模式，包括名称和描述。用在你想对笔记进行深度分析之前，先看看有哪些模式可以选择。",
      parameters: {
        type: "object",
        properties: {}
      }
    },

    execute: function() {
      if (typeof window.getInsightMethods !== "function") {
        return { error: "洞察系统不可用" };
      }
      var methods = window.getInsightMethods();
      return methods.map(function(m) {
        return { id: m.id, name: m.name, desc: m.desc };
      });
    }
  };
})();
