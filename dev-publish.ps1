# ─── dev-publish.ps1: 一键发布脚本 ───
# 发布小满更新到手机：
#   小更新（JS/CSS/HTML）→ 热更新推送，手机端「检查并应用更新」秒级热加载
#   大更新（Kotlin/Manifest/res）→ 自动构建 APK 并复制到 hotupdate/apk/，
#     手机浏览器打开 http://<本机IP>:8788 直接下载安装，无需手动拷贝
#
# 用法:
#   .\dev-publish.ps1              # 自动判断：有原生层改动就构建 APK，否则仅热更新
#   .\dev-publish.ps1 -ForceApk    # 强制重新构建 APK（即使只有 JS 改动）
#   .\dev-publish.ps1 -SkipApk     # 跳过 APK 判断/构建，只做热更新推送
# 前置: 电脑已装 JDK 17+ 与 Android SDK；手机与电脑同一局域网
param(
    [switch]$ForceApk,
    [switch]$SkipApk
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "== 小满 一键发布 ==" -ForegroundColor Cyan

# ── 1. 判断是否需要构建 APK ──
$apkPath = Join-Path $root 'app\build\outputs\apk\debug\app-debug.apk'
$needApk = $ForceApk
if (-not $SkipApk -and -not $needApk) {
    # 原生层源码/资源有比现有 APK 更新的文件 → 需要重新构建
    $apkTime = if (Test-Path $apkPath) { (Get-Item $apkPath).LastWriteTimeUtc } else { [DateTime]::MinValue }
    $nativeDirs = @(
        'app\src\main\java',
        'app\src\main\res',
        'app\src\main\AndroidManifest.xml',
        'app\build.gradle.kts',
        'gradle.properties'
    )
    foreach ($d in $nativeDirs) {
        $p = Join-Path $root $d
        if (-not (Test-Path $p)) { continue }
        $latest = Get-ChildItem -Path $p -Recurse -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
        if ($latest -and $latest.LastWriteTimeUtc -gt $apkTime) {
            Write-Host ("检测到原生层改动: " + $latest.FullName.Replace($root + '\', '')) -ForegroundColor Yellow
            $needApk = $true
            break
        }
    }
}

# ── 2. 构建 APK（如需） ──
if ($needApk) {
    Write-Host "`n[1/2] 构建 Debug APK（原生层有改动）..." -ForegroundColor Cyan
    & "$root\gradlew.bat" assembleDebug
    if ($LASTEXITCODE -ne 0) {
        Write-Host "构建失败，中止发布" -ForegroundColor Red
        exit 1
    }
    if (-not (Test-Path $apkPath)) {
        Write-Host "未找到 APK 产物: $apkPath" -ForegroundColor Red
        exit 1
    }
    $apkDir = Join-Path $root 'hotupdate\apk'
    New-Item -ItemType Directory -Force -Path $apkDir | Out-Null
    Copy-Item $apkPath (Join-Path $apkDir 'xiaoman-debug.apk') -Force
    $size = [math]::Round((Get-Item (Join-Path $apkDir 'xiaoman-debug.apk')).Length / 1MB, 1)
    Write-Host ("  APK 已就绪: hotupdate\apk\xiaoman-debug.apk ($size MB)") -ForegroundColor Green
} else {
    Write-Host "`n无需重新构建 APK（无原生层改动），仅做热更新推送" -ForegroundColor DarkGray
}

# ── 3. 热更新推送（小更新核心） ──
Write-Host "`n[2/2] 推送热更新资源..." -ForegroundColor Cyan
node "$root\hotupdate\push.js"
if ($LASTEXITCODE -ne 0) {
    Write-Host "热更新推送失败" -ForegroundColor Red
    exit 1
}

# ── 4. 输出手机端信息 ──
Write-Host "`n=== 发布完成，手机端操作 ===" -ForegroundColor Green
$port = 8788
$hn = hostname

# 取局域网 IP：优先名字像无线/以太网的网卡，跳过 VPN 与虚拟网卡。
# 原先取"第一个非回环 IPv4"，在装了 aTrust/WSL/Hyper-V 的机器上会抓到虚拟网卡
# （例如 2.0.0.1），手机连不上那个地址。
function Get-LanIp {
    $cands = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' }
    if (-not $cands) { return $null }
    $virtual = 'aTrust|VPN|vEthernet|WSL|Hyper-V|VMware|VirtualBox|Loopback|Bluetooth|蓝牙|TAP|Tailscale|ZeroTier|Radmin|Npcap|Docker'
    $real = $cands | Where-Object {
        $_.InterfaceAlias -notmatch $virtual -and
        $_.InterfaceAlias -match 'WLAN|Wi-?Fi|无线|以太网|Ethernet|^en\d|^eth\d|wlan\d'
    }
    if ($real) { return ($real | Select-Object -First 1).IPAddress }
    $plain = $cands | Where-Object { $_.InterfaceAlias -notmatch $virtual }
    if ($plain) { return ($plain | Select-Object -First 1).IPAddress }
    return ($cands | Select-Object -First 1).IPAddress
}
$ip = Get-LanIp

# 手机端地址候选：主机名（IP 变了也不怕）→ IP 兜底
# 注意：主机名能否被手机解析取决于路由器是否把 DHCP 主机名注册进 DNS，
# 若不行就用 IP 地址。
$addr = ''
if ($hn) { $addr = $hn + ':' + $port }
$addrIp = ''
if ($ip) { $addrIp = $ip + ':' + $port }

Write-Host "  · 首选（主机名，IP 变了也能连）:"
Write-Host "      小更新: App 内「设置 → 热更新服务器」填  http://$addr"
Write-Host "      大更新: 手机浏览器打开  http://$addr  下载最新 APK 安装"
if ($addrIp) {
    Write-Host "  · 备用（IP，路由器不支持主机名时用）:"
    Write-Host "      填  http://$addrIp"
}
Write-Host "  提示:"
Write-Host "    - 主机名可用性取决于路由器（多数家用路由器会自动注册）。"
Write-Host "    - 手机连不上时，先试 IP 地址；若想彻底解决 IP 变动，"
Write-Host "      可在路由器做 DHCP 静态保留（按 MAC 固定 IP）。"
Write-Host "    - 确认已运行 node hotupdate/server.js 且防火墙放行 $port 端口"
Write-Host ""
