// Vitest — tests unitaires serveur ET front.
//
// Mode mémoire obligatoire : jamais de réseau ni de base en test.
// (ZOYD_DISABLE_SUPABASE est aussi pose par la CI et par le fichier de
// configuration lui-même : `.env.server` est charge même en mode mémoire,
// donc l'absence d'URL ne prouve rien.)
//
// Les emplacements sont LISTES, pas des globs larges : un `include:
// **/*.spec.*` + `exclude: e2e/**` collectait quand même les specs
// Playwright (`exclude` n'était pas appliqué) et faisait échouer
// `pnpm test:run` — donc la CI — sans qu'un seul test n'ait été exécuté.
// Lister les emplacements réels rend l'exclusion implicite et infaillible.
//
// environment: 'node' — VOLONTAIRE. Les stores client sont du zustand pur,
// sans DOM, et jsdom n'est pas dans les dependances : une config qui
// annoncerait `jsdom` ferait croire couvrir le DOM alors qu'on ne le
// couvre pas. Le build + les tests Playwright UI sont la vraie couverture
// navigateur. Si un test a besoin du DOM, il faut installer jsdom.
process.env.ZOYD_DISABLE_SUPABASE = 'true';

export default {
  test: {
    environment: 'node',
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
    globals: false,
    // 5 s par defaut est trop juste : un simple `await import('./rate-limiter.mjs')`
    // peut depasser ce seuil sous contention CPU alors que rien n'a echoue. Les
    // modules serveur font du scrypt au chargement, ce qui sature les workers
    // quand plusieurs fichiers tournent en meme temps.
    testTimeout: 20_000,
    // Les fichiers de test s'executent EN PARALLELE par defaut, et c'est la
    // source du bruit de `login-timing.test.mjs`.
    //
    // `scryptAsync` est un `promisify(crypto.scrypt)` : il occupe le
    // threadpool de libuv (4 threads). Quand plusieurs fichiers tournent en
    // meme temps, les appels scrypt se disputent ces threads, et l'etendue
    // d'une meme serie de mesures va de 150 a 985 ms. L'ecart « mesure »
    // entre un compte existant et un compte inexistant variait alors de 6 a
    // 125 ms — sans que le code n'ait change.
    //
    // Serialiser les fichiers supprime la contention : le threadpool n'est
    // plus partage, et la mesure redevient stable.
    fileParallelism: false,
  },
};
