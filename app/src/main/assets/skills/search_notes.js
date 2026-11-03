// ─── search_notes Skill ───
// 混合 RAG：BM25 本地召回候选 → LLM 语义重排 → 紧凑索引返回。
// 不依赖 /embeddings；当前 opencode API 没有 embedding 模型时也能语义检索。
// 需要全文时，让模型继续调用 get_note(noteId)。
(function() {
  var indexCache = null;
  var rerankCache = {};

  function contentText(raw) {
    var content = String(raw || '');
    if (content.indexOf('--isHTML ') === 0) content = content.substring(9);
    return content
      .replace(/<img[^>]*>/gi, '[图片]')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function hashText(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  // 中文按 bigram 切分，英文/数字按词切分；兼顾 1 字查询。
  function tokenize(raw) {
    var s = contentText(raw).toLowerCase();
    var tokens = [];
    var latin = s.match(/[a-z0-9_]+/g) || [];
    for (var i = 0; i < latin.length; i++) tokens.push(latin[i]);
    var runs = s.match(/[一-鿿]+/g) || [];
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      if (run.length === 1) tokens.push(run);
      for (var j = 0; j < run.length - 1; j++) tokens.push(run.slice(j, j + 2));
    }
    return tokens;
  }

  function buildIndex(notes) {
    var keyParts = [];
    for (var i = 0; i < notes.length; i++) {
      keyParts.push(notes[i].id + ':' + hashText(String(notes[i].content || '')));
    }
    var key = keyParts.join('|');
    if (indexCache && indexCache.key === key) return indexCache;

    var docs = [];
    var df = {};
    var totalLen = 0;
    for (var n = 0; n < notes.length; n++) {
      var tokens = tokenize(notes[n].content);
      var tf = {};
      for (var t = 0; t < tokens.length; t++) tf[tokens[t]] = (tf[tokens[t]] || 0) + 1;
      docs.push({ note: notes[n], tf: tf, len: tokens.length });
      totalLen += tokens.length;
      for (var term in tf) {
        if (tf.hasOwnProperty(term)) df[term] = (df[term] || 0) + 1;
      }
    }
    indexCache = {
      key: key,
      docs: docs,
      df: df,
      avgLen: docs.length ? totalLen / docs.length : 0,
      N: docs.length
    };
    return indexCache;
  }

  function bm25(query, notes) {
    var idx = buildIndex(notes);
    var qTokens = [];
    var seen = {};
    var rawTokens = tokenize(query);
    for (var i = 0; i < rawTokens.length; i++) {
      if (!seen[rawTokens[i]]) { seen[rawTokens[i]] = 1; qTokens.push(rawTokens[i]); }
    }
    var k1 = 1.2, b = 0.75;
    var results = [];
    for (var d = 0; d < idx.docs.length; d++) {
      var doc = idx.docs[d];
      var score = 0;
      for (var q = 0; q < qTokens.length; q++) {
        var term = qTokens[q];
        var f = doc.tf[term] || 0;
        if (!f) continue;
        var n = idx.df[term] || 0;
        var idf = Math.log(1 + (idx.N - n + 0.5) / (n + 0.5));
        score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (doc.len / (idx.avgLen || 1))));
      }
      if (score > 0) results.push({ note: doc.note, score: score });
    }
    results.sort(function(a, b) { return b.score - a.score; });
    return results;
  }

  // 当 BM25 召回不足时，补最近/最早的笔记，给 LLM 重排器更多语义候选。
  function addFallbackCandidates(scored, notes, target) {
    var out = scored.slice(0, target);
    var seen = {};
    for (var i = 0; i < out.length; i++) seen[out[i].note.id] = 1;
    var byDate = notes.slice().sort(function(a, b) {
      return (new Date(b.createdAt || 0).getTime() || 0) - (new Date(a.createdAt || 0).getTime() || 0);
    });
    for (var j = 0; j < byDate.length && out.length < target; j++) {
      if (!seen[byDate[j].id]) { seen[byDate[j].id] = 1; out.push({ note: byDate[j], score: 0 }); }
    }
    var byOld = byDate.slice().reverse();
    for (var k = 0; k < byOld.length && out.length < target; k++) {
      if (!seen[byOld[k].id]) { seen[byOld[k].id] = 1; out.push({ note: byOld[k], score: 0 }); }
    }
    return out;
  }

  function mergeVectorCandidates(base, vector) {
    var map = {};
    var maxB = 1;
    for (var b = 0; b < base.length; b++) if ((base[b].score || 0) > maxB) maxB = base[b].score;
    for (var i = 0; i < base.length; i++) {
      var bc = base[i];
      map[bc.note.id] = { note: bc.note, bm25: bc.score || 0, vec: 0, match: bc.score ? 'bm25' : 'recent', rankB: i };
    }
    var vec = vector || [];
    for (var j = 0; j < vec.length; j++) {
      var vc = vec[j];
      var id = vc.note.id;
      if (!map[id]) map[id] = { note: vc.note, bm25: 0, vec: 0, match: 'vector', rankB: 999 };
      map[id].vec = Math.max(map[id].vec || 0, vc.score || 0);
      map[id].rankV = j;
      if (map[id].bm25) map[id].match = 'hybrid';
    }
    var arr = Object.keys(map).map(function(k) { return map[k]; });
    for (var a = 0; a < arr.length; a++) {
      var bm = arr[a].bm25 ? arr[a].bm25 / maxB : 0;
      arr[a].score = (arr[a].vec || 0) * 0.65 + bm * 0.35;
    }
    arr.sort(function(x, y) { return y.score - x.score; });
    return arr.slice(0, 24);
  }

  function parseIds(text) {
    var s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '');
    s = s.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start === -1 || end <= start) return [];
    try {
      var obj = JSON.parse(s.substring(start, end + 1));
      return Array.isArray(obj.ids) ? obj.ids : [];
    } catch (e) { return []; }
  }

  function rerankWithLLM(query, candidates, settings) {
    if (!candidates.length || !settings || !settings.apiUrl || !settings.apiKey) {
      return Promise.resolve(candidates);
    }
    if (typeof NativeHttp === 'undefined' || !NativeHttp.postJson || !NativeHttp.chatEndpoint) {
      return Promise.resolve(candidates);
    }
    var cacheKey = query + '|' + (indexCache ? indexCache.key : '') + '|' + candidates.length;
    if (rerankCache[cacheKey]) {
      var cachedIds = rerankCache[cacheKey];
      var byId = {};
      candidates.forEach(function(c) { byId[c.note.id] = c; });
      var cached = [];
      cachedIds.forEach(function(id) { if (byId[id]) { cached.push(byId[id]); delete byId[id]; } });
      candidates.forEach(function(c) { if (byId[c.note.id]) cached.push(c); });
      return Promise.resolve(cached);
    }

    var payloadCandidates = candidates.slice(0, 24).map(function(c) {
      return {
        id: c.note.id,
        date: String(c.note.createdAt || '').slice(0, 10),
        preview: contentText(c.note.content).substring(0, 100)
      };
    });
    var system = '你是笔记检索重排器。根据用户查询，从候选笔记中选出语义最相关的笔记。\n' +
      '候选可能词面不重合但语义相关，例如查询「自我觉察」可能对应「反思」「认识自己」「情绪模式」「复盘」。\n' +
      '只输出 JSON：{"ids":["id1","id2",...]}，按相关性从高到低，最多 8 个；没有相关笔记就输出 {"ids":[]}。\n' +
      '不要输出解释、Markdown 或代码块。';
    var user = '查询：' + query + '\n\n候选：\n' + JSON.stringify(payloadCandidates);
    var payload = {
      model: settings.model || 'gpt-4o',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.1,
      max_tokens: 400
    };

    return new Promise(function(resolve) {
      try {
        NativeHttp.postJson(NativeHttp.chatEndpoint(settings.apiUrl),
          { Authorization: 'Bearer ' + settings.apiKey }, payload).then(function(data) {
          var text = data && data.choices && data.choices[0] && data.choices[0].message &&
            data.choices[0].message.content;
          var ids = parseIds(text);
          if (!ids.length) { resolve(candidates); return; }
          rerankCache[cacheKey] = ids;
          var byId = {};
          candidates.forEach(function(c) { byId[c.note.id] = c; });
          var out = [];
          ids.forEach(function(id) { if (byId[id]) { out.push(byId[id]); delete byId[id]; } });
          candidates.forEach(function(c) { if (byId[c.note.id]) out.push(c); });
          resolve(out);
        }, function() { resolve(candidates); });
      } catch (e) { resolve(candidates); }
    });
  }

  function pageResults(ranked, args, reranked, query, meta) {
    var offset = Math.max(0, parseInt(args.offset, 10) || 0);
    var limit = Math.max(1, Math.min(8, parseInt(args.limit, 10) || 8));
    var page = ranked.slice(offset, offset + limit);
    var notes = page.map(function(item) {
      var text = contentText(item.note.content);
      var out = {
        id: item.note.id,
        date: String(item.note.createdAt || '').slice(0, 10),
        preview: text.substring(0, 50),
        tags: (text.match(/#([^\s<]+)/g) || []).map(function(t) { return t.substring(1); }).slice(0, 4),
        score: Math.round((item.score || 0) * 100) / 100,
        match: item.match || 'recent'
      };
      if (query && typeof window.__addNoteRef === 'function') {
        window.__addNoteRef({ id: out.id, date: out.date, preview: text.substring(0, 100) });
      }
      return out;
    });
    var out = {
      query: query || '',
      reranked: !!reranked,
      total: ranked.length,
      offset: offset,
      returned: notes.length,
      hasMore: offset + notes.length < ranked.length,
      notes: notes
    };
    if (meta) out.rag = meta;
    return out;
  }

  window.searchNotesSkill = {
    definition: {
      name: "search_notes",
      description: "仅在用户表达回忆/自我觉察/情绪梳理等主观意图时使用；普通寒暄与事实问答不要调用。三级 RAG：Qwen3-Embedding 向量召回 + BM25 + Qwen3-Reranker 语义重排；未配置 embedding 时退回 BM25 + LLM 重排。返回紧凑索引（id、日期、50字预览、标签、score），带 total/offset/hasMore 和 rag 索引状态。默认最多 8 条；用 offset 翻页，用 query/tags/days 缩小范围；需要全文时用 get_note(noteId)。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "内容关键词或语义查询，如「自我觉察」「最近让我焦虑的事」" },
          tags: { type: "array", items: { type: "string" }, description: "按标签筛选，如 ['情绪', '工作', '日常']" },
          days: { type: "number", description: "最近 N 天的笔记（从今天往前推）" },
          offset: { type: "number", description: "从第几条开始返回，默认 0；配合 hasMore 翻页" },
          limit: { type: "number", description: "最多返回条数，默认 8，最大 8；需要更多请用 offset 翻页" },
          rerank: { type: "boolean", description: "是否做语义重排，默认 true；设为 false 只做向量/BM25 召回" }
        }
      }
    },

    execute: function(args) {
      args = args || {};
      var allNotes = window.DataService.notes.load();
      if (!allNotes || !allNotes.length) {
        return { query: args.query || '', reranked: false, total: 0, offset: 0, returned: 0, hasMore: false, notes: [] };
      }

      var filtered = allNotes.slice();
      if (args.days) {
        var days = Number(args.days);
        if (isFinite(days) && days > 0) {
          var cutoff = Date.now() - days * 86400000;
          filtered = filtered.filter(function(n) {
            return new Date(n.createdAt).getTime() > cutoff;
          });
        }
      }
      if (args.tags && args.tags.length > 0) {
        filtered = filtered.filter(function(n) {
          var content = String(n.content || '');
          if (content.indexOf('--isHTML ') === 0) content = content.substring(9);
          return args.tags.some(function(tag) {
            var regex = new RegExp('#' + String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|<|$|/)');
            return regex.test(content);
          });
        });
      }

      if (!args.query) {
        var recent = filtered.slice().sort(function(a, b) {
          return (new Date(b.createdAt || 0).getTime() || 0) - (new Date(a.createdAt || 0).getTime() || 0);
        }).map(function(n) { return { note: n, score: 0, match: 'recent' }; });
        return pageResults(recent, args, false, '');
      }

      var scored = bm25(args.query, filtered);
      var candidates = addFallbackCandidates(scored, filtered, 24);
      for (var i = 0; i < candidates.length; i++) {
        if (candidates[i].score > 0) candidates[i].match = 'bm25';
      }

      var settings = null;
      try { settings = window.DataService.settings.load(); } catch (e) {}

      var rag = window.NoteRAG;
      var ragOn = !!(rag && typeof rag.enabled === 'function' && rag.enabled());
      var ragPromise = Promise.resolve({ items: [], meta: null });
      if (ragOn) {
        ragPromise = rag.ensureIndex(filtered, { maxNew: 64 }).then(function(stats) {
          if (!stats || !stats.ok) return { items: [], meta: stats };
          return rag.search(args.query, filtered, 24).then(function(items) {
            return { items: items || [], meta: stats };
          });
        }, function() { return { items: [], meta: null }; });
      }

      return ragPromise.then(function(v) {
        var merged = mergeVectorCandidates(candidates, v.items);
        var meta = {
          ragEnabled: ragOn,
          ragIndexed: v.meta && v.meta.indexed != null ? v.meta.indexed : null,
          ragTotal: v.meta && v.meta.total != null ? v.meta.total : null
        };
        if (args.rerank === false) return pageResults(merged, args, false, args.query, meta);

        var rerankPromise = ragOn ? rag.rerank(args.query, merged, 24) : Promise.resolve(null);
        return rerankPromise.then(function(rr) {
          if (rr && rr.length) {
            for (var r = 0; r < rr.length; r++) {
              if (!rr[r].match || rr[r].match === 'bm25' || rr[r].match === 'vector') rr[r].match = 'rerank';
            }
            return pageResults(rr, args, true, args.query, meta);
          }
          return rerankWithLLM(args.query, merged, settings).then(function(ranked) {
            for (var j = 0; j < ranked.length; j++) {
              if (ranked[j].match === 'bm25' || ranked[j].match === 'vector' || ranked[j].match === 'hybrid') {
                ranked[j].match = 'semantic';
              }
            }
            return pageResults(ranked, args, true, args.query, meta);
          });
        });
      });
    }
  };
})();
