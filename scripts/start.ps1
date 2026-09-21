$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'server')
try {
  Write-Host '绿茵BIT 服务启动中，端口 3000 ...'
  Write-Host '浏览器访问 http://localhost:3000 ，Ctrl+C 停止'
  node src/index.js
} finally {
  Pop-Location
}
