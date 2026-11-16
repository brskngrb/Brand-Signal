@echo off
setlocal
echo Stopping all Ollama and Node.js processes...
for %%I in ("ollama app.exe" ollama.exe ollama_llama_server.exe node.exe) do (
    taskkill /F /T /IM %%I >nul 2>&1
)
for /f "tokens=1 delims=," %%I in ('tasklist /FO CSV /NH') do (
    for %%J in ("ollama app.exe" ollama.exe ollama_llama_server.exe node.exe) do (
        if /I "%%~I"=="%%~J" goto :remaining
    )
)
echo Ollama and Node.js are stopped.
pause
exit /b 0
:remaining
echo Some processes are still running. Try running this file as administrator.
pause
exit /b 1
