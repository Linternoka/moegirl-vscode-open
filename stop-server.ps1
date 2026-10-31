#requires -Version 7.0
<#
.SYNOPSIS
  手动停掉「萌百 → VS Code」本机桥
.DESCRIPTION
  桥平时会空闲 30 分钟自动退出；这个脚本用于想立刻停掉它的时候。
.EXAMPLE
  pwsh -File tools\vscode-open\stop-server.ps1
#>
[CmdletBinding()]
param([int]$Port = 8765)

$ErrorActionPreference = 'Stop'

$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $busy) {
    Write-Host "端口 $Port 上没有服务在跑，不用停。" -ForegroundColor Yellow
    return
}

$targetPid = ($busy.OwningProcess | Select-Object -Unique) -join ','
Stop-Process -Id ($busy.OwningProcess | Select-Object -Unique) -Force -ErrorAction Stop
Write-Host "已停止本机桥（PID $targetPid）。需要时由 VS Code 自动拉起或跑 start-server.ps1。" -ForegroundColor Green
