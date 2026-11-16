@echo off
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo Create the virtual environment and install backend requirements first.
  pause
  exit /b 1
)
call backend\.venv\Scripts\activate.bat
cd backend
uvicorn main:app --reload
