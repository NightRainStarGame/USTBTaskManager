#Requires -Version 5.1
<#
.SYNOPSIS
  TaskManager 发码器（豆芽本机专用）：读 server/.env → 出月卡/基础码 → 复制到剪贴板。
.DESCRIPTION
  - 默认出月卡（-Basic 切换为基础开通码）
  - 默认 1 张（-Count N 批量）
  - 第一个码自动复制到剪贴板
  - 弹窗显示所有码 + 写日志到 server/data/issue.log
  - 失败给出可操作的修复指引（不靠豆芽查 stack）
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\issue-voucher.ps1
  powershell -ExecutionPolicy Bypass -File .\issue-voucher.ps1 -Basic
  powershell -ExecutionPolicy Bypass -File .\issue-voucher.ps1 -Count 5
  powershell -ExecutionPolicy Bypass -File .\issue-voucher.ps1 -Basic -Count 10 -Quiet
.NOTES
  约定：脚本放在 scripts/，server 在 ../server。打包成桌面快捷方式时用绝对路径调用。
#>

[CmdletBinding()]
param(
    [switch]$Basic,
    [ValidateRange(1, 1000)]
    [int]$Count = 1,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

# ---- 0. 引入 WinForms（用于弹窗 + 剪贴板）----
Add-Type -AssemblyName System.Windows.Forms | Out-Null

function Show-Error([string]$msg) {
    if (-not $Quiet) {
        [System.Windows.Forms.MessageBox]::Show($msg, "发码器 ✗", "OK", "Error") | Out-Null
    } else {
        Write-Error $msg
    }
    exit 1
}

# ---- 1. 定位 server 目录（兼容脚本被快捷方式调用时 $PSScriptRoot 仍可用）----
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    # 兜底：尝试从当前目录推断
    $cwd = (Get-Location).Path
    if (Test-Path (Join-Path $cwd 'server/package.json')) {
        $ScriptDir = $cwd
    } else {
        Show-Error "无法定位脚本目录。请通过 scripts/issue-voucher.ps1 调用。"
    }
}
$ServerRoot = (Resolve-Path (Join-Path $ScriptDir '..\server')).Path
if (-not (Test-Path (Join-Path $ServerRoot 'package.json'))) {
    Show-Error "server 目录无效：$ServerRoot（找不到 package.json）"
}

# ---- 2. 决定 plan / CLI / SECRET 字段 ----
$Plan = if ($Basic) { 'BASIC' } else { 'MONTHLY' }
$CliName = if ($Basic) { 'gen-voucher.js' } else { 'gen-monthly.js' }
$SecretKey = if ($Basic) { 'VOUCHER_HMAC_SECRET' } else { 'MONTHLY_VOUCHER_HMAC_SECRET' }
$CliPath = Join-Path $ServerRoot "dist\cli\$CliName"

if (-not (Test-Path $CliPath)) {
    Show-Error @"
找不到 CLI：$CliPath

请先编译 server：
  cd $ServerRoot
  npm install
  npm run build
"@
}

# ---- 3. 读 .env ----
$EnvPath = Join-Path $ServerRoot '.env'
if (-not (Test-Path $EnvPath)) {
    Show-Error @"
找不到 .env：$EnvPath

请先创建并填入密钥：
  copy $ServerRoot\.env.example $EnvPath
  notepad $EnvPath
填：$SecretKey=<node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))">
"@
}

# 解析指定 KEY（支持等号两边带引号 / 注释行 / 多行）
$line = Get-Content $EnvPath -Encoding UTF8 | Where-Object { $_ -match "^\s*$([regex]::Escape($SecretKey))\s*=" } | Select-Object -First 1
if (-not $line) {
    Show-Error "$EnvPath 中没有 $SecretKey 行"
}
$Secret = ($line -replace "^\s*$([regex]::Escape($SecretKey))\s*=", '') -replace '^\s*[\s''"]|[\s''"]\s*$', ''
if (-not $Secret) {
    Show-Error "$EnvPath 中 $SecretKey 行没有值"
}
if ($Secret -eq '__FILL_ME__' -or $Secret.Length -lt 16) {
    Show-Error @"
$EnvPath 中的 $SecretKey 仍是 `__FILL_ME__` 或太短。

生成 32 字节随机密钥：
  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
然后填到 .env 的 $SecretKey=<值> 行。
"@
}

# ---- 4. 调 node CLI（cwd 必须是 server，否则 config.js loadDotEnv 找不到 .env）----
try {
    Push-Location $ServerRoot
    try {
        $output = & node $CliPath $Count 2>&1
    } finally {
        Pop-Location
    }
} catch {
    Show-Error "调用 CLI 失败：$_"
}
if ($LASTEXITCODE -ne 0) {
    $errMsg = ($output | Out-String).Trim()
    Show-Error "CLI 退出码 $LASTEXITCODE：`n$errMsg"
}

# 过滤有效码（V1-...）
$codes = @($output | Where-Object { $_ -match '^V1-[A-Z]+-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+$' })
if ($codes.Count -eq 0) {
    Show-Error "CLI 未输出有效码。原始输出：`n$($output | Out-String)"
}
if ($codes.Count -lt $Count) {
    if (-not $Quiet) {
        [System.Windows.Forms.MessageBox]::Show(
            "请求 $Count 张，实际生成 $($codes.Count) 张。继续显示已生成的。",
            "发码器 ⚠", "OK", "Warning") | Out-Null
    }
}

# ---- 5. 复制第一张到剪贴板 + 写日志 + 弹窗 ----
$FirstCode = $codes[0].Trim()
[System.Windows.Forms.Clipboard]::SetText($FirstCode) | Out-Null

$LogDir = Join-Path $ServerRoot 'data'
$null = New-Item -ItemType Directory -Path $LogDir -Force
$LogPath = Join-Path $LogDir 'issue.log'
$entry = '{0}  plan={1,-7} count={2,-3} codes={3}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Plan, $Count, ($codes -join ',')
try {
    Add-Content -Path $LogPath -Value $entry -Encoding UTF8
} catch {
    # 日志写失败不阻断
}

if (-not $Quiet) {
    if ($Count -gt 1) {
        $body = "已生成 $($codes.Count) 张 $Plan 码：`n`n$($codes -join "`n")`n`n第一张已复制到剪贴板"
    } else {
        $body = "$Plan 码：`n`n$FirstCode`n`n已复制到剪贴板，去微信 Ctrl+V 发给对方即可"
    }
    [System.Windows.Forms.MessageBox]::Show($body, "发码器 ✓", "OK", "Information") | Out-Null
} else {
    Write-Output ($codes -join "`n")
}