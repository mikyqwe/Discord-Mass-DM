@echo off
REM -------------------------------------------------------
REM 1) Navigate into slashy/ and install script dependencies
REM -------------------------------------------------------
echo [INFO] Installing dependencies in slashy...
cd /d "%~dp0\slashy"
call npm install
if errorlevel 1 (
    echo [ERROR] Failed npm install in slashy
    pause
    exit /b 1
)

REM -------------------------------------------------------
REM 2) Go back up and install the Electron UI dependencies
REM -------------------------------------------------------
cd ..
echo [INFO] Installing top-level dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] Failed npm install in top-level
    pause
    exit /b 1
)

REM -------------------------------------------------------
REM 3) Start the Electron application
REM -------------------------------------------------------
echo [INFO] Starting Electron app...
call npm start
