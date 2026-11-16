@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& './scripts/start-agent.ps1'; if ($?) { $s=Get-Content './.runtime/web-session.json' -Raw | ConvertFrom-Json; Start-Process ('http://localhost:'+ $s.port +'/'); & './scripts/watch-logs.ps1' }"
pause
