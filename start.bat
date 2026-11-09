@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Adolfik
set "PYTHONUTF8=1"
set "PY=.venv\Scripts\python.exe"

rem --- 1. Віртуальне середовище ---
if not exist "%PY%" (
    echo [Adolfik] Створюю віртуальне середовище .venv ...
    py -3.14 -m venv .venv 2>nul || python -m venv .venv
)
if not exist "%PY%" (
    echo [Adolfik] Не вдалося створити .venv. Встанови Python 3.14 з python.org і запусти ще раз.
    pause
    exit /b 1
)

rem --- 2. Залежності: ставимо, тільки якщо requirements.txt змінився з минулого разу ---
fc /b requirements.txt .venv\requirements.installed >nul 2>&1
if errorlevel 1 (
    where git >nul 2>&1 || echo [Adolfik] УВАГА: не знайшов Git. Він потрібен, щоб поставити discord.py з GitHub: https://git-scm.com
    echo [Adolfik] Встановлюю залежності...
    "%PY%" -m pip install --upgrade pip --disable-pip-version-check -q
    "%PY%" -m pip install -r requirements.txt --disable-pip-version-check
    if errorlevel 1 (
        echo [Adolfik] Помилка встановлення залежностей - дивись повідомлення вище.
        pause
        exit /b 1
    )
    copy /y requirements.txt .venv\requirements.installed >nul
)

rem --- 3. Конфіг ---
if not exist ".env" (
    copy .env.example .env >nul
    echo [Adolfik] Створив .env - впиши туди DISCORD_TOKEN, збережи і запусти start.bat ще раз.
    start "" notepad .env
    pause
    exit /b 1
)

rem --- 4. Фронтенд Discord Activity: збираємо, лише якщо змінився (потрібен Node.js) ---
if exist "activity\package.json" call :build_activity

rem --- 5. Запуск ---
"%PY%" bot.py %*
set "CODE=%errorlevel%"
echo.
echo [Adolfik] Бот зупинився, код виходу %CODE%. Лог: logs\bot.log
pause
exit /b %CODE%


:build_activity
where npm >nul 2>&1
if errorlevel 1 (
    echo [Adolfik] Node.js не знайдено - пропускаю збірку Activity, бот працюватиме і без неї.
    exit /b 0
)
node activity\scripts\needs-build.mjs
set "NEED=%errorlevel%"
if "%NEED%"=="0" exit /b 0
pushd activity
if "%NEED%"=="2" (
    echo [Adolfik] Встановлюю залежності фронтенду - npm ci ...
    call npm ci --no-audit --no-fund
    if errorlevel 1 goto build_failed
)
echo [Adolfik] Збираю фронтенд Activity - npm run build ...
call npm run build
if errorlevel 1 goto build_failed
popd
exit /b 0

:build_failed
popd
echo [Adolfik] УВАГА: фронтенд Activity не зібрався - бот запуститься без нього. Подробиці вище.
exit /b 0
