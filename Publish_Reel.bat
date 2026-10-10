@echo off
title Publish Reel (YouTube + Instagram + Auto-DM)
cd /d "%~dp0"
set "MANIFEST=%~1"
if "%MANIFEST%"=="" set /p MANIFEST="Manifest file (e.g. data\reels\my-reel.json): "
echo.
node scripts\publish-reel.js "%MANIFEST%"
if errorlevel 1 (
    echo.
    echo Fix the errors above, then run again.
    pause
    exit /b 1
)
echo.
set /p GO="Upload and schedule now? (y/N): "
if /i not "%GO%"=="y" (
    echo Cancelled. Nothing was uploaded.
    pause
    exit /b 0
)
node scripts\publish-reel.js "%MANIFEST%" --execute --push
pause
