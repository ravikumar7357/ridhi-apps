# BUTTON 1 — Check locally.
# Rebuilds both pages from src/, builds the test copy (saving off) and opens it on this computer.
# Nothing is saved to GitHub and nothing goes online.
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
node tools/serve.js 8080
