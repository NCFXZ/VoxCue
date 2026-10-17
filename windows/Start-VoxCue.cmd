@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is missing. Install the project dependencies first.
  pause
  exit /b 1
)
if not exist "dist-electron\shared\electron\main.js" (
  echo Build output is missing. Build the project first.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Build output is missing. Build the project first.
  pause
  exit /b 1
)
set "VITE_DEV_SERVER_URL="
start "" "node_modules\electron\dist\electron.exe" .
