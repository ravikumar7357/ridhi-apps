# BUTTON 1 — Check locally.
# Rebuilds both pages from src/, builds the test copy (saving off) and opens it on this computer.
# Nothing is saved to GitHub and nothing goes online.
# -Foreground: if port 8080 is already taken, stop ONLY the process listening on it (never every node.exe), then run the server
#              in this window — Ctrl+C stops it and it says "Server stopped". Without the switch: exactly as before.
param([switch]$Foreground)
$ErrorActionPreference = 'Continue'   # each step's exit code decides
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host "`n== 1/3  Rebuilding the pages from src/ ==" -ForegroundColor Cyan
node Replenish-App/tests/assemble.js
if ($LASTEXITCODE -ne 0) { Write-Host "Stopped: the factory ERP page could not be rebuilt (see above)." -ForegroundColor Red; exit 1 }
node Replenish-App/tests/assemble.js --root Pricing-App
if ($LASTEXITCODE -ne 0) { Write-Host "Stopped: the Sellora page could not be rebuilt (see above)." -ForegroundColor Red; exit 1 }

Write-Host "`n== 2/3  Building the test copy (saving off) ==" -ForegroundColor Cyan
node Replenish-App/tests/build-test-erp.js
if ($LASTEXITCODE -ne 0) { Write-Host "Stopped: the test copy could not be built (see above)." -ForegroundColor Red; exit 1 }

Write-Host "`n== 3/3  Opening it on this computer ==" -ForegroundColor Cyan
Start-Process 'http://localhost:8080/replenish/'
Write-Host "Factory ERP: http://localhost:8080/replenish/"
Write-Host "Sellora:     http://localhost:8080/sellora/"
Write-Host "Change a file in src/? Press button 1 again, then reload the page.`n" -ForegroundColor Yellow
if (-not $Foreground) {
  node tools/serve.js 8080
} else {
  # --- -Foreground: free port 8080 (only its listener), then serve here until Ctrl+C ---
  $owners = @()
  try {
    $owners = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    # No Get-NetTCPConnection (or nothing listening): read netstat's LISTENING line for :8080.
    $owners = @(netstat -ano -p tcp | Select-String -Pattern '^\s*TCP\s+\S+:8080\s+\S+\s+LISTENING\s+(\d+)\s*$' |
      ForEach-Object { [int]$_.Matches[0].Groups[1].Value } | Select-Object -Unique)
  }
  foreach ($procId in $owners) {
    if ($procId -le 4 -or $procId -eq $PID) { continue }   # never the system, never this window
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { '?' }
    Write-Host "Port 8080 is in use by $name (PID $procId) - stopping only that process." -ForegroundColor Yellow
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
  if ($owners.Count) { Start-Sleep -Milliseconds 500 }
  Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Green
  try {
    node tools/serve.js 8080
  } finally {
    Write-Host "Server stopped" -ForegroundColor Cyan
  }
}
