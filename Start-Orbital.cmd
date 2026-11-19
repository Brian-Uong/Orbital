@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Orbital needs Node.js 22 or newer. Install Node.js from https://nodejs.org and open this launcher again.
  pause
  exit /b 1
)
node scripts\preview.mjs --open
if errorlevel 1 pause
