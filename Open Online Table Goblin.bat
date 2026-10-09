@echo off
setlocal
cd /d "%~dp0"
title Table Goblin - Online room server
where node >nul 2>nul
if not errorlevel 1 (
  set "GOBLIN_NODE=node"
) else (
  set "GOBLIN_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if not exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    echo Install Node.js 22.12 or newer from https://nodejs.org first.
    pause
    exit /b 1
  )
)
if not exist "dist\index.html" goto buildfirst
if not exist ".server-runtime\room-state.cjs" goto buildfirst
if not exist ".server-runtime\room-operations.cjs" goto buildfirst
if not defined PORT set "PORT=4180"
"%GOBLIN_NODE%" "scripts\launch-online.cjs"
if errorlevel 1 pause
exit /b
:buildfirst
echo Run npm install and npm run build in this folder first.
pause
