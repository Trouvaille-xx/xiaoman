// ─── get_special_day Skill ───
// 今天是特别的日子吗：公历节日 + 用户设置的提醒事项。让小满能在节日主动问候。
(function() {
  // 公历固定节日表（月-日）
  var FIXED_DAYS = {
    '01-01': '元旦',
    '02-14': '情人节',
    '03-08': '妇女节',
    '03-12': '植树节',
    '04-01': '愚人节',
    '04-05': '清明节前后',
    '05-01': '劳动节',
    '05-04': '青年节',
    '06-01': '儿童节',
    '07-01': '建党节',
    '08-01': '建军节',
    '09-10': '教师节',
    '10-01': '国庆节',
    '10-24': '程序员日',
    '12-24': '平安夜',
    '12-25': '圣诞节',
    '01-05': '小寒', '01-20': '大寒', '02-04': '立春', '02-19': '雨水',
    '03-06': '惊蛰', '03-21': '春分', '04-05': '清明', '04-20': '谷雨',
    '05-06': '立夏', '05-21': '小满', '06-06': '芒种', '06-21': '夏至',
    '07-07': '小暑', '07-23': '大暑', '08-08': '立秋', '08-23': '处暑',
    '09-08': '白露', '09-23': '秋分', '10-08': '寒露', '10-23': '霜降',
    '11-07': '立冬', '11-22': '小雪', '12-07': '大雪', '12-22': '冬至'
  };

  function pad(n) { return String(n).padStart(2, '0'); }

  window.specialDaySkill = {
    definition: {
      name: "get_special_day",
      description: "查询今天是什么特别的日子（节日、节气）以及用户今天有哪些待办提醒。用在对话开场或用户问「今天是什么日子」时，用来送上节日问候或提醒。",
      parameters: {
        type: "object",
        properties: {}
      }
    },

    execute: function() {
      var now = new Date();
      var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
      var md = pad(now.getMonth() + 1) + '-' + pad(now.getDate());

      var days = [FIXED_DAYS[md]];
      if (days[0] === '清明节前后') days[0] = '清明时节';

      // 周末
      var weekdays = ['日', '一', '二', '三', '四', '五', '六'];
      var weekday = '星期' + weekdays[now.getDay()];

      // 今天到期且未完成的提醒
      var dueToday = [];
      if (typeof MemoryService !== 'undefined' && typeof MemoryService.dueReminders === 'function') {
        var due = MemoryService.dueReminders(today);
        dueToday = due.map(function(r) { return r.text; }).slice(0, 5);
      }

      var result = { date: today, weekday: weekday, special: days[0] ? days[0] : null, dueToday: dueToday };

      // 生日相关：识别 user 档案中的生日（MM-DD 匹配）
      try {
        var mem = MemoryService.load();
        var userFile = mem && mem.files && mem.files.user ? mem.files.user : '';
        var bd = userFile.match(/生日[：:]\s*(\d{1,2})[月\/-](\d{1,2})/);
        if (bd) {
          var bdStr = pad(parseInt(bd[1], 10)) + '-' + pad(parseInt(bd[2], 10));
          if (bdStr === md) result.special = '🎂 用户的生日';
        }
      } catch(e) {}

      return result;
    }
  };
})();
