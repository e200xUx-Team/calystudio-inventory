@echo off
cd /d "%~dp0"
echo ======================================================
echo   The ePlane Co. - Clay Studio
echo ======================================================
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   1^) Download the LTS version from https://nodejs.org
  echo   2^) Install it, then double-click this file again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo   Installing dependencies ^(first run only, ~30s^)...
  call npm install
  if errorlevel 1 ( echo   npm install failed. & pause & exit /b 1 )
)
echo.
echo   Server is starting...
echo   ^>^> Open this in your browser:  http://localhost:3000
echo   ^(Keep this window open. Close it to stop the server.^)
echo ======================================================
echo.
node server.js
pause
