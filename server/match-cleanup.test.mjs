/**
 * server/match-cleanup.test.mjs — noyau du nettoyage 14 jours : l archivage
 * ne part qu APRES remboursement de chaque verrou de mise, et un echec de
 * remboursement bloque l archivage DU MATCH CONCERNE (repris au tick
 * suivant, jamais double-credit).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rembourses = [];
vi.mock('./wallet-engine.mjs', () => ({
  refundLockedEntry: vi.fn(async (userId, matchId, raison) => {
    rembourses.push({ userId, matchId, raison });
  }),
}));
// Les crochets de persistence ne sont pas sollicites par ce noyau (il ne
// touche qu aux collection passees en argument) — les blancs n ecrasent
// pas les autres modules de test.
vi.mock('./persistence.mjs', () => ({}));

import { runMatchCleanupOnServer } from './cron.mjs';

const ilYA = (jours) => {
  const d = new Date();
  d.setDate(d.getDate() - jours);
  return d.toISOString();
};

const matchStale = (surcharge = {}) => ({
  id: 'M-VIEUX',
  status: 'recruiting',
  createdAt: ilYA(20),
  updatedAt: ilYA(18),
  players: [{ userId: 'p-1' }, { userId: 'p-2' }],
  ...surcharge,
});

beforeEach(() => { rembourses.length = 0; vi.clearAllMocks(); });

describe('Nettoyage 14 jours : rembourser avant archiver', () => {
  it('rembourse chaque verrou puis archive le match stale', async () => {
    const res = await runMatchCleanupOnServer([matchStale()], ilYA(14));

    expect(res.archivedCount).toBe(1);
    expect(res.refundFailures).toBe(0);
    expect(rembourses.map((r) => r.userId).sort()).toEqual(['p-1', 'p-2']);
    expect(rembourses.every((r) => r.raison === 'Remboursement archive 14 jours M-VIEUX')).toBe(true);
    expect(res.nextMatches[0].status).toBe('archived');
  });

  it('n archive PAS un match dont un remboursement echoue (repris au tick suivant)', async () => {
    const { refundLockedEntry } = await import('./wallet-engine.mjs');
    refundLockedEntry.mockImplementationOnce(async () => {
      throw new Error('SUPABASE_DOWN');
    });

    const res = await runMatchCleanupOnServer([matchStale()], ilYA(14));

    expect(res.archivedCount).toBe(0);
    expect(res.refundFailures).toBe(1);
    // Statut intact : le match reviendra au prochain tick, et le joueur deja
    // parti a recu son argent (idempotent : pas de double-credit).
    expect(res.nextMatches[0].status).toBe('recruiting');
  });

  it('laisse intact un match recent', async () => {
    const res = await runMatchCleanupOnServer(
      [matchStale({ updatedAt: ilYA(2) })],
      ilYA(14),
    );

    expect(res.archivedCount).toBe(0);
    expect(rembourses).toHaveLength(0);
    expect(res.nextMatches[0].status).toBe('recruiting');
  });

  it('attribue chaque sort aux autres matchs : un echec ne gèle pas le voisin', async () => {
    const { refundLockedEntry } = await import('./wallet-engine.mjs');
    const matchEnEchec = { ...matchStale(), id: 'M-BLOQUE' };
    refundLockedEntry.mockImplementationOnce(async () => {
      throw new Error('SUPABASE_DOWN');
    });

    const res = await runMatchCleanupOnServer(
      [matchEnEchec, matchStale({ id: 'M-VOISIN' })],
      ilYA(14),
    );

    expect(res.archivedCount).toBe(1);
    expect(res.nextMatches.map((match) => match.status)).toEqual(['recruiting', 'archived']);
    // Un seul joueur atterri en echec (le premier remboursement du premier
    // match) : le second match a bien ses deux remboursements.
    expect(rembourses.filter((r) => r.matchId === 'M-VOISIN')).toHaveLength(2);
  });

  it('ne touche pas un match deja terminal (archive de tous les radars)', async () => {
    const res = await runMatchCleanupOnServer(
      [matchStale({ status: 'finished' })],
      ilYA(14),
    );

    expect(res.archivedCount).toBe(0);
    expect(rembourses).toHaveLength(0);
    expect(res.nextMatches[0].status).toBe('finished');
  });
});
