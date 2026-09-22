#Requires -Version 5.1
<#
.SYNOPSIS
  在桌面创建「发码器」快捷方式（双击出月卡码，自动复制到剪贴板）。
.DESCRIPTION
  - 创建桌面 LNK 指向 issue-voucher.ps1（不弹黑窗）
  - 图标用 PowerShell.exe 内置图标
  - 可选：创建第二个「出基础码」快捷方式
  - 卸载：-Uninstall 同时删两个
.NOTES
  桌面路径读取走 Shell.Application，不依赖具体用户名。
#>

[CmdletBinding()]
param(
    [switch]$BasicOnly,
    [switch]$MonthlyOnly,
    [switch]$Uninstall,
    [switch]$All    # -All = 同时建月卡 + 基础码两个快捷方式
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms | Out-Null

# ---- 0. 定位桌面 ----
$shell = New-Object -ComObject Shell.Application
$desktop = $shell.NameSpace(0)   # CSIDL_DESKTOP
if (-not $desktop) {
    [System.Windows.Forms.MessageBox]::Show(
        "无法获取桌面目录", "安装失败", "OK", "Error") | Out-Null
    exit 1
}
$DesktopPath = $desktop.Self.Path

# ---- 1. 定位脚本与图标 ----
$ScriptDir = $PSScriptRoot
$MonthlyLnkName = '发码器(月卡).lnk'
$BasicLnkName   = '发码器(基础码).lnk'
$MonthlyLnkPath = Join-Path $DesktopPath $MonthlyLnkName
$BasicLnkPath   = Join-Path $DesktopPath $BasicLnkName

if ($Uninstall) {
    foreach ($p in @($MonthlyLnkPath, $BasicLnkPath)) {
        if (Test-Path $p) {
            Remove-Item $p -Force
            Write-Host "  [删除] $p"
        }
    }
    [System.Windows.Forms.MessageBox]::Show(
        "桌面快捷方式已删除", "卸载完成", "OK", "Information") | Out-Null
    exit 0
}

$IssueScript = Join-Path $ScriptDir 'issue-voucher.ps1'
if (-not (Test-Path $IssueScript)) {
    [System.Windows.Forms.MessageBox]::Show(
        "找不到 issue-voucher.ps1：$IssueScript", "安装失败", "OK", "Error") | Out-Null
    exit 2
}

$PowerShell = (Get-Command powershell.exe).Source
$IconPath   = "$env:SystemRoot\System32\shell32.dll"

# ---- 2. 建快捷方式 ----
function New-Shortcut([string]$lnkPath, [string]$args, [string]$desc, [int]$iconIndex) {
    if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force }
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnkPath)
    $sc.TargetPath       = $PowerShell
    $sc.Arguments        = $args
    $sc.WorkingDirectory = $ScriptDir
    $sc.WindowStyle      = 7        # 最小化（-WindowStyle Hidden 更彻底，但调试时不友好）
    $sc.IconLocation     = "$IconPath,$iconIndex"
    $sc.Description      = $desc
    $sc.Save()
    Write-Host "  [创建] $lnkPath"
}

if (-not $BasicOnly) {
    New-Shortcut $MonthlyLnkPath `
        "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$IssueScript`"" `
        "双击出 1 张月卡开通码，自动复制到剪贴板" `
        12    # shell32.dll index 12 = 黄色钥匙
}

if ($All -or $BasicOnly) {
    New-Shortcut $BasicLnkPath `
        "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$IssueScript`" -Basic" `
        "双击出 1 张基础开通码，自动复制到剪贴板" `
        54    # shell32.dll index 54 = 蓝色小卡片
}

# ---- 3. 桌面可选「固定到任务栏」指引 ----
$msg = @"
桌面快捷方式已创建：
$(if (-not $BasicOnly) { "  ✓ $MonthlyLnkName（月卡，默认）" })
$(if ($All -or $BasicOnly) { "  ✓ $BasicLnkName（基础码）" })

下一步（可选）：
  1) 右键 → 固定到任务栏 → 之后 Win+数字一键出码
  2) 右键 → 属性 → 快捷键 → 设 Ctrl+Alt+M（月卡） / Ctrl+Alt+B（基础码）

首次使用前请确认 server/.env 已填好 MONTHLY_VOUCHER_HMAC_SECRET。
"@
[System.Windows.Forms.MessageBox]::Show($msg, "发码器 ✓", "OK", "Information") | Out-Null