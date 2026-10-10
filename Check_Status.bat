@echo off
title Pipeline Status
cd /d "%~dp0"
node scripts\status.js %*
pause
