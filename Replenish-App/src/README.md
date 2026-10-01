# Replenish app — source

Since 1 Oct 2026 this folder is the source of the page. `public/index.html` is **generated** from it; do not edit that
file by hand (the tools refuse to overwrite or build from a hand-edited copy).

```
src/
  index.html      the page: head, screen markup, and three include lines
  styles.css      the stylesheet (inside <style>)
  appv.js         the small classic script: "is this tab still on the live build?"
  app/NNNN-*.js   the app itself, one ES module cut into files, joined in file-name order
```

## Workflow

1. Edit files in `src/`. (`tests/src_patch.py` makes exact-text edits without needing to know which file holds the text.)
2. `node tests/assemble.js` — joins `src/` into `public/index.html`. `--check` only compares.
3. Run the tests as before (`node tests/prod-test.js`, `shop-test`, `tabs-test`, `load-test`, `appv-test`, `fba-test`, `live-test`).
   prod-test's first check fails if `public/index.html` is not what `src/` makes.
4. `node tests/build-dist.js` (refuses if step 2 was skipped), then `firebase deploy --only hosting` as before.

## Why the app files are joined, not imported

The app was one `<script type="module">`, so every function and variable shares one scope. Joining the files in order
keeps that scope exactly, so moving code between files needs no code change and cannot change behaviour. Order
matters: top-level `const`/`let` and statements run in file order, so code is moved between files only with the tests
green after each move. Turning groups into real imported modules that load when their tab opens is a later step of the
module plan (https://claude.ai/artifact/QhwqZHFWWDCeMspHrsNHvd).

The `NNNN` prefixes go up in tens so a file can be inserted between two others without renaming.
