@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Avval shu papkada npm ci buyrug'ini bajaring.
  pause
  exit /b 1
)
if not exist .env (
  call npm run setup:test
  if errorlevel 1 exit /b 1
)
echo RTM IT test server: http://127.0.0.1:3000
echo To'xtatish: Ctrl+C
npm start
