import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `saveBrLobbies` persiste PAR ENTITE : il n'ecrit que ce qui change, et ne
 * supprime JAMAIS une entite absente de la liste (C2).
 *
 * Pourquoi ce fichier
 * -------------------
 * L'ancien chemin passait par `replaceStateCollection` : la collection
 * ENTIERE etait reecrite depuis un instantane pris avant l'action
 * concurrente. Deux effets nocifs :
 *   - la reecriture en bloc ECRASAIT les modifications faites entre-temps sur
 *     un AUTRE salon (verrou pris par salon, mais collection mise en cause) ;
 *   - les salons absents de l'instantané etaient DETRUITS en base
 *     (`replaceStateCollection` supprime ce qui manque) — passes bloques
 *     sans portes de sortie.
 *
 * Ici, `state-helpers.mjs` est importe REEL : ce sont ses vrais imports de
 * `upsertStateEntity`/`getStateEntity`/`normalizeBrLobby` qui travaillent,
 * seule la couche d'enregistrement est simulee (Map en memoire + dossier des
 * appels). On verrouille la SEMANTIQUE, pas le cablage (c'est le travail de
 * `br-write-inside-lock.test.mjs`).
 */

const h = vi.hoisted(() => {
  const etat = new Map(); // kind -> Map(id -> entite brute)
  const upserts = []; // { kind, id, entite } passes a upsertStateEntity
  const remplacements = []; // appels a replaceStateCollection (jamais legitime pour brLobbies)
  const diffusions = []; // { kind, items } passes a broadcastStateSnapshot
  return { etat, upserts, remplacements, diffusions };
});

const seedKind = (kind, id, entite) => {
  if (!h.etat.has(kind)) h.etat.set(kind, new Map());
  h.etat.get(kind).set(id, { ...entite });
};

vi.mock('./persistence.mjs', async (importOriginal) => {
  const reel = await importOriginal();
  return {
    ...reel,
    getStateCollection: vi.fn((kind) => Array.from((h.etat.get(kind) || new Map()).values())),
    getStateEntity: vi.fn((kind, id) => (h.etat.get(kind) || new Map()).get(id) || null),
    upsertStateEntity: vi.fn(async (kind, entity) => {
      if (!h.etat.has(kind)) h.etat.set(kind, new Map());
      h.etat.get(kind).set(entity.id, JSON.parse(JSON.stringify(entity)));
      h.upserts.push({ kind, id: entity.id, entite: JSON.parse(JSON.stringify(entity)) });
    }),
    replaceStateCollection: vi.fn(async (kind, items) => {
      h.remplacements.push({ kind, ids: items.map((i) => i.id) });
      // VOLONTAIREMENT non destructeur dans le fake : le test prouve que ce
      // chemin n'est PLUS EMPRUNTE pour les salons BR, pas qu'il detruit.
    }),
  };
});

vi.mock('./push-notifications.mjs', () => ({
  broadcastStateSnapshot: vi.fn((_io, kind, items) => {
    h.diffusions.push({ kind, items });
  }),
  deliverNotification: vi.fn(),
}));

const { saveBrLobbies, getStoredBrLobbies } = await import('./state-helpers.mjs');

// Salon de reference : TOUS les champs normables y sont presents, pour que la
// comparaison normalisee soit deterministe (normalizeBrLobby injecte le temps
// courant dans createdAt/updatedAt quand ils manquent : passons-les toujours).
const salonComplet = (id, surcharge = {}) => ({
  id,
  name: `Salon ${id}`,
  mode: 'solo',
  map: 'isolated',
  entryFee: 10,
  rankingMode: 'survie_kills',
  payout: { first: 0.5, second: 0.2, third: 0.1, fourth: 0.05, fifth: 0.03, arbiterRate: 0.02 },
  status: 'scheduled',
  scheduledAt: '2026-01-02T18:00:00Z',
  startedAt: null,
  finishedAt: null,
  players: [],
  teams: [],
  pot: 0,
  prizePool: 0,
  notes: '',
  creatorId: 'arb-1',
  arbiterId: 'arb-1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...surcharge,
});

beforeEach(() => {
  h.etat.clear();
  h.upserts.length = 0;
  h.remplacements.length = 0;
  h.diffusions.length = 0;
  vi.clearAllMocks();
});

describe('saveBrLobbies - ecriture PAR ENTITE (delta) et jamais de suppression', () => {
  it('n ecrit que les entites MODIFIEES : un salon non passe reste identique', async () => {
    seedKind('brLobbies', 'BR-1', salonComplet('BR-1'));
    seedKind('brLobbies', 'BR-2', salonComplet('BR-2'));

    await saveBrLobbies(null, [
      salonComplet('BR-1', { pot: 250, updatedAt: '2026-01-01T12:00:00Z' }),
      salonComplet('BR-2'),
    ]);

    // Seul BR-1 (pot modifie) a ete ecrit en base ; BR-2 est passe a la trappe.
    expect(h.upserts.map((u) => u.id)).toEqual(['BR-1']);
    // L'etat persiste porte la nouveaute, et BR-2 est intact.
    expect(h.etat.get('brLobbies').get('BR-1').pot).toBe(250);
    expect(h.etat.get('brLobbies').get('BR-2').pot).toBe(0);
    // Le chemin en bloc n'est jamais emprunte pour les salons BR.
    expect(h.remplacements).toHaveLength(0);
  });

  it('ne supprime JAMAIS une entite absente de la liste (C2)', async () => {
    seedKind('brLobbies', 'BR-1', salonComplet('BR-1'));
    seedKind('brLobbies', 'BR-2', salonComplet('BR-2'));

    // Un instantané ANCIEN (ne connait que BR-3) est persiste :
    // l'ancien chemin (`replaceStateCollection`) avait DETRUIT BR-1 et BR-2.
    await saveBrLobbies(null, [salonComplet('BR-3')]);

    expect(h.upserts.map((u) => u.id)).toEqual(['BR-3']);
    expect(getStoredBrLobbies().map((l) => l.id)).toEqual(['BR-1', 'BR-2', 'BR-3']);
  });

  it('la forme du stockage ANCIENNE (champs par defaut manquants) n ecrit pas', async () => {
    // Une ligne stockee par une version anciene du code : `notes`, `teams` et
    // `prizePool` n'existaient pas. Le diff doit comparer les etats
    // NORMALISES des deux cotes (les defauts ont le meme valeur), donc ne PAS
    // reecrire la ligne : sinon chaque redemarrage re-ecrirait les salons.
    seedKind('brLobbies', 'BR-1', {
      ...salonComplet('BR-1'),
      notes: undefined,
      teams: undefined,
      prizePool: undefined,
    });

    await saveBrLobbies(null, [salonComplet('BR-1')]);

    expect(h.upserts).toHaveLength(0);
    expect(h.remplacements).toHaveLength(0);
  });

  it('les differences de TYPE seules (chaine vs nombre) ecrites par une ancienne version ne re-ecrivent pas', async () => {
    // Meme mecanisme, autre champ : la normalisation coerce les nombres
    // (`entryFee: '10'` stocke en chaine par une ancienne version, contre
    // `entryFee: 10` dans la forme actuelle). Normalises des deux cotes, ils
    // sont identiques : pas d'ecriture.
    seedKind('brLobbies', 'BR-1', salonComplet('BR-1', { entryFee: '10', pot: '99.999' }));

    await saveBrLobbies(null, [salonComplet('BR-1', { entryFee: 10, pot: 100 })]);

    expect(h.upserts).toHaveLength(0);
    expect(h.remplacements).toHaveLength(0);
  });
});

describe('saveBrLobbies - diffusion socket', () => {
  it('diffuse la vue PUBLIQUE (sans userId) quand io est fourni', async () => {
    seedKind('brLobbies', 'BR-1', salonComplet('BR-1'));

    await saveBrLobbies({ emit: vi.fn() }, [salonComplet('BR-1', { pot: 250 })]);

    expect(h.diffusions).toHaveLength(1);
    expect(h.diffusions[0].kind).toBe('brLobbies');
    expect(h.diffusions[0].items.map((i) => i.id)).toEqual(['BR-1']);
    // La diffusion est SANITISEE : arbitre et createur n'y apparaissent pas.
    expect(h.diffusions[0].items[0].arbiterId).toBeUndefined();
    expect(h.diffusions[0].items[0].creatorId).toBeUndefined();
    expect(h.diffusions[0].items[0].isArbiter).toBe(false);
  });

  it('n diffuse RIEN quand io est null (chemin du cron)', async () => {
    seedKind('brLobbies', 'BR-1', salonComplet('BR-1'));

    await saveBrLobbies(null, [salonComplet('BR-1', { pot: 250 })]);

    expect(h.diffusions).toHaveLength(0);
    expect(h.upserts.map((u) => u.id)).toEqual(['BR-1']);
  });

  it('tolere une liste absente (rien a ecrire, rien a diffuser)', async () => {
    await saveBrLobbies(null, null);
    expect(h.upserts).toHaveLength(0);
    expect(h.diffusions).toHaveLength(0);
  });
});
