#Requires -Version 5.1
<#
.SYNOPSIS
  救火脚本：给指定目录下所有 .ps1 / .json / .md / .sql / .txt 加 UTF-8 BOM。
.DESCRIPTION
  场景：Windows PowerShell 5.1 在中文系统读 UTF-8 无 BOM 的 .ps1 文件会按 ANSI/CP936 解码 → 中文乱码 → parser 报错。

  用法：
    powershell -ExecutionPolicy Bypass -File .\fix-server-encoding.ps1 -TargetDir E:\taskmanager-server-v1.2.5

  默认目标目录是 E:\taskmanager-server-v1.2.5（VPS 上的解压路径），可用 -TargetDir 改。
  不会重复加 BOM（已带 BOM 的文件跳过）。
.NOTES
  Windows PowerShell 5.1 解析器看到 BOM 才认 UTF-8，无 BOM 时按系统 ANSI 码页解码。
#>

[CmdletBinding()]
param(
    [string]$TargetDir = 'E:\taskmanager-server-v1.2.5',
    [string[]]$Extensions = @('.ps1', '.json', '.md', '.sql', '.txt', '.env')
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms | Out-Null

if (-not (Test-Path $TargetDir)) {
    [System.Windows.Forms.MessageBox]::Show(
        "目录不存在：$TargetDir", "加 BOM 失败", "OK", "Error") | Out-Null
    exit 1
}

$enc = [System.Text.Encoding]::UTF8
$added = 0
$skipped = 0
$failed = 0

Get-ChildItem -Path $TargetDir -Recurse -File -Include $Extensions | ForEach-Object {
    $path = $_.FullName
    try {
        $bytes = [System.IO.File]::ReadAllBytes($path)
        # UTF-8 BOM = 0xEF 0xBB 0xBF
        $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
        if ($hasBom) {
            $skipped++
            return
        }
        # 写：UTF-8 + BOM
        $content = [System.Text.Encoding]::UTF8.GetString($bytes)
        $utf8Bom = New-Object System.Text.UTF8Encoding($true)   # $true = emit BOM
        [System.IO.File]::WriteAllText($path, $content, $utf8Bom)
        $added++
    } catch {
        Write-Warning "失败：$path → $_"
        $failed++
    }
}

$msg = @"
加 BOM 完成：
  目录：$TargetDir
  新增 BOM：$added 个
  已带 BOM 跳过：$skipped 个
  失败：$failed 个

下一步：
  重新运行 install-windows.ps1
"@
[System.Windows.Forms.MessageBox]::Show($msg, "加 BOM OK", "OK", "Information") | Out-Null
Write-Host $msg