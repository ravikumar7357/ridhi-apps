# BUTTON 2 — Send to TEST ERP.
# Checks everything, asks for one line saying what changed, saves it to the dev branch and pushes.
# The test link https://ravikumar7357.github.io/ridhi-apps/ updates about 2 minutes later.
# Stops before saving anything if a check fails. Never touches main or the real ERP.
# 'Continue': git and node write progress to stderr; each step's exit code decides, not the stream it wrote to.
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
function Stop-With($msg) { Write-Host "`nStopped: $msg" -ForegroundColor Red; Write-Host "Nothing was sent.`n"; exit 1 }

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'dev') { Stop-With "you are on branch '$branch'. This button sends from 'dev' only. Run: git switch dev" }

Write-Host "`n== 1/5  Getting teammates' latest work ==" -ForegroundColor Cyan
git pull --rebase --autostash origin dev
if ($LASTEXITCODE -ne 0) { Stop-With "your changes clash with a teammate's. Open the files VS Code marks, keep the right lines, save, then press this button again." }

Write-Host "`n== 2/5  Rebuilding the pages from src/ ==" -ForegroundColor Cyan
node Replenish-App/tests/assemble.js
if ($LASTEXITCODE -ne 0) { Stop-With "the factory ERP page could not be rebuilt." }
node Replenish-App/tests/assemble.js --root Pricing-App
if ($LASTEXITCODE -ne 0) { Stop-With "the Sellora page could not be rebuilt." }

Write-Host "`n== 3/5  Checks ==" -ForegroundColor Cyan
node Replenish-App/tests/gs-syntax-test.js;    if ($LASTEXITCODE -ne 0) { Stop-With "an Apps Script file does not parse." }
node Replenish-App/tests/build-test-erp.js;    if ($LASTEXITCODE -ne 0) { Stop-With "the test copy could not be built, so the test ERP would not update." }
foreach ($t in 'flow-test','delta-test','sync-test','pack-core-test','pack-scan-test','pack-verify-test') {
  $r = node "Replenish-App/tests/$t.js" 2>&1
  if ($LASTEXITCODE -ne 0) { $r | Select-Object -Last 20 | Write-Host; Stop-With "test '$t' failed (above)." }
  Write-Host "  passed: $t"
}

Write-Host "`n== 4/5  What changed ==" -ForegroundColor Cyan
git add -A
$changed = git diff --cached --name-only
if (-not $changed) { Write-Host "Nothing changed since the last send, so there is nothing to do.`n" -ForegroundColor Yellow; exit 0 }
$changed | ForEach-Object { Write-Host "  $_" }
$msg = Read-Host "`nIn one line, what did you change (for example: Order Console shows the printer name)"
if (-not $msg.Trim()) { git reset -q; Stop-With "no description given." }
git commit -q -m $msg
if ($LASTEXITCODE -ne 0) { Stop-With "the save (commit) failed." }

Write-Host "`n== 5/5  Sending to GitHub ==" -ForegroundColor Cyan
git push origin dev
if ($LASTEXITCODE -ne 0) { Stop-With "GitHub refused the push. Press this button again in a minute." }
$sha = (git rev-parse --short HEAD).Trim()
Write-Host "`nSent ($sha). The TEST ERP updates in about 2 minutes:" -ForegroundColor Green
Write-Host "  https://ravikumar7357.github.io/ridhi-apps/"
Write-Host "  The orange label at the bottom-left will say: dev @ $sha"
Write-Host "  Watch the build: https://github.com/ravikumar7357/ridhi-apps/actions`n"
