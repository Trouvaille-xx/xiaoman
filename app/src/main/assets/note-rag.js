// ─── NoteRAG：笔记向量索引 + 语义召回 + Qwen3-Reranker ───
// 依赖 NativeHttp 与 DataService。向量以 int8 量化 + base64 存在 localStorage，
// 1024 维约 1.4KB/条。未配置 embedding key 时 search_notes 会回退到 BM25。
(function() {
  var STORE_KEY = 'nian_note_rag_v1';
  var DEFAULT_EMB_URL = 'https://api.siliconflow.cn/v1/embeddings';
  var DEFAULT_EMB_MODEL = 'Qwen/Qwen3-Embedding-8B';
  var DEFAULT_RERANK_URL = 'https://api.siliconflow.cn/v1/rerank';
  var DEFAULT_RERANK_MODEL = 'Qwen/Qwen3-Reranker-8B';
  var DEFAULT_DIM = 1024;
  var BATCH = 16;
  var MAX_INDEX = 3000;
  var queryCache = {};
  var indexingPromise = null;

  function settings() {
    try {
      return (window.DataService && window.DataService.settings && window.DataService.settings.load()) || {};
    } catch (e) { return {}; }
  }

  function config() {
    var s = settings();
    var key = s.embeddingApiKey || '';
    var dim = parseInt(s.embeddingDimensions, 10);
    return {
      key: key,
      embUrl: s.embeddingApiUrl || DEFAULT_EMB_URL,
      embModel: s.embeddingModel || DEFAULT_EMB_MODEL,
      rerankUrl: s.rerankApiUrl || DEFAULT_RERANK_URL,
      rerankModel: s.rerankModel || DEFAULT_RERANK_MODEL,
      dim: (isFinite(dim) && dim >= 128 && dim <= 4096) ? dim : DEFAULT_DIM,
      enabled: s.ragEnabled !== false
    };
  }

  function enabled() {
    var c = config();
    return !!(c.enabled && c.key && c.embUrl && c.embModel);
  }

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

  function textFor(note) {
    return contentText(note && note.content).substring(0, 1500);
  }

  function hashText(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function loadStore() {
    var c = config();
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var store = raw ? JSON.parse(raw) : null;
      if (store && store.model === c.embModel && store.dim === c.dim) return store;
    } catch (e) {}
    return { version: 1, model: c.embModel, dim: c.dim, items: {} };
  }

  function saveStore(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); return true; }
    catch (e) { return false; }
  }

  function quantize(vec) {
    var sum = 0;
    for (var i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
    var norm = Math.sqrt(sum) || 1;
    var out = [];
    for (var j = 0; j < vec.length; j++) {
      out.push(Math.max(-127, Math.min(127, Math.round((vec[j] / norm) * 127))));
    }
    return out;
  }

  function encodeVec(arr) {
    var u = new Uint8Array(arr.length);
    for (var i = 0; i < arr.length; i++) u[i] = arr[i] & 255;
    var s = '';
    for (var j = 0; j < u.length; j++) s += String.fromCharCode(u[j]);
    return btoa(s);
  }

  function decodeVec(b64) {
    var s = atob(b64);
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return new Int8Array(u.buffer);
  }

  function cosineInt8(a, b) {
    var n = Math.min(a.length, b.length);
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < n; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function postEmbedding(c, texts) {
    if (typeof NativeHttp === 'undefined' || !NativeHttp.postJson) {
      return Promise.reject(new Error('NativeHttp unavailable'));
    }
    var body = { model: c.embModel, input: texts, encoding_format: 'float', dimensions: c.dim };
    return NativeHttp.postJson(c.embUrl, { Authorization: 'Bearer ' + c.key }, body).then(function(data) {
      var rows = data && data.data;
      if (!rows || !rows.length) throw new Error('empty embedding response');
      rows.sort(function(a, b) { return (a.index || 0) - (b.index || 0); });
      var vectors = [];
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i].embedding || !rows[i].embedding.length) throw new Error('missing embedding');
        vectors.push(rows[i].embedding);
      }
      if (vectors.length !== texts.length) throw new Error('embedding count mismatch');
      return vectors;
    });
  }

  function embedBatch(texts) {
    var c = config();
    if (!c.key) return Promise.reject(new Error('embedding key missing'));
    return postEmbedding(c, texts);
  }

  function currentNotes(notes) {
    var out = [];
    for (var i = 0; i < notes.length; i++) {
      if (notes[i] && notes[i].id && contentText(notes[i].content)) out.push(notes[i]);
    }
    out.sort(function(a, b) {
      return (new Date(b.createdAt || 0).getTime() || 0) - (new Date(a.createdAt || 0).getTime() || 0);
    });
    return out.slice(0, MAX_INDEX);
  }

  function doEnsureIndex(notes, opts) {
    opts = opts || {};
    var c = config();
    if (!enabled()) {
      return Promise.resolve({ ok: false, error: 'not-configured', indexed: 0, total: notes.length });
    }
    var list = currentNotes(notes);
    var store = loadStore();
    var missing = [];
    for (var i = 0; i < list.length; i++) {
      var item = store.items[list[i].id];
      if (!item || item.h !== hashText(textFor(list[i]))) missing.push(list[i]);
    }
    var total = list.length;
    if (!missing.length) {
      return Promise.resolve({ ok: true, indexed: Object.keys(store.items).length, total: total, embedded: 0 });
    }
    var maxNew = opts.maxNew == null ? missing.length : Math.max(0, Math.min(missing.length, opts.maxNew));
    var todo = missing.slice(0, maxNew);
    if (!todo.length) {
      return Promise.resolve({ ok: true, indexed: Object.keys(store.items).length, total: total, embedded: 0, missing: missing.length });
    }

    var done = 0;
    function next() {
      if (done >= todo.length) {
        return Promise.resolve({ ok: true, indexed: Object.keys(store.items).length, total: total, embedded: done, missing: missing.length - done });
      }
      var batch = todo.slice(done, done + BATCH);
      var texts = batch.map(textFor);
      return embedBatch(texts).then(function(vectors) {
        for (var b = 0; b < batch.length; b++) {
          store.items[batch[b].id] = {
            h: hashText(textFor(batch[b])),
            v: encodeVec(quantize(vectors[b]))
          };
        }
        if (!saveStore(store)) throw new Error('localStorage quota exceeded');
        done += batch.length;
        if (opts.onProgress) {
          try { opts.onProgress(done, todo.length); } catch (e) {}
        }
        return next();
      });
    }
    return next().catch(function(e) {
      return { ok: false, error: e.message || String(e), indexed: Object.keys(store.items).length, total: total, embedded: done };
    });
  }

  function ensureIndex(notes, opts) {
    if (indexingPromise) return indexingPromise;
    indexingPromise = doEnsureIndex(notes, opts).then(function(r) {
      indexingPromise = null;
      return r;
    }, function(e) {
      indexingPromise = null;
      return { ok: false, error: e.message || String(e), indexed: 0, total: notes.length };
    });
    return indexingPromise;
  }

  function rebuildIndex(notes, onProgress) {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    queryCache = {};
    var wait = indexingPromise || Promise.resolve();
    return wait.then(function() {
      return ensureIndex(notes, { maxNew: notes.length, onProgress: onProgress });
    });
  }

  function search(query, notes, topK) {
    var c = config();
    if (!enabled() || !query) return Promise.resolve([]);
    var store = loadStore();
    var ids = Object.keys(store.items);
    if (!ids.length) return Promise.resolve([]);
    var cacheKey = c.embModel + '|' + c.dim + '|' + query;
    var qPromise = queryCache[cacheKey]
      ? Promise.resolve(queryCache[cacheKey])
      : embedBatch([query]).then(function(vectors) {
          var q = quantize(vectors[0]);
          queryCache[cacheKey] = q;
          return q;
        });
    return qPromise.then(function(qVec) {
      var byId = {};
      for (var i = 0; i < notes.length; i++) byId[notes[i].id] = notes[i];
      var results = [];
      for (var j = 0; j < ids.length; j++) {
        var id = ids[j];
        var note = byId[id];
        if (!note) continue;
        var item = store.items[id];
        if (!item || item.h !== hashText(textFor(note))) continue;
        var score = cosineInt8(qVec, decodeVec(item.v));
        results.push({ note: note, score: score, match: 'vector' });
      }
      results.sort(function(a, b) { return b.score - a.score; });
      return results.slice(0, topK || 24);
    }, function() { return []; });
  }

  function rerank(query, candidates, topN) {
    var c = config();
    if (!enabled() || !c.rerankUrl || !c.rerankModel || !candidates.length) return Promise.resolve(null);
    if (typeof NativeHttp === 'undefined' || !NativeHttp.postJson) return Promise.resolve(null);
    var list = candidates.slice(0, 24);
    var docs = list.map(function(x) { return textFor(x.note).substring(0, 800); });
    var body = {
      model: c.rerankModel,
      query: query,
      documents: docs,
      top_n: Math.min(topN || 8, docs.length),
      return_documents: false
    };
    return NativeHttp.postJson(c.rerankUrl, { Authorization: 'Bearer ' + c.key }, body).then(function(data) {
      var rows = data && data.results;
      if (!rows || !rows.length) return null;
      rows.sort(function(a, b) { return (b.relevance_score || 0) - (a.relevance_score || 0); });
      var out = [];
      var used = {};
      for (var i = 0; i < rows.length; i++) {
        var idx = rows[i].index;
        if (idx == null || !list[idx] || used[idx]) continue;
        used[idx] = 1;
        var item = list[idx];
        item.score = rows[i].relevance_score || 0;
        item.match = 'rerank';
        out.push(item);
      }
      return out.length ? out : null;
    }, function() { return null; });
  }

  function stats(notes) {
    var c = config();
    var store = loadStore();
    var list = currentNotes(notes);
    var indexed = 0;
    for (var i = 0; i < list.length; i++) {
      var item = store.items[list[i].id];
      if (item && item.h === hashText(textFor(list[i]))) indexed++;
    }
    return { enabled: enabled(), indexed: indexed, total: list.length, model: c.embModel, dim: c.dim };
  }

  window.NoteRAG = {
    enabled: enabled,
    config: config,
    ensureIndex: ensureIndex,
    rebuildIndex: rebuildIndex,
    search: search,
    rerank: rerank,
    stats: stats
  };
})();
