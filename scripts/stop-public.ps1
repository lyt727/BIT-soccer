# 停止由 start-public.ps1 启动的服务与隧道
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.public-pids'
if (-not (Test-Path $pidFile)) {
  Write-Host '没有找到运行记录（.public-pids）。'
  exit 0
}
$ids = (Get-Content $pidFile -Raw).Trim() -split '\s+'
foreach ($processId in $ids) {
  if ($processId -match '^\d+$') {
    Stop-Process -Id ([int]$processId) -Force -ErrorAction SilentlyContinue
  }
}
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host '已停止本地服务与临时公网隧道。'
