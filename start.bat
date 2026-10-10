@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not defined PORT set PORT=3000

rem Pakette node\node.exe varsa onu kullan (kurulum gerekmez); yoksa kurulu Node.js'i dene.
set "NODE=%~dp0node\node.exe"
if not exist "%NODE%" set "NODE=node"

"%NODE%" -v >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js bulunamadı ve pakette node\node.exe yok.
  echo Çözüm: https://nodejs.org adresinden Node.js'i kurun ya da paketi eksiksiz çıkarın.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Gerekli paketler yükleniyor, lütfen bekleyin...
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo Paketler yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.
    echo.
    pause
    exit /b 1
  )
)

start "" /b cmd /c "timeout /t 2 >nul & start "" http://localhost:%PORT%/"
"%NODE%" server.js
if errorlevel 1 (
  echo.
  echo Sunucu bir hata ile kapandı. Yukarıdaki mesajı okuyun.
  pause
)
