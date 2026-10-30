// ESLint 10 : configuration FLAT. L eslintrc.json n est plus supporte
// (retire en 10), --ext n est plus une option CLI, et le portage suit
// exactement la semantique de l ancien .eslintrc.json :
// - eslint:recommended  -> js.configs.recommended (plugin @eslint/js)
// - env browser + es2022 -> globals.browser (globals.node pour server)
// - plugin @typescript-eslint/recommended -> regles du preset + parser
// - react-hooks : SEULEMENT rules-of-hooks (pas exhaustive-deps,
//   jamais ajoute ici : lint max-warnings 0)
// - overrides : server mjs (lexique node, regles relachees) et tests
//   (no-explicit-any off), ordre = victoire du dernier bloc matche.
// IMPORTS : @eslint/js et globals sont des dependances internes
// d eslint 10 (nodeLinker hoisted -> resolubles). Si un basculement
// d install les rend introuvables, les ajouter en devDependencies.
import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'playwright-report/**', 'test-results/**'],
  },
  {
    files: ['src/**/*.{ts,tsx,js,mjs}', 'e2e/**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, structuredClone: 'readonly' },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    // Portage legacy : plugin:@typescript-eslint/recommended (eslintrc)
    // desactivait no-undef pour les fichiers TS — le compilateur TS et
    // les @types s en chargent, pas les globals d ESLint (process, React,
    // NodeJS, types DOM lib.es). Contrairement a mon premier flat, le
    // no-undef reste EN FORCE uniquement sur les mjs serveur.
    rules: {
      'no-undef': 'off',
    },
  },
  {
    files: ['server/**/*.{mjs,js}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, structuredClone: 'readonly' },
    },
    rules: {
      // eslint:recommended s appliquait aussi aux mjs serveur (extends
      // global de l ancien .eslintrc) : no-undef reste vivant ici, avec
      // les globals node. Le core no-unused-vars, LUI, etait longtemps
      // silencieux sous le gate eslint 8 (pas un seul warn serveur sous
      // max-warnings 0) : parite republicq et explicite.
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.mjs', 'src/test/**', 'e2e/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
