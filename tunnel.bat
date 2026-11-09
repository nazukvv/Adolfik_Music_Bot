@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Adolfik - тунель Activity

rem Публічна HTTPS-адреса для Discord Activity через Cloudflare Quick Tunnel (безкоштовно, без акаунта).
rem Бот (start.bat) має працювати окремо; цей скрипт лише прокидає його веб-сервер назовні.

where cloudflared >nul 2>&1
if errorlevel 1 (
    echo [Adolfik] Не знайдено cloudflared. Встанови його і запусти tunnel.bat ще раз:
    echo     winget install --id Cloudflare.cloudflared
    pause
    exit /b 1
)

rem Порт веб-сервера бота: WEB_PORT із .env, інакше 8080
set "PORT=8080"
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if /i "%%A"=="WEB_PORT" if not "%%B"=="" set "PORT=%%B"
    )
)

echo [Adolfik] Тунель на http://127.0.0.1:%PORT%
echo [Adolfik] Коли нижче з'явиться адреса https://....trycloudflare.com - скопіюй її БЕЗ https://
echo [Adolfik] і впиши в Developer Portal: Activities - URL Mappings - PREFIX "/" - TARGET.
echo [Adolfik] Адреса нова при кожному запуску тунелю. Зупинити - Ctrl+C.
echo.
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:%PORT%
pause
