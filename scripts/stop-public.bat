@echo off
chcp 65001 >nul
taskkill /FI "WINDOWTITLE eq GreenPitch Tunnel*" /T /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq GreenPitch Server*" /T /F >nul 2>&1
echo Stopped GreenPitch server and tunnel if they were running.
echo If a black window is still open, just close it manually.
pause
