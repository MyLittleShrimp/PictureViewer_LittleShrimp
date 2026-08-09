@echo off
chcp 936 >nul
setlocal
title 图片批注查看器（关闭本窗口即停止）
cd /d "%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "LOCK=%TEMP%\pv_launcher.lock"

echo ==================================================
echo                图片批注查看器  启动器
echo ==================================================
echo.

rem ---------- 0. 单实例检查 ----------
if not exist "%LOCK%\" goto lock_acquire

set "OLDPORT="
if exist "%LOCK%\port" set /p "OLDPORT=" < "%LOCK%\port"
if not defined OLDPORT goto lock_maybe_stale

"%PS%" -NoProfile -Command "try { $x = (New-Object System.Net.WebClient).DownloadString('http://localhost:%OLDPORT%/'); exit 0 } catch { exit 1 }"
if not errorlevel 1 (
    echo 图片批注查看器已在运行：http://localhost:%OLDPORT%/
    if not defined PV_NO_BROWSER (
        "%PS%" -NoProfile -Command "if ((Test-Path '%LOCK%\opened') -and ((Get-Item '%LOCK%\opened').LastWriteTime -gt (Get-Date).AddSeconds(-60))) { exit 0 } else { exit 1 }"
        if errorlevel 1 (
            "%PS%" -NoProfile -Command "Start-Process 'http://localhost:%OLDPORT%/'; [System.IO.File]::WriteAllText('%LOCK%\opened', '')"
            echo 已在浏览器中打开页面。
        ) else (
            echo 页面已在浏览器中打开过，请切换到浏览器查看。
        )
    )
    echo 无需重复启动，本窗口可直接关闭。
    echo.
    pause
    exit /b 0
)

:lock_maybe_stale
rem 记录端口已有监听但暂未响应：另一个实例正在启动
if defined OLDPORT (
    "%PS%" -NoProfile -Command "$l=[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners(); if ($l | Where-Object { $_.Port -eq %OLDPORT% }) { exit 0 } else { exit 1 }"
    if not errorlevel 1 (
        echo 另一个启动器实例正在启动，请稍候再试。
        echo.
        pause
        exit /b 0
    )
)
rem 锁很新（15 秒内）且端口尚无监听：可能正在启动
"%PS%" -NoProfile -Command "if ((Get-Item '%LOCK%').LastWriteTime -gt (Get-Date).AddSeconds(-15)) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
    echo 另一个启动器实例正在启动，请稍候再试。
    echo.
    pause
    exit /b 0
)
rd /s /q "%LOCK%" >nul 2>nul

:lock_acquire
mkdir "%LOCK%" 2>nul
if errorlevel 1 (
    echo 另一个启动器实例正在启动，请稍候再试。
    echo.
    pause
    exit /b 0
)
rem 刷新锁时间戳
"%PS%" -NoProfile -Command "(Get-Item '%LOCK%').LastWriteTime = Get-Date"

rem ---------- 1. 定位 Node.js ----------
where node >nul 2>nul
if not errorlevel 1 goto node_ok

set "KIMI_NODE=%LOCALAPPDATA%\Programs\kimi-desktop\resources\resources\runtime"
if exist "%KIMI_NODE%\node.exe" (
    set "PATH=%KIMI_NODE%;%PATH%"
    goto node_ok
)

echo [错误] 未找到 Node.js。
echo 请先安装 Node.js 20 或更高版本：https://nodejs.org/
echo.
rd /s /q "%LOCK%" >nul 2>nul
pause
exit /b 1

:node_ok
for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
echo [1/4] Node.js %NODE_VER% 就绪

rem ---------- 2. 检查依赖 ----------
if exist "node_modules\" goto deps_ok
echo [2/4] 首次运行，正在安装依赖（约 1-2 分钟）...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络后重试。
    echo.
    rd /s /q "%LOCK%" >nul 2>nul
    pause
    exit /b 1
)
goto deps_done
:deps_ok
echo [2/4] 依赖已就绪
:deps_done

rem ---------- 3. 选择空闲端口（3000-3009） ----------
set "PORT="
"%PS%" -NoProfile -Command "$l=[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners(); foreach($p in 3000..3009){ if(-not ($l | Where-Object { $_.Port -eq $p })){ $p; break } }" > "%LOCK%\port"
set /p "PORT=" < "%LOCK%\port"

if not defined PORT (
    echo [错误] 3000-3009 端口均被占用，请关闭部分程序后重试。
    echo.
    rd /s /q "%LOCK%" >nul 2>nul
    pause
    exit /b 1
)
echo [3/4] 端口 %PORT% 可用

rem ---------- 4. 启动服务并打开浏览器 ----------
echo [4/4] 正在启动服务：http://localhost:%PORT%/
echo.
echo --------------------------------------------------
echo   浏览器稍后会自动打开应用。
echo   使用过程中请不要关闭本窗口，关闭窗口即停止服务。
echo --------------------------------------------------
echo.

if not defined PV_NO_BROWSER (
    start "" /min "%PS%" -NoProfile -Command "for($i=0; $i -lt 60; $i++){ try { $null = (New-Object System.Net.WebClient).DownloadString('http://localhost:%PORT%/'); Start-Process 'http://localhost:%PORT%/'; [System.IO.File]::WriteAllText('%LOCK%\opened', ''); break } catch { Start-Sleep 1 } }"
)

call npm run dev -- --port %PORT% --strictPort

echo.
echo 服务已停止。
rd /s /q "%LOCK%" >nul 2>nul
pause
