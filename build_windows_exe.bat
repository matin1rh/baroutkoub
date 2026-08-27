@echo off
setlocal enabledelayedexpansion
title Baroutkoub Reconciliation - Windows EXE Builder

echo ================================================================
echo   Baroutkoub Bank Reconciliation - Windows App Builder
echo ================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please download and install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo [1/3] Installing Electron build tools...
call npm install --save-dev electron electron-builder
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install electron dependencies.
    pause
    exit /b 1
)

echo.
echo [2/3] Building production assets...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Packaging Windows EXE...
call npx electron-builder --win
if %errorlevel% neq 0 (
    echo [ERROR] Electron packaging failed.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo   BUILD COMPLETED SUCCESSFULLY!
echo   Output files are located in: dist_electron
echo ================================================================
echo.
pause
