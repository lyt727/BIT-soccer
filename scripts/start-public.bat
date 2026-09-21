@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"
set "TOOLS=%ROOT%\tools"
set "CF=%TOOLS%\cloudflared.exe"

if not exist "%TOOLS%" mkdir "%TOOLS%"

tasklist /FI "IMAGENAME eq cloudflared.exe" 2>nul | find /I "cloudflared.exe" >nul
if not errorlevel 1 (
  echo A tunnel process is already running.
  echo Please check the existing "GreenPitch Tunnel" window for the public link.
  echo If you want a new link, run stop-public.bat first.
  pause
  exit /b 0
)

if not exist "%CF%" (
  echo [1/3] Downloading cloudflared tunnel tool ...
  where curl >nul 2>&1
  if errorlevel 1 (
    echo curl not found. Please download cloudflared manually:
    echo https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
    echo Save it as: %CF%
    pause
    exit /b 1
  )
  curl -L --fail --silent --show-error -o "%CF%" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  if not exist "%CF%" (
    echo Download failed. Please check your network and run again.
    pause
    exit /b 1
  )
)

netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo [2/3] Starting GreenPitch server ...
  start "GreenPitch Server" /min cmd /k "cd /d %ROOT% && node server\src\index.js"
  timeout /t 2 /nobreak >nul
) else (
  echo [2/3] Port 3000 is already in use, reusing it.
)

echo [3/3] Starting public tunnel ...
start "GreenPitch Tunnel" cmd /k ""%CF%" tunnel --url http://localhost:3000 --no-autoupdate"

echo.
echo ============================================================
echo  Two windows were started:
echo    1) GreenPitch Server  -- keep it open
echo    2) GreenPitch Tunnel  -- copy the https://xxxx.trycloudflare.com link
echo.
echo  Keep this computer powered on and connected. No sleep mode.
echo  To stop: double-click stop-public.bat
echo ============================================================
echo.
pause
