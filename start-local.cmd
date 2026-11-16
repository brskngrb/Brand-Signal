@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0.runtime\agent-model.json" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-agent.ps1" -InstallOnly
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-agent.ps1"
pause
