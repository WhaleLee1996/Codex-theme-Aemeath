@echo off
cd /d "%~dp0"
node scripts\launch.mjs --isolated
if errorlevel 1 pause
