#requires -Version 7.0
<#
.SYNOPSIS
  启动「萌百 → VS Code」本机桥（独立进程，关掉这个窗口也不影响）
.DESCRIPTION
  桥只监听 127.0.0.1:8765，负责把浏览器传来的条目源码写到本地并用 VS Code 打开。
  已在监听则跳过，可反复执行。
.EXAMPLE
  pwsh -File tools\vscode-open\start-server.ps1
#>
[CmdletBinding()]
param(
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$server = Join-Path $here 'server.mjs'
if (-not (Test-Path -LiteralPath $server)) {
    throw "找不到 server.mjs：$server"
}

$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    Write-Host "端口 $Port 已有服务在跑（PID $(($busy.OwningProcess | Select-Object -Unique) -join ','))，不重复启动。" -ForegroundColor Yellow
}
else {
    Start-Process -FilePath 'node' -ArgumentList @($server) -WorkingDirectory $here -WindowStyle Hidden
    Write-Host "已启动本机桥（独立进程）。" -ForegroundColor Green
}

foreach ($i in 1..12) {
    Start-Sleep -Milliseconds 400
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/ping" -UseBasicParsing -TimeoutSec 3
        Write-Host "自检通过：HTTP $($r.StatusCode)  $($r.Content)"
        Write-Host "目标目录以 config.json 的 vault 为准。"
        return
    }
    catch {
        # 还没起来，继续等
    }
}

Write-Warning "12 次自检都没通，手动看一眼：node `"$server`""
