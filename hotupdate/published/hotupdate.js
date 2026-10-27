// ─── HotUpdate: 热更新客户端 ───
// 从 LAN 推送服务器拉取 manifest，差量下载变更文件到原生暂存区(AndroidUpdate 桥)，
// 全部成功后原子切换生效并刷新页面。仅 App 内可用(依赖 AndroidUpdate + NativeHttp)。
// 服务端: 仓库根目录 hotupdate/server.js + hotupdate/push.js
(function() {
  'use strict';

  function localInfo() {
    try {
      return JSON.parse(AndroidUpdate.getLocalInfo());
    } catch (e) {
      return { version: '', files: [] };
    }
  }

  function fetchManifest(serverUrl) {
    var url = serverUrl.replace(/\/+$/, '') + '/manifest.json';
    return NativeHttp.getAsync(url).then(function(resp) {
      if (!resp.ok) throw new Error(resp.error || ('HTTP ' + resp.status));
      var m = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
      if (!m || !m.version || !Array.isArray(m.files)) throw new Error('清单格式错误');
      return m;
    });
  }

  function downloadFile(serverUrl, relPath) {
    var url = serverUrl.replace(/\/+$/, '') + '/files/' +
        relPath.split('/').map(encodeURIComponent).join('/');
    return NativeHttp.getAsync(url).then(function(resp) {
      if (!resp.ok) throw new Error(relPath + ': ' + (resp.error || ('HTTP ' + resp.status)));
      return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    });
  }

  // 差量:远端清单里 hash 与本地不同(或本地没有)的文件
  function computeChanged(localFiles, remoteFiles) {
    var changed = [];
    for (var i = 0; i < remoteFiles.length; i++) {
      var f = remoteFiles[i];
      if (!localFiles[f.path] || localFiles[f.path] !== f.hash) changed.push(f);
    }
    return changed;
  }

  // JS 字符串的 UTF-8 字节数(用于校验下载完整性)
  function utf8Bytes(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  // 主流程:检查并应用更新。resolve({updated:true,count,version}) 或 ({updated:false,version})
  function checkAndApply(serverUrl) {
    if (typeof AndroidUpdate === 'undefined' || AndroidUpdate === null) {
      return Promise.reject(new Error('当前环境不支持热更新(需在 App 内运行)'));
    }
    if (typeof NativeHttp === 'undefined') {
      return Promise.reject(new Error('缺少 NativeHttp'));
    }
    var base = serverUrl.replace(/\/+$/, '');
    var local = localInfo();
    var localMap = {};
    (local.files || []).forEach(function(f) { localMap[f.path] = f.hash; });

    return fetchManifest(base).then(function(manifest) {
      if (manifest.version === local.version) {
        return { updated: false, reason: 'latest', version: manifest.version };
      }
      var changed = computeChanged(localMap, manifest.files);
      if (!AndroidUpdate.beginApply()) throw new Error('无法开始应用更新');
      var idx = 0;
      function next() {
        if (idx >= changed.length) {
          if (!AndroidUpdate.commitApply(manifest.version, JSON.stringify(manifest))) {
            throw new Error('应用更新失败(切换目录)');
          }
          return { updated: true, count: changed.length, version: manifest.version };
        }
        var f = changed[idx++];
        return downloadFile(base, f.path).then(function(text) {
          if (f.size != null && utf8Bytes(text) !== f.size) {
            throw new Error(f.path + ' 下载不完整');
          }
          if (!AndroidUpdate.saveHotfixFile(f.path, text)) {
            throw new Error('写入失败: ' + f.path);
          }
          return next();
        });
      }
      return next();
    });
  }

  // ─── App(APK) 自更新 ───
  // 已安装 APK 的版本信息；旧包没有该桥方法时返回 null(视为不支持应用内更新)
  function appVersion() {
    try {
      if (typeof AndroidUpdate === 'undefined' || typeof AndroidUpdate.getAppVersion !== 'function') return null;
      return JSON.parse(AndroidUpdate.getAppVersion());
    } catch (e) {
      return null;
    }
  }

  // 纯函数：比较本地/服务端 APK 版本，便于单测
  function apkUpdateInfo(local, remote) {
    var localCode = (local && typeof local.versionCode === 'number') ? local.versionCode : 0;
    var remoteCode = (remote && typeof remote.versionCode === 'number') ? remote.versionCode : 0;
    return {
      hasUpdate: remoteCode > localCode,
      versionCode: remoteCode,
      versionName: (remote && remote.versionName) || '',
      size: (remote && remote.size) || 0,
      localVersionCode: localCode,
      localVersionName: (local && local.versionName) || ''
    };
  }

  // 问服务端有没有更新的 APK（只拉几十字节元信息，不下载安装包）
  function checkApk(serverUrl) {
    var local = appVersion();
    if (local === null) {
      return Promise.reject(new Error('当前 APK 不支持应用内更新，请用「下载 APK 安装包」'));
    }
    if (typeof NativeHttp === 'undefined') {
      return Promise.reject(new Error('缺少 NativeHttp'));
    }
    var base = serverUrl.replace(/\/+$/, '');
    return NativeHttp.getAsync(base + '/apk.json').then(function(resp) {
      if (!resp.ok) throw new Error(resp.error || ('HTTP ' + resp.status));
      var info = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
      if (!info || !info.ok) throw new Error((info && info.error) || '服务端没有可用的 APK');
      var r = apkUpdateInfo(local, info);
      r.url = base + '/apk';
      return r;
    });
  }

  // 下载并拉起系统安装器（原生侧后台下载，用户只需在系统弹窗点一次「安装」）
  var apkCallbacks = {};
  var apkSeq = 0;

  function __onApkResult(callbackId, payload) {
    var cb = apkCallbacks[callbackId];
    if (!cb) return;
    delete apkCallbacks[callbackId];
    cb(payload || {});
  }

  function installApk(url) {
    if (typeof AndroidUpdate === 'undefined' || typeof AndroidUpdate.downloadAndInstallApk !== 'function') {
      return Promise.reject(new Error('当前 APK 不支持应用内更新，请用「下载 APK 安装包」'));
    }
    var id = 'apk' + (++apkSeq);
    return new Promise(function(resolve, reject) {
      apkCallbacks[id] = function(payload) {
        if (payload.ok) resolve(payload);
        else reject(new Error(payload.error || '安装失败'));
      };
      try {
        AndroidUpdate.downloadAndInstallApk(url, id);
      } catch (e) {
        delete apkCallbacks[id];
        reject(e);
      }
    });
  }

  window.Update = { __onApkResult: __onApkResult };

  window.HotUpdate = {
    checkAndApply: checkAndApply,
    localInfo: localInfo,
    computeChanged: computeChanged,
    utf8Bytes: utf8Bytes,
    appVersion: appVersion,
    apkUpdateInfo: apkUpdateInfo,
    checkApk: checkApk,
    installApk: installApk
  };
})();
