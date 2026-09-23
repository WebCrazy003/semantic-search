@echo off
rem DocSage - prove the installation works.
rem Imports every dependency, exercises the vector store, and loads the model
rem with the network forced off. Run it after copying, or when something breaks.
setlocal EnableExtensions
title DocSage - check
cd /d "%~dp0"

set "PY=%~dp0runtime\python\python.exe"
set "PYTHONPATH=%~dp0runtime\lib"
set "PYTHONHOME="

echo ============================================================
echo   Checking the installation
echo ============================================================
echo.

if not exist "%PY%" (
    echo   FAIL  runtime\python is missing. Copy the whole folder again.
    echo.
    pause
    exit /b 1
)

"%PY%" "scripts\verify_install.py"
if errorlevel 1 goto :broken

rem Which GPU indexing will use. No NVIDIA GPU is fine; it then runs on the CPU.
echo.
"%PY%" "scripts\gpu_report.py"
goto :good

:broken
echo.
echo   Something is wrong. If PyTorch failed to import, run
echo   runtime\vc_redist.x64.exe as administrator and try again.
echo.
pause
exit /b 1

:good
echo.
echo   All good. Start it with run.bat
echo.
pause
exit /b 0
