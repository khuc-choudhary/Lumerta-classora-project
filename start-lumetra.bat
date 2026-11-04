@echo off
REM Starts LUMETRA CLASSORA: backend (port 8010) and frontend (port 5173) in two windows, then opens the browser.
REM First stop any old copy still holding ports 8010 / 5173 (an old backend would keep running without your .env settings).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8010 :5173" ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1
timeout /t 2 /nobreak >nul
start "Lumetra Backend" /D "%~dp0backend" cmd /k .venv\Scripts\python -m uvicorn app.main:app --port 8010
start "Lumetra Frontend" /D "%~dp0frontend" cmd /k node node_modules\vite\bin\vite.js
timeout /t 8 /nobreak >nul
start "" http://localhost:5173
