' 静默启动小满热更新链路：LAN 服务(8788) + assets 自动推送。
' 由登录计划任务 "xiaoman-HotUpdate" 调用（无窗口）；也可直接双击运行。
' 换 node 安装位置时，只改下面这一行。
Option Explicit
Const NODE = "D:\Software\nodejs\node.exe"

Dim fso, sh, base
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base

sh.Run """" & NODE & """ """ & base & "\server.js""", 0, False
sh.Run """" & NODE & """ """ & base & "\watch.js""", 0, False
