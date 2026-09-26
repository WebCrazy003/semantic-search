@echo off
rem DocSage - prove the installation works.
rem Imports every dependency, exercises the vector store, and loads the model
rem with the network forced off. Run it after copying, or when something breaks.
setlocal EnableExtensions
title DocSage - check
cd /d "%~dp0"

set "PY=%~dp0runtime\python\python.exe"
set "LIB=%~dp0runtime\lib"
rem The libraries sit in a plain folder on PYTHONPATH, not a site-packages,
rem so Python never runs the .pth files in it. pywin32 needs its: pywin32.pth
rem is what puts win32\lib on sys.path, and pywintypes lives there. portalocker
rem imports it to lock the embedded vector store, so without this the server
rem dies on startup. Do by hand what that .pth would have done.
set "PYTHONPATH=%LIB%;%LIB%\win32;%LIB%\win32\lib;%LIB%\Pythonwin"
set "PATH=%LIB%\pywin32_system32;%PATH%"
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
