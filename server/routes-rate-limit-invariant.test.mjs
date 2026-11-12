import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Toute route doit avoir un quota.
 *
 * Pourquoi un test STRUCTUREL, et pas un test de route par route
 * ---------------------------------------------------------------
 * Un test qui verifie une route a la fois ne verifie que les routes
 * qu on a pense a lister. L audit-3 (P9 C4) avait corrige neuf routes de
 * match et trois de tournoi qui n avaient pas de quota - et en avait laisse
 * d autres, dans les memes fichiers, sans que rien ne le signale : la
 * couverture etait une LISTE, donc elle ne pouvait pas couvrir ce qui
 * n etait pas liste.
 *
 * Ce test lit la SOURCE et verifie la STRUCTURE : toute condition de
 * route (`if (req.method === ... && pathname === ...)`) ouvre un bloc qui
 * doit contenir un `rateLimitGuard`. Une route nouvelle sans quota fait
 * echouer le test, automatiquement.
 *
 * Les exemptions sont EXPLICITES et documentees : une exemption non
 * ecrite est un trou.
 */
const DOSSIER = resolve('server/routes');

/** Route -> raison de l'absence de quota. */
const EXEMPTIONS = {
  'GET /api/br/config': 'Configuration STATIQUE (des constantes). Aucun travail dynamique a borner.',
  'GET /api/realtime/health': 'Sonde de sante PUBLIQUE : elle doit repondre meme quand l etat est casse (cf. l ordre des gardes du module public).',
  'GET /metrics': 'Protege par un jeton Bearer (METRICS_TOKEN), pas par un quota par IP.',
};

const RE_ROUTE = /^\s*if\s*\(\s*req\.method\s*===\s*'([A-Z]+)'\s*&&\s*pathname\s*===\s*'([^']+)'\s*\)/;

const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.mjs'));

/** Toutes les routes, avec le bloc qu'elles ouvrent. */
const extraireRoutes = () => {
  const routes = [];
  for (const f of fichiers) {
    const lignes = readFileSync(join(DOSSIER, f), 'utf8').split(/\r?\n/);
    const indices = [];
    for (let i = 0; i < lignes.length; i += 1) {
      const m = RE_ROUTE.exec(lignes[i]);
      if (m) indices.push({ i, methode: m[1], chemin: m[2] });
    }
    for (let k = 0; k < indices.length; k += 1) {
      const { i, methode, chemin } = indices[k];
      const fin = k + 1 < indices.length ? indices[k + 1].i : lignes.length;
      routes.push({
        fichier: f,
        ligne: i + 1,
        clef: `${methode} ${chemin}`,
        bloc: lignes.slice(i, fin).join('\n'),
      });
    }
  }
  return routes;
};

describe('Routes — toute route a un quota', () => {
  it('l analyse trouve bien des routes (le test ne tourne pas a vide)', () => {
    const routes = extraireRoutes();
    expect(routes.length, 'des routes doivent etre trouvees').toBeGreaterThan(40);
  });

  it('aucune route sans quota, hors exemptions documentees', () => {
    const routes = extraireRoutes();
    const sansQuota = routes
      .filter((r) => !r.bloc.includes('rateLimitGuard'))
      .filter((r) => !(r.clef in EXEMPTIONS))
      .map((r) => `${r.fichier}:${r.ligne}  ${r.clef}`);
    expect(
      sansQuota,
      `routes sans quota :\n${sansQuota.join('\n')}\n\n`
      + `Les exemptions declarees sont : ${Object.keys(EXEMPTIONS).join(', ')}`,
    ).toEqual([]);
  });

  it('chaque exemption est documentee, et sa raison est ecrite', () => {
    for (const [clef, raison] of Object.entries(EXEMPTIONS)) {
      expect(raison, `l exemption ${clef} doit avoir une raison`).toBeTruthy();
      expect(raison.length, `la raison de ${clef} doit etre explicite`).toBeGreaterThan(20);
    }
  });

  it('une exemption qui ne correspond plus a une route est signalee', () => {
    // Une exemption devenue inutile (la route a recu un quota) est un
    // indice que l exemption n est plus justified : on veut le savoir.
    const routes = extraireRoutes();
    const cles = new Set(routes.map((r) => r.clef));
    const orphelines = Object.keys(EXEMPTIONS).filter((clef) => !cles.has(clef));
    expect(orphelines, `exemptions devenues caduques : ${orphelines.join(', ')}`).toEqual([]);
  });

  it('le quota est pose AVANT la lecture du corps', () => {
    // Un quota pose apres `parseRequestBody` ne protege de rien : le corps
    // a deja ete lu (et mis en memoire) quand le refus arrive.
    const routes = extraireRoutes();
    const mauvais = [];
    for (const r of routes) {
      if (!r.bloc.includes('rateLimitGuard')) continue;
      const iQuota = r.bloc.indexOf('rateLimitGuard');
      const iCorps = r.bloc.indexOf('parseRequestBody');
      if (iCorps >= 0 && iCorps < iQuota) mauvais.push(`${r.fichier}:${r.ligne}  ${r.clef}`);
    }
    expect(
      mauvais,
      `quota pose apres la lecture du corps :\n${mauvais.join('\n')}`,
    ).toEqual([]);
  });
});
