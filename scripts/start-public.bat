@echo off
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"
set "TOOLS=%ROOT%\tools"
set "CF=%TOOLS%\cloudflared.exe"

if not exist "%TOOLS%" mkdir "%TOOLS%"

if not exist "%CF%" (
  echo 首次运行：正在下载 cloudflared 隧道工具（约 55MB）...
  curl -L -o "%CF%" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  if not exist "%CF%" (
    echo 下载失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo 正在启动绿茵BIT服务...
  start "绿茵BIT服务" /min cmd /k "cd /d %ROOT% && node server\src\index.js"
  timeout /t 2 /nobreak >nul
) else (
  echo 检测到 3000 端口已有服务，直接复用。
)

echo 正在启动公网隧道...
start "绿茵BIT隧道" cmd /k ""%CF%" tunnel --url http://localhost:3000 --no-autoupdate"

echo.
echo ============================================================
echo  已启动两个窗口：
echo   1) 绿茵BIT服务  —— 不要关闭
echo   2) 绿茵BIT隧道  —— 窗口里会显示 https://xxxx.trycloudflare.com
echo  把隧道窗口里的链接复制给同学即可。
echo  电脑需要保持开机联网，不能休眠。
echo ============================================================
echo.
pause
