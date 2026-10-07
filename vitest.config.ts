import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // Unitaires UNIQUEMENT. Un `include: **/*.spec.*` + `exclude: e2e/**`
  // collectait quand même les specs Playwright (`exclude` n'était pas
  // appliqué) et faisait échouer `pnpm test:run` — donc la CI — en 7
  // "suites failed" sans qu'un seul test n'ait été exécuté. Lister les
  // emplacements réels rend l'exclusion implicite et infaillible.
  test: {
    include: [
      'server/**/*.{test,spec}.{js,mjs,cjs}',
      'src/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
    // 5 s par defaut est trop juste : un simple `await import('./rate-limiter.mjs')`
    // peut depasser ce seuil sous contention CPU alors que rien n'a echoue. Les
    // modules serveur font du scrypt au chargement, ce qui sature les workers
    // quand plusieurs fichiers tournent en meme temps. Le timeout doit rendre
    // compte de la contention, pas d'un defaut de navigateur — un vrai blocage
    // hangait jusqu'a ce plafond, lui aussi.
    testTimeout: 20_000,
  },
  globals: true,
  environment: 'jsdom',
  setupFiles: ['./src/test/setup.ts'],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html'],
    exclude: ['node_modules/', 'src/test/'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
