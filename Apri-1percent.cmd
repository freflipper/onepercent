@echo off
setlocal
set "PORT=8081"
cd /d "%~dp0"
set "ONEPERCENT_NODE="
for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined ONEPERCENT_NODE set "ONEPERCENT_NODE=%%I"
if not defined ONEPERCENT_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "ONEPERCENT_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined ONEPERCENT_NODE (
  echo Node.js non trovato. Installa Node.js 22.13 o successivo, poi riapri questo file.
  pause
  exit /b 1
)
"%ONEPERCENT_NODE%" "%~dp0frontend\scripts\serve-web.mjs" --open
if errorlevel 1 (
  echo.
  echo Avvio interrotto. Leggi il messaggio sopra; nessun altro server e' stato chiuso.
  pause
  exit /b 1
)
endlocal
