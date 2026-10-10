@echo off
title Backup Pipeline (private)
cd /d "%~dp0"
node scripts\backup-private.js
pause
