# BUTTON 3 — Send to REAL (main).
# Lists what is on the test ERP (dev) but not yet in main, and opens GitHub's release page.
# Nothing moves until YOU press "Create pull request" and then "Merge" on GitHub.
# After merging, deploy main to the real ERP from this computer, after 7 pm (RELEASE.md, step 7).
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
git fetch -q origin
$waiting = git log --oneline origin/main..origin/dev
if (-not $waiting) { Write-Host "`nThe real ERP code (main) already has everything on the test ERP. Nothing to release.`n" -ForegroundColor Yellow; exit 0 }
Write-Host "`nOn the TEST ERP but not yet in main (newest first):" -ForegroundColor Cyan
$waiting | ForEach-Object { Write-Host "  $_" }
Write-Host "`nOpening GitHub. Check the list, then: Create pull request -> Merge." -ForegroundColor Green
Write-Host "After merging, deploy main to the real ERP (RELEASE.md, step 7).`n"
Start-Process 'https://github.com/ravikumar7357/ridhi-apps/compare/main...dev?expand=1'
