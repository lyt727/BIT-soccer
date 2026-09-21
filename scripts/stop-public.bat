@echo off
taskkill /FI "WINDOWTITLE eq 绿茵BIT隧道*" /T /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq 绿茵BIT服务*" /T /F >nul 2>&1
echo 已尝试停止绿茵BIT服务与公网隧道。
echo 如果某个黑窗口还在，直接点右上角关闭即可。
pause
