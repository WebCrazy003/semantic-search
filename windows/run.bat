@echo off
rem DocSage - start.
rem   run.bat        on this computer only
rem   run.bat lan    also reachable from the local network, with no login
setlocal EnableExtensions EnableDelayedExpansion
title DocSage - starting
cd /d "%~dp0"

rem Everything is found relative to this folder, so the release can live anywhere.
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
set "PORT=8000"
set "BIND=127.0.0.1"
if /i "%~1"=="lan" set "BIND=0.0.0.0"

echo ============================================================
echo   DocSage
echo ============================================================
echo.

rem ---------------------------------------------------------------- preflight
set "MISSING="
if not exist "%PY%"                        set "MISSING=!MISSING! runtime\python"
if not exist "runtime\lib\fastapi"         set "MISSING=!MISSING! runtime\lib"
if not exist "runtime\lib\win32\lib\pywintypes.py" set "MISSING=!MISSING! runtime\lib\win32"
if not exist "models\bge-m3\config.json"   set "MISSING=!MISSING! models\bge-m3"
if not exist "frontend\dist\index.html"    set "MISSING=!MISSING! frontend\dist"
if not exist ".env"                        set "MISSING=!MISSING! .env"
if defined MISSING (
    echo   This release is incomplete. Missing:!MISSING!
    echo.
    echo   Copy the whole folder again, without leaving anything out.
    echo.
    pause
    exit /b 1
)

rem Where the user drops PDFs. The other folders make themselves.
if not exist "documents" mkdir "documents"

rem PyTorch links against the Microsoft C runtime. Most machines have it.
if not exist "%SystemRoot%\System32\vcruntime140_1.dll" (
    echo   NOTE  the Microsoft Visual C++ runtime is missing, so PyTorch may
    echo         not load. Run runtime\vc_redist.x64.exe as administrator once.
    echo.
)

rem Already up? Never start a second one: the vector store is single-writer.
curl -s -o nul -m 2 "http://127.0.0.1:%PORT%/api/health" >nul 2>&1
if not errorlevel 1 (
    echo   Already running. Opening the browser.
    start "" "http://127.0.0.1:%PORT%/"
    timeout /t 4 >nul
    exit /b 0
)

echo   Starting. Loading the embedding model takes a minute the first time.
echo.
start "SPS Server" cmd /k "title SPS Server & "%PY%" -m uvicorn app.main:app --app-dir backend --host %BIND% --port %PORT%"

call :wait_url "http://127.0.0.1:%PORT%/api/health" 300
if errorlevel 1 (
    echo   FAIL  it never became ready.
    echo         The window titled "SPS Server" says why. If it mentions PyTorch
    echo         or a DLL, run runtime\vc_redist.x64.exe as administrator.
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Running.  http://127.0.0.1:%PORT%/
echo ============================================================
if /i "%BIND%"=="0.0.0.0" (
    echo.
    echo   Also reachable from this network at:
    for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do (
        for /f "tokens=*" %%B in ("%%A") do echo       http://%%B:%PORT%/
    )
    echo.
    echo   There is no login. Anyone who can reach that address can search every
    echo   indexed document, open the PDFs and clear the index. Use run.bat
    echo   without "lan" when you are finished.
)
echo.
echo   The window titled "SPS Server" holds the log. Leave it open.
echo   Stop with:  stop.bat
echo.
start "" "http://127.0.0.1:%PORT%/"
timeout /t 8 >nul
exit /b 0

rem ---------------------------------------------------------------- helpers
:wait_url
set "_url=%~1"
set /a _left=%~2
:wait_url_loop
curl -s -o nul -m 3 "%_url%" >nul 2>&1 && (echo. & exit /b 0)
set /a _left-=1
if %_left% leq 0 (echo. & exit /b 1)
<nul set /p "=."
ping -n 2 127.0.0.1 >nul
goto :wait_url_loop
