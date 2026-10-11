@echo off
setlocal
cd /d "%~dp0"
echo Prepare Table Goblin for a Linux server with Docker Compose.
echo This creates configuration only. It does not start or publish anything.
echo.
set /p TG_DOMAIN="Public domain (without https://): "
set /p TG_PUBLIC_IP="Server public IPv4: "
set /p TG_RELAY_IP="Local relay IPv4 (Enter if same as public): "
if not defined TG_RELAY_IP set "TG_RELAY_IP=%TG_PUBLIC_IP%"
node deploy/setup.cjs "%TG_DOMAIN%" "%TG_PUBLIC_IP%" "%TG_RELAY_IP%"
echo.
echo Instructions: deploy\README.md
pause
