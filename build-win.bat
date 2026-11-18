@echo off
rem Oracle SQL Formatter - build portable exe on Windows
rem Needs: Node.js 18 or newer (https://nodejs.org)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

echo [1/3] Installing packages...
call npm install
if errorlevel 1 goto :fail

echo [2/3] Running engine tests...
call npm test
if errorlevel 1 goto :fail

echo [3/3] Building portable exe... (first run downloads Electron, this can take a few minutes)
call npm run dist
if errorlevel 1 goto :fail

echo.
echo Done. Use dist\OracleSqlFormatter-1.0.0-portable.exe
pause
exit /b 0

:fail
echo.
echo [ERROR] Build failed. Please read the messages above.
pause
exit /b 1
