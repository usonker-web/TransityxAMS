@echo off
title Rama Bhaiya Planner
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or Windows cannot find it.
  echo   Install it from https://nodejs.org then run this again.
  echo.
  pause
  exit /b 1
)

rem The server opens your browser itself, once it is actually ready.
node server.js
echo.
echo   The planner has stopped.
pause
