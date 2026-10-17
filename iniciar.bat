@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org
  pause
  exit /b 1
)
node --no-warnings -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 (
  echo Este aplicativo requer Node.js 22.13 ou superior.
  pause
  exit /b 1
)
node server.js
pause
