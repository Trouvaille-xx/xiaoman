#!/usr/bin/env node
// 热更新 LAN 服务：供手机端 App 拉取推送的版本。
//   GET /manifest.json        —— 版本清单
//   GET /files/<path>         —— 单个资源文件（热更新差量拉取）
//   GET /apk                  —— 最新 APK 安装包（大更新时手机直接下载）
//   GET /apk.json             —— 最新 APK 的版本元信息（App 内自更新比较新旧）
//   GET /                      —— 发布页（显示版本 + APK 下载链接）
// 用法: node hotupdate/server.js [port]（默认 8788，先运行 hotupdate/push.js 生成 published/）
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.argv[2], 10) || 8788;
const PUB = path.join(__dirname, 'published');
const APK_DIR = path.join(__dirname, 'apk');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// 最新 APK 文件（按修改时间取最新）
function latestApk() {
  try {
    if (!fs.existsSync(APK_DIR)) return null;
    const files = fs.readdirSync(APK_DIR)
      .filter(f => f.toLowerCase().endsWith('.apk'))
      .map(f => ({ name: f, full: path.join(APK_DIR, f), mtime: fs.statSync(path.join(APK_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length ? files[0] : null;
  } catch (e) { return null; }
}

function sendFile(res, fp, opts) {
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }
  const headers = {
    'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  };
  if (opts && opts.attachment) {
    headers['Content-Disposition'] = 'attachment; filename="' + path.basename(fp) + '"';
  }
  res.writeHead(200, headers);
  fs.createReadStream(fp).pipe(res);
}

// 简单发布页：显示热更新版本 + APK 下载入口
function publishPage(req, res) {
  let version = '未发布';
  let updatedAt = '';
  try {
    const m = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.json'), 'utf8'));
    if (m.version) version = m.version;
    if (m.updatedAt) updatedAt = m.updatedAt;
  } catch (e) {}
  const apk = latestApk();
  const apkHtml = apk
    ? '<p style="margin:8px 0"><a class="btn" href="/apk">⬇ 下载最新 APK（' + Math.round(apk.size = fs.statSync(apk.full).size / 1048576) + ' MB）</a></p>' +
      '<p class="hint">大更新（原生层改动）需重新安装：点击下载 → 用浏览器打开 → 安装。</p>'
    : '<p class="hint">暂无 APK（运行 dev-publish.ps1 -ForceApk 构建）</p>';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>小满 更新服务</title><style>' +
    'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f0e6;color:#2a2418;margin:0;padding:32px 20px;line-height:1.6}' +
    '.card{background:#fdfaf3;border:1px solid rgba(60,40,20,.1);border-radius:16px;padding:24px;max-width:420px;margin:0 auto;box-shadow:0 4px 12px rgba(60,40,20,.05)}' +
    'h1{font-size:18px;margin:0 0 4px;color:#a85a2a}.ver{font-size:12px;color:#968d7e;margin-bottom:16px}' +
    '.btn{display:block;text-align:center;background:#a85a2a;color:#fff;text-decoration:none;padding:12px;border-radius:12px;font-size:15px;margin-top:8px}' +
    '.hint{font-size:12px;color:#968d7e;margin-top:8px}</style></head><body><div class="card">' +
    '<h1>小满 · 更新服务</h1><div class="ver">热更新版本：' + version + (updatedAt ? '<br>更新时间：' + updatedAt : '') + '</div>' +
    '<p style="font-size:13px;color:#5e574b">小更新（JS/CSS/HTML）请在 App 内「设置 → 热更新服务器 → 检查并应用更新」。</p>' +
    apkHtml +
    '</div></body></html>');
}

const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent((req.url || '').split('?')[0]); }
  catch (e) { res.writeHead(400); return res.end('bad url'); }

  if (u === '/') return publishPage(req, res);

  if (u === '/apk') {
    const apk = latestApk();
    if (!apk) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('暂无 APK');
    }
    return sendFile(res, apk.full, { attachment: true });
  }

  // APK 元信息：App 内「检查 App 更新」先问这里，再决定要不要下 7MB
  if (u === '/apk.json') {
    const apk = latestApk();
    const json = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    if (!apk) return json({ ok: false, error: '服务端暂无 APK（先构建一次：.\\gradlew.bat assembleDebug）' });
    let info = {};
    try {
      info = JSON.parse(fs.readFileSync(path.join(APK_DIR, 'apk-info.json'), 'utf8'));
    } catch (e) { /* 旧包没有元信息，退回文件名 + 时间 */ }
    const st = fs.statSync(apk.full);
    return json({
      ok: true,
      name: apk.name,
      size: st.size,
      mtime: st.mtimeMs,
      versionCode: info.versionCode || 0,
      versionName: info.versionName || apk.name,
      builtAt: info.builtAt || new Date(st.mtimeMs).toISOString(),
      url: '/apk'
    });
  }

  let fp = null;
  if (u === '/manifest.json') {
    fp = path.join(PUB, 'manifest.json');
  } else if (u.startsWith('/files/')) {
    const rel = u.slice('/files/'.length);
    if (!rel || rel.includes('..') || rel.includes('\\') || path.isAbsolute(rel)) {
      res.writeHead(400); return res.end('bad path');
    }
    fp = path.join(PUB, rel);
  }

  if (!fp || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found: ' + u);
  }
  sendFile(res, fp);
});

server.listen(PORT, '0.0.0.0', () => {
  const hn = os.hostname();
  console.log('热更新服务已启动: http://0.0.0.0:' + PORT);
  console.log('手机端可填以下任一地址（主机名优先，IP 变了也能连）：');
  if (hn) {
    console.log('  http://' + hn + ':' + PORT + '   （主机名，取决于路由器 DNS）');
  }
  // 真实局域网网卡排前面：装了 aTrust/WSL/Hyper-V 的机器上，虚拟网卡的地址
  // （如 2.0.0.1）手机连不上，不能排第一个。
  const VIRTUAL = /aTrust|VPN|vEthernet|WSL|Hyper-V|VMware|VirtualBox|Loopback|Bluetooth|蓝牙|TAP|Tailscale|ZeroTier|Radmin|Npcap|Docker/i;
  const REAL = /WLAN|Wi-?Fi|无线|以太网|Ethernet|^en\d|^eth\d|wlan\d/i;
  const addrs = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name] || []) {
      if (it.family === 'IPv4' && !it.internal) {
        addrs.push({ name, address: it.address, rank: REAL.test(name) ? 0 : VIRTUAL.test(name) ? 2 : 1 });
      }
    }
  }
  addrs.sort((a, b) => a.rank - b.rank);
  for (const a of addrs) {
    console.log('  http://' + a.address + ':' + PORT + '   （IP 兜底' + (a.rank === 2 ? '，虚拟网卡手机连不上' : '') + '）');
  }
  console.log('手机浏览器打开该地址可下载最新 APK（大更新）');
  if (!fs.existsSync(path.join(PUB, 'manifest.json'))) {
    console.log('');
    console.log('⚠ 尚未发布过版本，请先运行: node hotupdate/push.js');
  }
});
