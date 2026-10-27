#!/usr/bin/env node
// 热更新推送：把 app/src/main/assets 打包到 hotupdate/published/ 并生成 manifest.json。
// 用法: node hotupdate/push.js          —— 改完代码后执行一次，即"确认推送"
//       node hotupdate/server.js        —— 常驻服务(手机从这里拉取)
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'app', 'src', 'main', 'assets');
const OUT = path.join(__dirname, 'published');

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

function main() {
  const files = walk(ASSETS, '');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const entries = [];
  let combined = crypto.createHash('sha1');
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(ASSETS, rel));
    const hash = crypto.createHash('sha1').update(buf).digest('hex');
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    entries.push({ path: rel, hash, size: buf.length });
    combined.update(hash);
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
      '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const version = ts + '-' + combined.digest('hex').slice(0, 6);
  const manifest = {
    version,
    updatedAt: now.toISOString(),
    count: entries.length,
    files: entries
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('已推送 ' + entries.length + ' 个文件，版本 v' + version);
  console.log('发布目录: ' + OUT);
  console.log('');
  console.log('手机端「设置 → AI 设置 → 热更新服务器」填以下任一地址:');
  // 真实局域网网卡排前面：装了 aTrust/WSL/Hyper-V 的机器上，虚拟网卡的地址
  // （如 2.0.0.1）手机连不上，不能排在第一个。
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
    console.log('  http://' + a.address + ':8788' + (a.rank === 2 ? '   ← 虚拟网卡，手机连不上' : ''));
  }
  console.log('');
  console.log('确保已运行: node hotupdate/server.js');
}

main();
