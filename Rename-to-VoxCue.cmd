@echo off
setlocal
set "renameScript=%~dp0scripts\rename-project.ps1"
cd /d "%~dp0.."
start "Rename project to VoxCue" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%renameScript%"
exit /b
