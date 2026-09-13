@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_app.ps1"
if %errorlevel% neq 0 (
    echo.
    echo ==============================================================================
    echo [ERROR] Launcher encountered an issue.
    echo ==============================================================================
    pause
)
