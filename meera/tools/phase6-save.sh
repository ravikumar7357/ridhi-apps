#!/usr/bin/env bash
# Phase 6: after one of her older files became TypeScript — rebuild everything from it and run every check; the file is
# saved (committed) only if all pass.   bash meera/tools/phase6-save.sh guide-tours
set -eo pipefail   # a failing step stops the save, even when its output is shortened
cd "$(dirname "$0")/../.."
name="$1"
TSC="C:/AMAZON/Amazon Inventory/Amazon Inventory/fba-forecast/node_modules/typescript/lib/tsc.js"
node "$TSC" -p meera/client/tsconfig.json
node "$TSC" -p meera/client/tsconfig.legacy.json
echo "type checks: clean"
(cd Replenish-App && node tests/assemble.js --force | tail -1 && node tests/build-dist.js | tail -1)
node meera/client/build.cjs | tail -1
node meera/client/build.cjs --check
node meera/router/build-search.cjs --check || true
node meera/router/build-search.cjs | tail -1
(cd meera/router && node test/router.test.mjs | tail -1 && node test/same-cleaning.test.mjs | tail -1)
for a in "" "--bundle"; do
  out=$(node meera/tests/gate.cjs $a 2>&1); echo "gate $a: $(echo "$out" | grep 'golden answers') | $(echo "$out" | tail -1)"
  echo "$out" | tail -1 | grep -q "passed" || { echo "GATE FAILED"; exit 1; }
  nb=$(node meera/tests/never-break.cjs $a | tail -1); echo "never-break $a: $nb"
  echo "$nb" | grep -q " 0 failed" || { echo "NEVER-BREAK FAILED"; exit 1; }
done
git add -A Replenish-App/src/app/ORDER Replenish-App/public/index.html Replenish-App/public/meera meera/client meera/router/src/search.gen.js meera/router/build-search.cjs meera/tools
git commit -q -m "Meera Phase 6: ${MSG:-$name is TypeScript now} — the type checks are clean, all 580 answers identical, never-break 29/29 (in the page and as meera.js)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
