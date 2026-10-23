@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js не установлен. Скачайте его на https://nodejs.org и запустите этот файл снова.
  pause
  exit /b
)
echo Запускаю VELMONT... Не закрывайте это окно, пока работаете с сайтом.
start "" http://localhost:3000
node server.js
pause
