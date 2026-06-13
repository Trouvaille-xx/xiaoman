// ─── 念念认证模块 ───
// 原 APK 没有 AndroidApi/AndroidAuth Bridge，只能用 AndroidHttp.get (HttpURLConnection)
// 服务器提供 GET 版本的 auth 端点（query 参数），绕开 WebView fetch 在 file:// 下的限制
// token 存在 AndroidSettings SharedPreferences 里

(function() {
  // 硬编码后端地址（Kotlin 注入的 window.__NianBackend 在页面加载后才设置，
  // 所以 auth.js 不能依赖它。但 Kotlin injectBackendConfig 会在 loadUrl 后执行，
  // 之后 getNianToken 会用到它。这里直接硬编码）
  var BACKEND = 'http://115.159.116.240:3456';

  function getBackendUrl() {
    var url = (window.__NianBackend && window.__NianBackend.url) || '';
    // 如果是模拟器默认地址或占位符，回退到真实服务器 IP
    if (!url || url.indexOf('10.0.2.2') !== -1 || url.indexOf('your-tencent-cloud') !== -1) {
      return BACKEND;
    }
    return url;
  }

  function getBackendBaseUrl() {
    // BACKEND_URL 末尾可能带 /v1（OpenAI 兼容路径），但 auth 用 /api/v1/*
    var url = getBackendUrl();
    return url.replace(/\/v\d+$/, '');
  }

  // ─── Token 存储：用 AndroidSettings（已存在），字段 nian_auth ───

  function readAuth() {
    try {
      if (typeof AndroidSettings === 'undefined' || !AndroidSettings) {
        return { token: '', user_id: '', username: '' };
      }
      var raw = AndroidSettings.loadSettings();
      if (!raw) return { token: '', user_id: '', username: '' };
      var s = JSON.parse(raw);
      return {
        token: s.nian_auth_token || '',
        user_id: s.nian_auth_user_id || '',
        username: s.nian_auth_username || ''
      };
    } catch (e) {
      return { token: '', user_id: '', username: '' };
    }
  }

  function writeAuth(token, userId, username) {
    if (typeof AndroidSettings === 'undefined' || !AndroidSettings) return;
    try {
      var raw = AndroidSettings.loadSettings();
      var s = raw ? JSON.parse(raw) : {};
      s.nian_auth_token = token || '';
      s.nian_auth_user_id = userId || '';
      s.nian_auth_username = username || '';
      AndroidSettings.saveSettings(JSON.stringify(s));
    } catch (e) {
      console.error('[auth] writeAuth failed:', e.message);
    }
  }

  function clearAuth() {
    if (typeof AndroidSettings === 'undefined' || !AndroidSettings) return;
    try {
      var raw = AndroidSettings.loadSettings();
      var s = raw ? JSON.parse(raw) : {};
      delete s.nian_auth_token;
      delete s.nian_auth_user_id;
      delete s.nian_auth_username;
      AndroidSettings.saveSettings(JSON.stringify(s));
    } catch (e) {}
  }

  // ─── UI 交互 ───

  function showOverlay() {
    var el = document.getElementById('authOverlay');
    if (el) el.style.display = 'flex';
  }

  function hideOverlay() {
    var el = document.getElementById('authOverlay');
    if (el) el.style.display = 'none';
  }

  function setStatus(text, type) {
    var el = document.getElementById('authStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-status' + (type ? ' ' + type : '');
  }

  window.authShowRegister = function() {
    document.getElementById('authLoginForm').style.display = 'none';
    document.getElementById('authRegisterForm').style.display = 'flex';
    document.getElementById('authSubtitle').textContent = '用邀请码注册新账号';
    setStatus('');
  };

  window.authShowLogin = function() {
    document.getElementById('authRegisterForm').style.display = 'none';
    document.getElementById('authLoginForm').style.display = 'flex';
    document.getElementById('authSubtitle').textContent = '登录后开启你的 AI 日记';
    setStatus('');
  };

  function setButtonsDisabled(disabled) {
    document.querySelectorAll('.auth-btn').forEach(function(b) { b.disabled = disabled; });
  }

  // ─── HTTP 调用：用 AndroidHttp.get 走原生 HttpURLConnection ───
  // Android WebView 在 file:// 下禁 fetch 和 XMLHttpRequest 跨域，
  // 但 AndroidHttp.get 是 Kotlin Bridge（原生 HttpURLConnection），完全绕过 WebView 限制。
  // 服务器已支持 GET 端点（query 参数）。

  function httpGet(url) {
    // Android 真机：原生 HttpURLConnection，无 CORS 限制
    if (typeof AndroidHttp !== 'undefined' && AndroidHttp && AndroidHttp.get) {
      console.log('[auth] AndroidHttp.get', url);
      var result = AndroidHttp.get(url);
      if (result === undefined || result === null || result === '') {
        throw new Error('网络请求无返回');
      }
      var data;
      try { data = JSON.parse(result); } catch (pe) {
        throw new Error('服务器返回非JSON: ' + result.substring(0, 100));
      }
      if (data.error) throw new Error(data.error);
      return data;
    }
    // 预览模式：同源 XHR（预览服务器代理 /api/* → 后端）
    console.log('[auth] XHR sync GET', url);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    try { xhr.send(); } catch(e) { throw new Error('网络请求失败'); }
    var data;
    try { data = JSON.parse(xhr.responseText || '{}'); } catch (pe) {
      throw new Error('服务器返回非JSON');
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  function callAuth(path, params) {
    var qs = [];
    for (var k in params) {
      if (params.hasOwnProperty(k)) {
        qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k] || ''));
      }
    }
    // 预览模式用相对路径（走代理），真机用绝对路径（走原生 HTTP）
    var base = (typeof AndroidHttp !== 'undefined' && AndroidHttp) ? getBackendBaseUrl() : '';
    var url = base + path + '?' + qs.join('&');
    return httpGet(url);
  }

  function updateMePage(username) {
    var nameEl = document.getElementById('meName');
    var subEl = document.getElementById('meSub');
    if (nameEl) {
      nameEl.textContent = username;
      nameEl.setAttribute('contenteditable', 'false');
    }
    if (subEl) {
      subEl.textContent = '已登录云端 · ' + username;
      subEl.setAttribute('contenteditable', 'false');
    }
  }

  window.authDoLogin = function() {
    var username = document.getElementById('authLoginUsername').value.trim();
    var password = document.getElementById('authLoginPassword').value;
    if (!username || !password) {
      setStatus('请填写用户名和密码', 'error');
      return;
    }
    setStatus('登录中...');
    setButtonsDisabled(true);
    try {
      var data = callAuth('/api/v1/auth/login', { username: username, password: password });
      writeAuth(data.token, data.user_id, data.username);
      updateMePage(data.username);
      setStatus('登录成功！欢迎 ' + data.username, 'success');
      setTimeout(function() { hideOverlay(); }, 300);
    } catch (e) {
      setStatus(e.message, 'error');
    } finally {
      setButtonsDisabled(false);
    }
  };

  window.authDoRegister = function() {
    var invite = document.getElementById('authRegInvite').value.trim();
    var username = document.getElementById('authRegUsername').value.trim();
    var password = document.getElementById('authRegPassword').value;
    if (!invite || !username || !password) {
      setStatus('邀请码、用户名、密码都不能为空', 'error');
      return;
    }
    setStatus('注册中...');
    setButtonsDisabled(true);
    try {
      var data = callAuth('/api/v1/auth/register', {
        invite_code: invite,
        username: username,
        password: password
      });
      writeAuth(data.token, data.user_id, data.username);
      updateMePage(data.username);
      setStatus('注册成功！欢迎来到念念', 'success');
      setTimeout(function() { hideOverlay(); }, 300);
    } catch (e) {
      setStatus(e.message, 'error');
    } finally {
      setButtonsDisabled(false);
    }
  };

  // ─── 获取邀请码（无需登录，支持预览模式） ───
  window.authFetchInvite = function() {
    var btn = document.querySelector('.auth-invite-btn');
    var input = document.getElementById('authRegInvite');
    if (!input) return;
    input.value = '获取中...';
    if (btn) { btn.disabled = true; btn.textContent = '获取中...'; }

    function done(data, err) {
      if (data && data.code) {
        input.value = data.code;
        setStatus('邀请码已填入：' + data.code, 'success');
      } else {
        input.value = '';
        setStatus(err || '获取邀请码失败', 'error');
      }
      if (btn) { btn.disabled = false; btn.textContent = '获取邀请码'; }
    }

    // Android 真机：用原生 HTTP bridge
    if (typeof AndroidHttp !== 'undefined' && AndroidHttp && AndroidHttp.get) {
      var absUrl = getBackendBaseUrl() + '/api/v1/auth/invite';
      try {
        var result = AndroidHttp.get(absUrl);
        if (!result) throw new Error('网络请求无返回');
        var data = JSON.parse(result);
        if (data.error) throw new Error(data.error);
        done(data);
      } catch(e) {
        done(null, e.message);
      }
      return;
    }

    // 预览模式：用相对路径，预览服务器代理到真实后端（无 CORS 问题）
    fetch('/api/v1/auth/invite')
      .then(function(r) { return r.json(); })
      .then(function(data) { done(data); })
      .catch(function(e) { done(null, e.message); });
  };


  // ─── 公开 API ───

  window.getNianToken = function() {
    return readAuth().token || '';
  };

  window.getNianUser = function() {
    return readAuth();
  };

  window.nianLogout = function() {
    clearAuth();
    showOverlay();
    authShowLogin();
  };

  // ─── 启动检查 ───

  function init() {
    var auth = readAuth();
    console.log('[auth] init, token=' + (auth.token ? auth.token.substring(0, 10) + '...' : '(empty)'));
    if (auth.token) {
      hideOverlay();
      updateMePage(auth.username || readAuth().username);
    } else {
      showOverlay();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
