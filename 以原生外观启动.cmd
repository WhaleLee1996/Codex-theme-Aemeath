@echo off
cd /d "%~dp0"
node scripts\launch.mjs --native
if errorlevel 1 pause
