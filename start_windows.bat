@echo off
setlocal enabledelayedexpansion
title Baroutkoub Reconciliation - Windows Quick Start

echo ================================================================
echo   Baroutkoub Bank Reconciliation App - Windows Runner
echo ================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found on your system!
    echo Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [1/3] Installing dependencies...
    call npm install
)

if not exist "dist\" (
    echo [2/3] Building production bundle...
    call npm run build
)

echo [3/3] Starting internal application server...
echo.
echo Opening http://localhost:3000 in your browser...
echo (You can close this command prompt window to stop the application)
echo.

start http://localhost:3000
call npm start

pause
