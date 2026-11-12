/**
 * Declarations TypeScript pour `server/utils.mjs`.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Le serveur est en JavaScript pur (`.mjs`), le front en TypeScript. Un
 * test du front qui veut COMPARER une implementation des deux cotes doit
 * importer le module serveur — et TypeScript refuse alors de le typer
 * (« Could not find a declaration file for module '../../server/utils.mjs' »).
 *
 * Ce `.d.mts` donne au front le type du module serveur, sans toucher a la
 * configuration du build et sans declarer les fichiers `.mjs` dans le
 * programme TypeScript (ce qui y fait entrer tout le serveur).
 *
 * PIEGE : ce fichier ne DOIT decrire que ce que le front utilise. Il ne
 * remplace pas la source : il en donne la type, et il peut donc mentir. Le
 * test `src/lib/format-mirror.test.ts` compare les DEUX implementations
 * par leur comportement — c est lui qui garantit qu elles restent
 * identiques.
 */

export declare const roundAmount: (value: number) => number;
export declare const getNow: () => string;
export declare const makeError: (
  code: string,
  message: string,
  details?: Record<string, unknown> | null,
) => Error & { code: string };
export declare const formatZcForNotification: (amount: number) => string;
export declare const addXpToProgression: (
  progression: { level?: string; xp?: number; nextLevelXp?: number } | null | undefined,
  amount: number,
) => { level: string; xp: number; nextLevelXp: number };
