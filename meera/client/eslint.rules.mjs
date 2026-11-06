/* MEERA'S LINT RULES (v2 rebuild, Phase 6) — one list, used by eslint.config.mjs (GitHub) and meera/tools/lint.cjs (this
 * computer). On top of ESLint's and typescript-eslint's recommended rules; the type check (tsc) already covers names and
 * types, so what is left here is what a reader trips on. Her older files (src/legacy) were written before these rules:
 * a few are warnings there, errors in her new files. */
export const shared = {
  'no-undef': 'off',                                   // her files share one page's names; tsc checks them
  '@typescript-eslint/no-explicit-any': 'off',         // her older code is typed loosely while it is converted
  '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
  'no-empty': ['error', { allowEmptyCatch: true }],    // "catch (e) { /* … */ }" says why it is empty
  'prefer-const': 'warn',
  'no-useless-escape': 'warn',
  '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
  'no-cond-assign': ['error', 'except-parens'],
  'no-control-regex': 'off',                            // cleaning text uses control characters on purpose
  'no-misleading-character-class': 'off',               // Hindi script ranges in her spelling step
  '@typescript-eslint/no-this-alias': 'off',
};
export const legacy = { 'no-prototype-builtins': 'warn', 'no-case-declarations': 'warn', '@typescript-eslint/ban-ts-comment': 'warn' };
export const files = { all: ['src/**/*.ts'], legacy: ['src/legacy/**/*.ts'], ignores: ['src/**/*.d.ts'] };
