// 本地浏览器预览服务器：把 assets 目录 serve 出来，方便不装 Android Studio 时测试 UI 逻辑。
// 用法: node serve.js [port]   (默认 8080) → 打开 http://localhost:8080/app.html
// 注意: 浏览器模式是 WebView 的降级路径 —— 存储走 localStorage、网络走 XHR（依赖 API 服务端 CORS），
//       原生能力（系统分享/文件选择器/WebViewAssetLoader 图片 URL）不可用。
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'app', 'src', 'main', 'assets');
const PORT = parseInt(process.argv[2], 10) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// ─── API 转发代理 ───
// 浏览器预览模式下，外部 API 可能不带 CORS 头导致请求被拦。
// 用法：AI 设置里 apiUrl 填 http://localhost:8090/proxy/<真实API基础地址>，
// 例如 http://localhost:8090/proxy/https://opencode.ai/zen/go/v1
// 浏览器 → 本服务器（同源，无 CORS）→ 服务器转发到真实 API（服务端无 CORS 限制）。
function handleProxy(req, res, targetUrl) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const mod = targetUrl.startsWith('https:') ? https : http;
    const headers = {
      'User-Agent': 'xiaoman-dev-proxy'
    };
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
    if (body.length > 0) headers['Content-Length'] = body.length;

    const forward = mod.request(targetUrl, { method: req.method, headers }, (resp) => {
      const out = [];
      resp.on('data', (c) => out.push(c));
      resp.on('end', () => {
        res.writeHead(resp.statusCode || 500, {
          'Content-Type': resp.headers['content-type'] || 'application/json'
        });
        res.end(Buffer.concat(out));
      });
    });
    forward.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy error: ' + e.message }));
    });
    forward.write(body);
    forward.end();
  });
}

// 防目录穿越
function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const filePath = path.normalize(path.join(ROOT, decoded));
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

const server = http.createServer((req, res) => {
  // /proxy/<完整目标URL>（保留 query）→ 转发
  if (req.url.startsWith('/proxy/')) {
    const qIdx = req.url.indexOf('?');
    const rawPath = qIdx >= 0 ? req.url.substring('/proxy/'.length, qIdx) : req.url.substring('/proxy/'.length);
    const query = qIdx >= 0 ? req.url.substring(qIdx) : '';
    const target = decodeURIComponent(rawPath) + query;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy target must be http(s)://, got: ' + target }));
      return;
    }
    handleProxy(req, res, target);
    return;
  }

  let filePath = resolvePath(req.url);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  // 目录请求 → 优先 index.html，否则列出 app.html 提示
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const index = path.join(filePath, 'index.html');
    filePath = fs.existsSync(index) ? index : path.join(ROOT, 'app.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found: ' + req.url);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('xiaoman 本地预览已启动: http://localhost:' + PORT + '/app.html');
  console.log('目录: ' + ROOT);
  console.log('（Ctrl+C 停止。浏览器模式下图片存储为 base64、网络走 XHR 依赖 API CORS。）');
});
