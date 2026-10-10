@echo off
title Cloudflare Wrangler Login
echo ========================================================
echo   Logging into Cloudflare...
echo   Browser mein page khulega, wahan "Allow" click karein.
echo ========================================================
cd /d "%~dp0"
call npx wrangler login
echo.
echo Login complete! Press any key to exit.
pause >nul
