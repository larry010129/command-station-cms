@echo off
setlocal
rem Starts the Command Station CMS on http://localhost:1430
set "ROOT=%~dp0"
cd /d "%ROOT%"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not found. Install Node.js from https://nodejs.org and try again.
  pause
  exit /b 1
)

netstat -ano | findstr /r /c:":1430 .*LISTENING" >nul && (
  echo Port 1430 is already in use. Close the other CMS window first.
  pause
  exit /b 1
)

if not exist "%ROOT%node_modules" (
  echo Installing CMS packages...
  call npm install || (pause & exit /b 1)
)

start "Command Station - CMS (1430)" cmd /k "cd /d "%ROOT%" && npm run dev"
timeout /t 6 /nobreak >nul
start "" http://localhost:1430
endlocal
