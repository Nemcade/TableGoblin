@echo off
setlocal
cd /d "%~dp0"
echo Table Goblin internet playtest
echo Keep your Tailscale Funnel window running and join through its HTTPS address.
echo This launcher enables free direct live-media connection discovery.
echo Some networks may still need a media relay.
echo.
set "TABLE_GOBLIN_INTERNET_PLAYTEST=1"
call "%~dp0Open Online Table Goblin.bat"
