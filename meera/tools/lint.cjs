/* ESLint on Meera's code from THIS computer (npm is blocked here): the eslint and typescript-eslint copies found in another
 * folder's packages (fba-forecast — only read, never changed), with her own rules (meera/client/eslint.rules.mjs).
 * GitHub runs the same rules through meera/client/eslint.config.mjs.   node meera/tools/lint.cjs [--fix] */
const path = require('path');
const MOD = process.env.ESLINT_HOME || 'C:/AMAZON/Amazon Inventory/Amazon Inventory/fba-forecast/node_modules';
const CLIENT = path.join(__dirname, '..', 'client');
(async () => {
  const { ESLint } = require(path.join(MOD, 'eslint'));
  const js = require(path.join(MOD, '@eslint', 'js'));
  const tseslint = require(path.join(MOD, 'typescript-eslint', 'dist', 'index.js'));   // its package names no main file
  const globals = require(path.join(MOD, 'globals'));
  const { shared, legacy, files } = await import('file:///' + path.join(CLIENT, 'eslint.rules.mjs').replace(/\\/g, '/'));
  const eslint = new ESLint({
    cwd: CLIENT, overrideConfigFile: true, fix: process.argv.includes('--fix'),
    overrideConfig: tseslint.config(
      { ignores: files.ignores },
      js.configs.recommended,
      ...tseslint.configs.recommended,
      { files: files.all, languageOptions: { globals: { ...globals.browser } }, rules: shared },
      { files: files.legacy, rules: legacy },
    ),
  });
  const results = await eslint.lintFiles(files.all);
  if (process.argv.includes('--fix')) await ESLint.outputFixes(results);
  const errors = results.reduce((n, r) => n + r.errorCount, 0), warns = results.reduce((n, r) => n + r.warningCount, 0);
  const byRule = {};
  for (const r of results) for (const m of r.messages) byRule[(m.severity === 2 ? 'error ' : 'warn  ') + (m.ruleId || 'parse')] = (byRule[(m.severity === 2 ? 'error ' : 'warn  ') + (m.ruleId || 'parse')] || 0) + 1;
  Object.entries(byRule).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(String(n).padStart(5), k));
  if (process.argv.includes('--list')) for (const r of results) for (const m of r.messages) if (m.severity === 2) console.log(`${path.relative(CLIENT, r.filePath)}:${m.line} ${m.ruleId} ${m.message}`);
  console.log(`lint: ${errors} error(s), ${warns} warning(s)`);
  process.exit(errors ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
