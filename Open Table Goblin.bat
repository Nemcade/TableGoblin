@echo off
setlocal
cd /d "%~dp0"
title Table Goblin - Your local table
where node >nul 2>nul
if not errorlevel 1 (
  node "scripts\launch.cjs"
  goto finished
)
set "GOBLIN_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%GOBLIN_NODE%" (
  "%GOBLIN_NODE%" "scripts\launch.cjs"
  goto finished
)
echo Table Goblin needs Node.js 22.12 or newer to open its local server.
echo Install Node.js from https://nodejs.org and double-click this file again.
pause
exit /b 1
:finished
if errorlevel 1 pause
