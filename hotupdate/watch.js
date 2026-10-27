#!/usr/bin/env node
// assets 自动推送：监视 app/src/main/assets，内容真的变了就自动重跑 push.js。
// 用法: node hotupdate/watch.js   —— 常驻。改完 JS/CSS/HTML 不用敲任何命令，
//       手机端下次启动 App 自动热更新（设置 → AI 设置 → 热更新服务器）。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'app', 'src', 'main', 'assets');
const OUT = path.join(__dirname, 'published');
const LOCK = path.join(__dirname, '.watch.pid');
const DEBOUNCE_MS = 1200;
const POLL_MS = 15000;

// 与 push.js 完全一致的遍历顺序与合并哈希，保证指纹可比
function walk(dir, base) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

function assetsFingerprint() {
  const combined = crypto.createHash('sha1');
  for (const rel of walk(ASSETS, '')) {
    combined.update(crypto.createHash('sha1').update(fs.readFileSync(path.join(ASSETS, rel))).digest('hex'));
  }
  return combined.digest('hex');
}

function publishedFingerprint() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
    const combined = crypto.createHash('sha1');
    for (const f of m.files) combined.update(f.hash);
    return combined.digest('hex');
  } catch (e) {
    return null;
  }
}

// 常驻进程没有窗口，日志同时落到 hotupdate/watch.log，方便回看推送历史
const LOG = path.join(__dirname, 'watch.log');
function log(msg) {
  const line = '[' + new Date().toLocaleString('zh-CN', { hour12: false }) + '] ' + msg;
  console.log(line);
  try {
    let lines = [];
    try { lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean); } catch (e) {}
    lines.push(line);
    if (lines.length > 300) lines = lines.slice(-200);
    fs.writeFileSync(LOG, lines.join('\n') + '\n');
  } catch (e) { /* 日志写不了不影响推送 */ }
}

// 单实例：已有 watcher 存活就退出，避免重复推送
try {
  const old = parseInt(fs.readFileSync(LOCK, 'utf8'), 10);
  if (old && old !== process.pid) {
    try {
      process.kill(old, 0);
      console.log('已有 watcher 在运行 (pid ' + old + ')，本进程退出');
      process.exit(0);
    } catch (e) { /* 陈旧锁，忽略 */ }
  }
} catch (e) { /* 无锁文件 */ }
fs.writeFileSync(LOCK, String(process.pid));
const release = () => { try { fs.unlinkSync(LOCK); } catch (e) {} };
process.on('exit', release);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

let published = publishedFingerprint();
let timer = null;
let pushing = false;
let queued = false;

function push(reason) {
  if (pushing) { queued = true; return; }
  let current;
  try {
    current = assetsFingerprint();
  } catch (e) {
    log('读取 assets 失败: ' + e.message);
    return;
  }
  if (current === published) {
    if (reason !== '定时兜底') log('内容与已发布一致，无需推送（' + reason + '）');
    return;                            // 空保存/仅 mtime 变动 → 不打扰手机端
  }

  pushing = true;
  log('检测到变更（' + reason + '），推送中…');
  // windowsHide: true —— 必须显式指定。VBS 的 sh.Run(...,0) 只隐藏它直接启动的
  // server.js/watch.js；Windows 上 spawn 默认 windowsHide=false，孙进程会自己
  // 申请一个可见控制台窗口，导致每次推送都闪一下黑框。
  const child = spawn(process.execPath, [path.join(__dirname, 'push.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.on('data', (d) => {
    const line = d.toString().match(/版本 v[\w-]+/);        // 只留版本号，避免刷屏
    if (line) log('push.js: ' + line[0]);
  });
  child.stderr.on('data', (d) => log('push.js 报错: ' + d.toString().trim()));
  child.on('exit', (code) => {
    pushing = false;
    if (code === 0) {
      published = current;
      log('✓ 已推送 —— 手机端下次启动 App 自动热加载');
    } else {
      log('✗ push.js 失败，退出码 ' + code);
    }
    if (queued) { queued = false; push('排队中的改动'); }
  });
}

log('监视目录: ' + ASSETS);
push('启动同步');

try {
  fs.watch(ASSETS, { recursive: true }, (evt, file) => {
    if (file && /(^|[\\/])\./.test(file)) return;              // 编辑器临时/隐藏文件
    if (file && /(~|\.swp|\.tmp)$/i.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => push(file || evt), DEBOUNCE_MS);
  });
} catch (e) {
  log('fs.watch 不可用（' + e.message + '），仅靠轮询兜底');
}

// 兜底：即便 watch 丢事件，指纹轮询也能发现改动
setInterval(() => push('定时兜底'), POLL_MS);
