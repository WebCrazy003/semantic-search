@echo off
rem Offline Semantic PDF Search - stop. Documents and index are left untouched.
setlocal EnableExtensions EnableDelayedExpansion
title Semantic PDF Search - stopping
cd /d "%~dp0"

set "PORT=8000"

echo ============================================================
echo   Stopping Offline Semantic PDF Search
echo ============================================================
echo.

call :kill_window "SPS Server"
rem A renamed or reused window will not match the title, so sweep the port too.
call :kill_port %PORT%

curl -s -o nul -m 2 "http://127.0.0.1:%PORT%/api/health" >nul 2>&1
if not errorlevel 1 (
    echo   NOTE  something is still answering on port %PORT%.
    echo         Close the console window running the server by hand.
) else (
    echo   Stopped. Your documents and index are untouched.
)
echo.
echo   Start again with run.bat
echo.
timeout /t 6 >nul
exit /b 0

rem ---------------------------------------------------------------- helpers
:kill_window
taskkill /F /T /FI "WINDOWTITLE eq %~1" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq %~1 - *" >nul 2>&1
exit /b 0

:kill_port
rem Only ever kill a Python process, so an unrelated program that happens to
rem hold the port is never touched.
set "_port=%~1"
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:":%_port% .*LISTENING"') do call :kill_pid %%P
exit /b 0

:kill_pid
if "%~1"=="0" exit /b 0
set "_img="
for /f "tokens=1 delims=," %%I in ('tasklist /nh /fo csv /fi "PID eq %~1" 2^>nul') do set "_img=%%~I"
if /i "%_img%"=="python.exe" goto :kill_pid_do
if /i "%_img%"=="pythonw.exe" goto :kill_pid_do
exit /b 0
:kill_pid_do
echo   stopping %_img% on port %_port%
taskkill /F /T /PID %~1 >nul 2>&1
exit /b 0
