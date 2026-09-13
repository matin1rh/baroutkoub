# Pure ASCII PowerShell Launcher for Baroutkoub Bank Reconciliation
# Prevents encoding issues on Windows with non-UTF8 default code pages
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "       Baroutkoub Bank Reconciliation App Launcher" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check or Setup Node.js
Write-Host "[1/3] Checking Node.js runtime..." -ForegroundColor Yellow
$hasNode = $false

$nodeGlobal = Get-Command node -ErrorAction SilentlyContinue
if ($nodeGlobal) {
    $hasNode = $true
    Write-Host "[OK] Node.js is already installed on system." -ForegroundColor Green
} else {
    $localNode = Join-Path $ScriptDir ".node_runtime\node.exe"
    if (Test-Path $localNode) {
        $hasNode = $true
        $runtimeDir = Join-Path $ScriptDir ".node_runtime"
        $env:PATH = $runtimeDir + ";" + $env:PATH
        Write-Host "[OK] Found portable Node.js in .node_runtime." -ForegroundColor Green
    } else {
        Write-Host "[INFO] Node.js not detected. Downloading portable Node.js LTS..." -ForegroundColor Cyan
        Write-Host "Please wait a moment..." -ForegroundColor Gray
        
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $zipUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"
            $tempZip = Join-Path $env:TEMP "node_pkg.zip"
            $tempExt = Join-Path $env:TEMP "node_ext_temp"
            
            $wc = New-Object System.Net.WebClient
            $wc.DownloadFile($zipUrl, $tempZip)
            
            if (Test-Path $tempExt) { Remove-Item $tempExt -Recurse -Force }
            Expand-Archive -Path $tempZip -DestinationPath $tempExt -Force
            
            $subFolder = (Get-ChildItem $tempExt | Select-Object -First 1).FullName
            $targetDir = Join-Path $ScriptDir ".node_runtime"
            if (Test-Path $targetDir) { Remove-Item $targetDir -Recurse -Force }
            Move-Item $subFolder $targetDir
            
            Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
            Remove-Item $tempExt -Recurse -Force -ErrorAction SilentlyContinue
            
            $env:PATH = $targetDir + ";" + $env:PATH
            $hasNode = $true
            Write-Host "[OK] Portable Node.js downloaded and configured successfully!" -ForegroundColor Green
        } catch {
            Write-Host "[ERROR] Failed to download portable Node.js automatically." -ForegroundColor Red
            Write-Host "Please download and install Node.js manually from: https://nodejs.org/" -ForegroundColor Yellow
            Read-Host "Press Enter to exit..."
            exit 1
        }
    }
}

# 2. Check and install dependencies
Write-Host ""
Write-Host "[2/3] Checking dependencies (npm packages)..." -ForegroundColor Yellow
$nodeModules = Join-Path $ScriptDir "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "[INFO] Installing required dependencies (npm install)..." -ForegroundColor Cyan
    & npm install
} else {
    Write-Host "[OK] Dependencies are ready." -ForegroundColor Green
}

# 3. Launch App
Write-Host ""
Write-Host "[3/3] Starting Baroutkoub Bank Reconciliation App..." -ForegroundColor Green
Write-Host "==============================================================================" -ForegroundColor Gray
Write-Host " App URL: http://localhost:3000" -ForegroundColor White
Write-Host " Keep this window open while using the application." -ForegroundColor Gray
Write-Host "==============================================================================" -ForegroundColor Gray
Write-Host ""

# Launch default browser after 3 seconds
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 3
    Start-Process "http://localhost:3000"
} | Out-Null

& npm run dev

Write-Host ""
Write-Host "Server stopped." -ForegroundColor Yellow
Read-Host "Press Enter to close this window..."
