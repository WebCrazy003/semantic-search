@echo off
rem ===========================================================================
rem  Build the offline release.
rem
rem  Run this ON A WINDOWS PC WITH AN INTERNET CONNECTION, from a copy of this
rem  repository. It produces release\docsage-<version>-win64-offline,
rem  a self-contained folder that runs on any Windows PC with no network, no
rem  Python, no Node, no Docker and no installation step.
rem
rem      prepare-offline.bat        build the folder
rem      prepare-offline.bat zip    build the folder and a .zip beside it
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
title DocSage - build offline release
cd /d "%~dp0"

set "PY_VERSION=3.12"
set "BUILD=%CD%\.build"
set "WINGET_LINKS=%LOCALAPPDATA%\Microsoft\WinGet\Links"
set "UV_BIN=%USERPROFILE%\.local\bin"
set "NODE_BIN=%ProgramFiles%\nodejs"
set "PATH=%UV_BIN%;%NODE_BIN%;%WINGET_LINKS%;%PATH%"
rem PyTorch's CUDA index. uv export pins torch==X+cu130 but leaves the index out.
set "TORCH_CUDA=cu130"
set "TORCH_INDEX=https://download.pytorch.org/whl/%TORCH_CUDA%"
rem Keep the interpreter this build downloads inside the build folder.
set "UV_PYTHON_INSTALL_DIR=%BUILD%\python"

set "MAKE_ZIP="
if /i "%~1"=="zip" set "MAKE_ZIP=1"

echo ============================================================
echo   Building the offline release
echo ============================================================
echo.

if not exist "backend\pyproject.toml" (
    echo   FAIL  run this from the repository root, next to backend\ and frontend\.
    goto :failed
)

rem ---------------------------------------------------------------- version
rem The release version lives in the VERSION file at the repository root.
set "VERSION=0.0.0"
if exist "VERSION" set /p VERSION=<VERSION
set "NAME=docsage-%VERSION%-win64-offline"
set "RELEASE=%CD%\release\%NAME%"
echo   Version %VERSION%
echo   Output  release\%NAME%
echo.
echo   This machine needs a network. The result will not.
echo   Expect roughly 6 GB and 20-50 minutes. Most of it is the CUDA build of
echo   PyTorch, which lets indexing use an NVIDIA RTX GPU when there is one.
echo.

if not exist "%BUILD%" mkdir "%BUILD%"
if exist "%RELEASE%" rmdir /s /q "%RELEASE%"
mkdir "%RELEASE%" 2>nul

rem ---------------------------------------------------------------- 1. uv
echo [1/9] uv
where uv >nul 2>&1 && goto :uv_ok
where winget >nul 2>&1 && winget install --id astral-sh.uv -e --silent --accept-package-agreements --accept-source-agreements
set "PATH=%UV_BIN%;%WINGET_LINKS%;%PATH%"
where uv >nul 2>&1 && goto :uv_ok
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
set "PATH=%UV_BIN%;%PATH%"
where uv >nul 2>&1 && goto :uv_ok
echo       FAIL  could not install uv. Get it from https://docs.astral.sh/uv/
goto :failed
:uv_ok
for /f "delims=" %%V in ('uv --version 2^>nul') do echo       OK    %%V

rem ---------------------------------------------------------------- 2. Node
echo.
echo [2/9] Node.js, to build the interface
echo       Needed on this machine only. The release never runs Node.
where npm >nul 2>&1 && goto :node_ok
where winget >nul 2>&1
if errorlevel 1 (
    echo       FAIL  install Node.js LTS from https://nodejs.org and run this again.
    goto :failed
)
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
set "PATH=%NODE_BIN%;%WINGET_LINKS%;%PATH%"
where npm >nul 2>&1 && goto :node_ok
echo       FAIL  Node.js is installed but not on PATH in this window.
echo             Close this window, open a new one, and run this again.
goto :failed
:node_ok
for /f "delims=" %%V in ('node --version 2^>nul') do echo       OK    Node %%V

rem ---------------------------------------------------------------- 3. Python
echo.
echo [3/9] CPython %PY_VERSION%, the interpreter the release will carry
uv python install %PY_VERSION%
if errorlevel 1 (
    echo       FAIL  could not fetch CPython %PY_VERSION%
    goto :failed
)
call :find_python
if not defined PYROOT (
    echo       FAIL  no python.exe under %BUILD%\python
    goto :failed
)
echo       OK    !PYROOT!

rem ---------------------------------------------------------------- 4. pins
echo.
echo [4/9] Pinning every dependency from uv.lock
uv export --directory backend --format requirements.txt --no-hashes --no-dev --no-emit-project > "%BUILD%\requirements.txt"
if errorlevel 1 (
    echo       FAIL  uv export failed
    goto :failed
)
rem The Windows pin must be the CUDA build. PyPI's Windows torch is CPU-only.
findstr /r /c:"^torch==.*+%TORCH_CUDA%" "%BUILD%\requirements.txt" >nul
if errorlevel 1 (
    echo       FAIL  uv.lock does not pin a +%TORCH_CUDA% torch for Windows; check backend\pyproject.toml
    goto :failed
)
echo       OK    %BUILD%\requirements.txt

rem ---------------------------------------------------------------- 5. libs
echo.
echo [5/9] Installing the libraries into the release (PyTorch is the big one)
rem Every version is pinned, so taking each pin from whichever index has it is safe;
rem the CUDA torch exists only on the PyTorch index.
uv pip install --python "!BUNDLED_PY!" --target "%RELEASE%\runtime\lib" -r "%BUILD%\requirements.txt" --extra-index-url "%TORCH_INDEX%" --index-strategy unsafe-best-match
if errorlevel 1 (
    echo       FAIL  library install failed. Check the network and run this again.
    goto :failed
)
if not exist "%RELEASE%\runtime\lib\fastapi" (
    echo       FAIL  the library folder looks wrong; fastapi is not in it
    goto :failed
)
echo       OK    release\%NAME%\runtime\lib

rem The whole point of the CUDA build: prove it is one, with RTX 20 to RTX 50 kernels.
rem This inspects the build, so it works on a build machine with no GPU.
set "PYTHONPATH=%RELEASE%\runtime\lib"
"!BUNDLED_PY!" "%CD%\scripts\gpu_report.py" --build
set "ERR=!errorlevel!"
set "PYTHONPATH="
if not "!ERR!"=="0" (
    echo       FAIL  the installed PyTorch cannot use NVIDIA GPUs
    goto :failed
)

rem ---------------------------------------------------------------- 6. model
echo.
echo [6/9] BGE-M3 embedding model, about 2.3 GB
if exist "models\bge-m3\config.json" (
    echo       OK    already downloaded into models\bge-m3, reusing it
) else (
    rem Run the downloader on the bundled interpreter, against the libraries
    rem just installed, so this build needs nothing else on the machine.
    set "PYTHONPATH=%RELEASE%\runtime\lib"
    "!BUNDLED_PY!" "%CD%\scripts\download_model.py"
    set "ERR=!errorlevel!"
    set "PYTHONPATH="
    if not "!ERR!"=="0" (
        echo       FAIL  the model download did not complete. Run this again; it resumes.
        goto :failed
    )
)

rem ---------------------------------------------------------------- 7. interface
echo.
echo [7/9] Building the interface
call npm --prefix frontend install
if errorlevel 1 (
    echo       FAIL  npm install failed
    goto :failed
)
call npm --prefix frontend run build
if errorlevel 1 (
    echo       FAIL  the frontend build failed
    goto :failed
)
if not exist "frontend\dist\index.html" (
    echo       FAIL  the build produced no frontend\dist\index.html
    goto :failed
)
echo       OK    frontend\dist

rem ---------------------------------------------------------------- 8. assemble
echo.
echo [8/9] Assembling the release
call :copy_tree "!PYROOT!"          "%RELEASE%\runtime\python"  ""   || goto :failed
call :copy_tree "%CD%\backend\app"  "%RELEASE%\backend\app"     ""   || goto :failed
call :copy_tree "%CD%\frontend\dist" "%RELEASE%\frontend\dist"  ""   || goto :failed
call :copy_tree "%CD%\models\bge-m3" "%RELEASE%\models\bge-m3"  ""   || goto :failed
call :copy_tree "%CD%\scripts"      "%RELEASE%\scripts"         "*.py" || goto :failed

copy /y "windows\run.bat"          "%RELEASE%\run.bat"          >nul
copy /y "windows\stop.bat"         "%RELEASE%\stop.bat"         >nul
copy /y "windows\check.bat"        "%RELEASE%\check.bat"        >nul
copy /y "windows\README-FIRST.txt" "%RELEASE%\README-FIRST.txt" >nul
mkdir "%RELEASE%\documents" 2>nul

rem Settings, with the embedded vector store switched on.
copy /y ".env.example" "%RELEASE%\.env" >nul
>>"%RELEASE%\.env" echo.
>>"%RELEASE%\.env" echo # ---- Offline release ----
>>"%RELEASE%\.env" echo # Vectors live in this folder. No Qdrant server, no Docker.
>>"%RELEASE%\.env" echo QDRANT_PATH=./qdrant_storage

rem The C runtime PyTorch links against, in case the target lacks it.
if not exist "%BUILD%\vc_redist.x64.exe" (
    curl -sL -o "%BUILD%\vc_redist.x64.exe" "https://aka.ms/vs/17/release/vc_redist.x64.exe"
)
if exist "%BUILD%\vc_redist.x64.exe" (
    copy /y "%BUILD%\vc_redist.x64.exe" "%RELEASE%\runtime\vc_redist.x64.exe" >nul
) else (
    echo       NOTE  could not fetch vc_redist.x64.exe; run.bat will say so if it is needed
)

>"%RELEASE%\VERSION.txt" echo DocSage %VERSION% - find knowledge locally (win64, offline)
>>"%RELEASE%\VERSION.txt" echo Built %DATE% %TIME% on %COMPUTERNAME%
>>"%RELEASE%\VERSION.txt" echo Python %PY_VERSION%
>>"%RELEASE%\VERSION.txt" echo PyTorch CUDA build %TORCH_CUDA%, NVIDIA driver 580 or newer for GPU indexing
copy /y "%BUILD%\requirements.txt" "%RELEASE%\runtime\requirements.txt" >nul
set "BROKEN="
for %%F in (run.bat stop.bat check.bat README-FIRST.txt .env VERSION.txt) do (
    if not exist "%RELEASE%\%%F" set "BROKEN=!BROKEN! %%F"
)
if not exist "%RELEASE%\runtime\python\python.exe"   set "BROKEN=!BROKEN! runtime\python"
if not exist "%RELEASE%\runtime\lib\fastapi"         set "BROKEN=!BROKEN! runtime\lib"
if not exist "%RELEASE%\backend\app\main.py"         set "BROKEN=!BROKEN! backend\app"
if not exist "%RELEASE%\frontend\dist\index.html"    set "BROKEN=!BROKEN! frontend\dist"
if not exist "%RELEASE%\models\bge-m3\config.json"   set "BROKEN=!BROKEN! models\bge-m3"
if not exist "%RELEASE%\scripts\verify_install.py"    set "BROKEN=!BROKEN! scripts"
if defined BROKEN (
    echo       FAIL  the release is missing:!BROKEN!
    goto :failed
)
echo       OK    assembled

rem ---------------------------------------------------------------- 9. finish
echo.
echo [9/9] Finishing
if defined MAKE_ZIP (
    echo       compressing, this takes a while...
    if exist "release\%NAME%.zip" del /q "release\%NAME%.zip"
    tar -a -c -f "release\%NAME%.zip" -C "release" "%NAME%"
    if errorlevel 1 (
        echo       NOTE  could not create the zip. Copy the folder instead.
    ) else (
        echo       OK    release\%NAME%.zip
    )
)
echo       OK

echo.
echo ============================================================
echo   Release ready.
echo ============================================================
echo.
echo   release\%NAME%\
echo.
echo   Copy that whole folder to the offline computer, anywhere at all,
echo   and double-click run.bat inside it. There is no setup step.
echo   README-FIRST.txt in the folder explains it to the person using it.
echo.
if not defined MAKE_ZIP echo   Run "prepare-offline.bat zip" if you want a .zip of it instead.
echo.
pause
exit /b 0

rem ---------------------------------------------------------------- helpers
:find_python
rem uv names the folder after the exact build, so find it rather than guess.
set "PYROOT="
set "BUNDLED_PY="
for /d %%D in ("%BUILD%\python\cpython-%PY_VERSION%*") do (
    if exist "%%~fD\python.exe" set "PYROOT=%%~fD"
    if exist "%%~fD\install\python.exe" set "PYROOT=%%~fD\install"
)
if defined PYROOT set "BUNDLED_PY=!PYROOT!\python.exe"
exit /b 0

:copy_tree
rem %1 source, %2 destination, %3 optional file filter. Robocopy reports success
rem as 0-7 and real failures as 8 and above, so plain errorlevel will not do.
robocopy "%~1" "%~2" %~3 /E /NFL /NDL /NJH /NJS /NP /XD __pycache__ /XF *.pyc >nul
if errorlevel 8 (
    echo       FAIL  could not copy %~1
    exit /b 1
)
exit /b 0

:failed
echo.
echo ============================================================
echo   The release was not built.
echo ============================================================
echo.
pause
exit /b 1
