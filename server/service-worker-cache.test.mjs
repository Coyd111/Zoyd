import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Le service worker ne doit JAMAIS mettre en cache une réponse d'API.
//
// Vérification à la SOURCE, et non en exécution : `sw.js` est un fichier
// statique servi tel quel, sans build ni transformation. On lit donc le
// texte et on vérifie les invariants qui protegent les données du joueur.
//
// Ce que ces tests verrouillent : une réponse `/api/` portant l'état
// personnel d'un joueur (amis, blocages, notifications, matchs vus depuis
// sa session) ne doit ni être stockée, ni être relue depuis le cache.
// ─────────────────────────────────────────────────────────────────────────────

const SW_PATH = path.resolve('public/sw.js');
const readServiceWorker = () => fs.readFileSync(SW_PATH, 'utf8');

describe('service worker — aucune mise en cache des API', () => {
  it('la branche /api/ ne lit ni n ecrit dans un cache', () => {
    const source = readServiceWorker();
    // On isole la branche qui traite les `/api/`.
    const start = source.indexOf("url.pathname.startsWith('/api/')");
    expect(start).toBeGreaterThan(-1);

    const branche = source.slice(start, source.indexOf('return;\n  }', start));
    expect(branche).toContain("/api/");
    // Aucune écriture, aucune relecture : `caches.put` / `caches.match`
    // sur cette branche réintroduirait le fuite.
    expect(branche).not.toContain('caches.put');
    expect(branche).not.toContain('caches.match');
    expect(branche).not.toContain('cache.put');
  });

  it('ne se protege plus par l absence d en-tete Authorization', () => {
    // Le cookie de session est httpOnly : le navigateur n'envoie aucun
    // en-tete Authorization. Toute condition qui s'appuie dessus est
    // toujours vraie et ne filtre donc rien.
    expect(readServiceWorker()).not.toContain("headers.has('authorization')");
  });

  it('renvoie une erreur explicite hors ligne plutot qu une donnee perimee', () => {
    const source = readServiceWorker();
    const start = source.indexOf("url.pathname.startsWith('/api/')");
    const branche = source.slice(start, source.indexOf('return;\n  }', start));
    expect(branche).toContain('503');
    expect(branche).toContain('OFFLINE');
  });

  it('garde le cache pour le shell et les assets', () => {
    const source = readServiceWorker();
    // Sans cela le service worker ne servirait plus a rien hors ligne.
    expect(source).toContain('STATIC_ASSETS');
    expect(source).toContain('DYNAMIC_CACHE');
  });

  it('change de nom de cache pour purger les entrees /api/ deja deposees', () => {
    // `activate` supprime tout cache dont le nom differe de CACHE_NAME :
    // sans bump de version, les entrees posees par les versions precedentes
    // survivraient chez les utilisateurs deja visites.
    const source = readServiceWorker();
    expect(source).toContain("const CACHE_NAME = 'zoyd-v6'");
    expect(source).toContain("const DYNAMIC_CACHE = 'zoyd-assets-v3'");
  });
});