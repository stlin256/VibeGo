@echo off
setlocal EnableExtensions
rem =====================================================================
rem  VibeGo one-click launcher (Windows)
rem
rem  Double-click this file. It will:
rem    1. find a Node.js runtime (portable copy in .ready4vibe\runtime,
rem       or one already installed on PATH, or download an official
rem       Node.js LTS zip into .ready4vibe\runtime -- nothing is
rem       installed system-wide);
rem    2. install dependencies and build the workspace when needed;
rem    3. start the VibeGo Host and open it in your browser.
rem
rem  All state stays inside this folder. Ctrl+C stops the Host.
rem =====================================================================
cd /d "%~dp0"

set "RUNTIME_DIR=%CD%\.ready4vibe\runtime"
set "NODE_HOME=%RUNTIME_DIR%\node"
rem  Pinned to a Node.js 22 LTS whose bundled corepack carries the current
rem  npm signing keys (22.12.0's corepack 0.29.x fails with "Cannot find
rem  matching keyid" when resolving pnpm).
set "NODE_VERSION=v22.23.2"

rem --- 1) portable runtime from a previous run -------------------------
if exist "%NODE_HOME%\node.exe" (
  set "PATH=%NODE_HOME%;%PATH%"
  goto run
)

rem --- 2) Node.js already installed on this machine --------------------
where node >nul 2>nul
if not errorlevel 1 (
  node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>nul
  if not errorlevel 1 goto run
  echo [vibego] Found Node.js on PATH but it is older than v22; using a portable runtime instead.
)

rem --- 3) download an official Node.js LTS zip -------------------------
echo [vibego] No suitable Node.js found. Downloading Node.js %NODE_VERSION% into .ready4vibe\runtime ...
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"
where curl.exe >nul 2>nul
if errorlevel 1 (
  echo [vibego] ERROR: curl.exe not found. Please install Node.js 22+ manually and re-run.
  goto fail
)
curl.exe -fSL "https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip" -o "%RUNTIME_DIR%\node.zip"
if errorlevel 1 (
  echo [vibego] ERROR: Node.js download failed. Check your network connection and re-run.
  goto fail
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%RUNTIME_DIR%\node.zip' -DestinationPath '%RUNTIME_DIR%' -Force"
if errorlevel 1 (
  echo [vibego] ERROR: failed to extract the Node.js archive.
  goto fail
)
if exist "%NODE_HOME%" rmdir /s /q "%NODE_HOME%"
move "%RUNTIME_DIR%\node-%NODE_VERSION%-win-x64" "%NODE_HOME%" >nul
del /q "%RUNTIME_DIR%\node.zip" >nul 2>nul
set "PATH=%NODE_HOME%;%PATH%"

:run
echo [vibego] Using runtime: & node --version
node "%CD%\scripts\launch-local.mjs" %*
if errorlevel 1 goto fail
endlocal
exit /b 0

:fail
echo.
echo [vibego] Startup did not complete. See the messages above.
pause
endlocal
exit /b 1
