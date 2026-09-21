# 一键把本地演示发布成临时公网链接（Cloudflare Quick Tunnel）
# 说明：链接依赖本机保持开机联网；每次重启会生成新的临时链接。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root 'tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$exe = Join-Path $tools 'cloudflared.exe'

if (-not (Test-Path $exe)) {
  Write-Host '首次运行：正在下载 cloudflared 隧道工具（约 55MB）...'
  Invoke-WebRequest -UseBasicParsing `
    -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
    -OutFile $exe
}

$existingTunnel = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($existingTunnel) {
  Write-Host '检测到隧道进程已在运行，不需要重复启动。' -ForegroundColor Yellow
  $urlFile = Join-Path $root 'public-url.txt'
  if (Test-Path $urlFile) { Write-Host "当前链接：$(Get-Content $urlFile -Raw)" }
  Write-Host '如需重新生成链接，请先运行 .\scripts\stop-public.ps1。'
  exit 0
}

$portInUse = netstat -ano | Select-String ':3000\s' | Select-String 'LISTENING'
$server = $null
if ($portInUse) {
  Write-Host '检测到 3000 端口已有服务在运行，直接复用它。' -ForegroundColor Yellow
} else {
  $outLog = Join-Path $root 'server.out.log'
  $errLog = Join-Path $root 'server.err.log'
  $server = Start-Process -FilePath 'node' -ArgumentList 'server/src/index.js' `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  Start-Sleep -Seconds 2
}

$tunnelOut = Join-Path $root 'tunnel.out.log'
$tunnelErr = Join-Path $root 'tunnel.err.log'
$tunnel = Start-Process -FilePath $exe `
  -ArgumentList 'tunnel', '--url', 'http://localhost:3000', '--no-autoupdate' `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr

$url = $null
for ($i = 0; $i -lt 60; $i += 1) {
  Start-Sleep -Milliseconds 500
  foreach ($log in @($tunnelOut, $tunnelErr)) {
    if (Test-Path $log) {
      $match = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' |
        Select-Object -First 1
      if ($match) { $url = $match.Matches[0].Value; break }
    }
  }
  if ($url) { break }
}

if ($url) {
  $url | Set-Content -Path (Join-Path $root 'public-url.txt') -Encoding UTF8
  Write-Host ''
  Write-Host "公网链接已生成：$url" -ForegroundColor Green
  Write-Host '把这个链接发给同学即可（需要本机保持开机联网）。'
} else {
  Write-Host '没有获取到公网链接，请查看 tunnel.err.log。' -ForegroundColor Red
}

$ids = @()
if ($server) { $ids += $server.Id }
$ids += $tunnel.Id
($ids -join ' ') | Set-Content -Path (Join-Path $root '.public-pids') -Encoding UTF8
