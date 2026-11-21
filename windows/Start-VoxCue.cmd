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
for %%F in ("native\bin\VoxCue.Audio.exe" "native\bin\VoxCue.Cpu.exe") do (
  if not exist "%%~F" goto repairAudio
  if "%%~zF"=="0" goto repairAudio
)
goto checkWindowHelpers
:repairAudio
set "ELECTRON_RUN_AS_NODE=1"
"node_modules\electron\dist\electron.exe" scripts\build-audio.mjs --missing-only
if errorlevel 1 goto repairFailed
:checkWindowHelpers
rem The helper builder also replaces stale binaries after an in-place source upgrade.
set "ELECTRON_RUN_AS_NODE=1"
"node_modules\electron\dist\electron.exe" scripts\prepare-silero.mjs --cache-only
if errorlevel 1 goto repairFailed
"node_modules\electron\dist\electron.exe" scripts\build-window-helpers.mjs
if errorlevel 1 goto repairFailed
set "ELECTRON_RUN_AS_NODE="
set "VITE_DEV_SERVER_URL="
start "" "node_modules\electron\dist\electron.exe" .
exit /b %errorlevel%
:repairFailed
echo A required Windows helper could not be built. See the error above.
pause
exit /b 1
