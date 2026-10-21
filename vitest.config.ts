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
    // Les fichiers de test s'executent EN PARALLELE par defaut, et c est la
    // source du bruit de `login-timing.test.mjs`.
    //
    // `scryptAsync` est un `promisify(crypto.scrypt)` : il occupe le
    // threadpool de libuv (4 threads). Quand plusieurs fichiers tournent en
    // meme temps, les appels scrypt se disputent ces threads, et l etendue
    // d une meme serie de mesures va de 150 a 985 ms. L ecart « mesure »
    // entre un compte existant et un compte inexistant variait alors de 6 a
    // 125 ms — sans que le code n ait change.
    //
    // Serialiser les fichiers supprime la contention : le threadpool n est
    // plus partage, et la mesure redevient stable. Le cout est un peu de
    // temps de suite ; le gain est une suite qui ne tombe pas au hasard.
    fileParallelism: false,
  },
  globals: true,
  // Node, et c'est VOLONTAIRE : cette ligne annoncait `jsdom`, mais jsdom
  // n'est pas dans les dependances. Vitest retombait silencieusement sur
  // node, donc les 500+ tests passaient dans un environnement qui n'existait
  // pas dans la config. Une config qui decrit un environnement faux est pire
  // qu'une config honnete : on croit couvrir le DOM alors qu'on ne le couvre
  // pas. Les stores client sont du zustand pur, sans DOM, et le build +
  // les 41 tests Playwright UI sont la vraie couverture navigateur.
  // Si un test a besoin du DOM, il faut installer jsdom explicitement.
  environment: 'node',
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
