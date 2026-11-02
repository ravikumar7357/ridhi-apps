/* ESLint for Meera's code (v2 rebuild, Phase 6) — on GitHub (meera-checks.yml installs eslint, typescript-eslint and
 * globals for the run). The rules are in eslint.rules.mjs, shared with meera/tools/lint.cjs on the office computer. */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { shared, legacy, files } from './eslint.rules.mjs';

export default tseslint.config(
  { ignores: files.ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: files.all, languageOptions: { globals: { ...globals.browser } }, rules: shared },
  { files: files.legacy, rules: legacy },
);
