@echo off
title Re-import Rama sir's Excel
cd /d "%~dp0"
echo.
echo   Reading the latest spreadsheet from your Downloads folder...
echo   (Your visit logs, notes and plans are kept - contacts are matched on phone number.)
echo.
node import.js "%USERPROFILE%\Downloads\rama bhaiya drivers list and city data.xlsx"
echo.
echo   Done. Close this and open Rama Planner.
pause
