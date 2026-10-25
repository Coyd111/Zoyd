import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Export admin des matchs en CSV (GET /api/admin/matches/export).
 *
 * Correctif A9 (audit-2) : avant, `match.payouts` n'etait JAMAIS ecrit par le
 * moteur, donc la colonne sortait vide et la commission `arbiterFee` ressortait
 * la valeur FIGEE a la creation (pot theorique `maxPlayers * entryFee`), alors
 * que le versement prend un taux du pot REELLEMENT verrouille. L'export sert
 * de sauvegarde de l'historique financier : il doit montrer ce qui est parti
 * des cagnottes, pas ce que la creation avait prevu.
 *
 * Colonnes verrouillees apres correctif :
 *   `payouts`        - les versements reels (uuid:pseudo:montant | ...)
 *   `arbiterFeeReel` - somme des commissions reellement payees (0 si rien)
 *   `arbiterFee`     - conserve, theorique : sert de point de comparaison
 *   `pendingArbiterFee` - creance restante quand la commission a echoue
 */

vi.mock('./push-notifications.mjs', () => ({
  broadcastStateSnapshot: vi.fn(),
  deliverNotification: vi.fn(),
  notifyAllAdmins: vi.fn(async () => {}),
}));

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const q = {};
      q.select = vi.fn(() => q);
      q.upsert = vi.fn(() => Promise.resolve({ error: null }));
      q.delete = vi.fn(() => q);
      q.eq = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.in = vi.fn(() => Promise.resolve({ data: [], error: null }));
      return q;
    }),
  },
}));

const { buildMatchesCsv } = await import('./routes/admin.mjs');

describe('buildMatchesCsv - export de l historique financier (A9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const matchRegle = () => ({
    id: 'M-Csv1 abc',
    format: '1VS1',
    status: 'finished',
    createdAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T01:30:00Z',
    entryFee: 100,
    prizePool: 200,
    zoydFee: 4,
    arbiterFee: 4,
    creatorPseudo: 'Chef',
    players: [{ pseudo: 'A1' }, { pseudo: 'B1' }],
    winner: 'A1',
    payouts: [
      { userId: 'uuid-a', pseudo: 'A1', amount: 196, type: 'prize_win', paidAt: '2026-01-01T01:30:00Z' },
      { userId: 'uuid-arb', pseudo: 'Arbi', amount: 4, type: 'arbitration_fee', paidAt: '2026-01-01T01:30:00Z' },
    ],
  });

  it('annonce au moins le nouveau schema de colonnes', () => {
    const premier = buildMatchesCsv([matchRegle()]).split('\n')[0];
    // Le BOM Excel ouvre la premiere cellule : le nom de colonne est le restant.
    expect(premier).toContain('\uFEFF');
    expect(premier).toContain('arbiterFeeReel');
    expect(premier).toContain('pendingArbiterFee');
    expect(premier).toContain('payouts');
  });

  it('remplit payouts et reporte commissions theorique ET reelle', () => {
    const csv = buildMatchesCsv([matchRegle()]);
    const [entete, premier] = csv.split('\n');
    // Un versement par paye, au format uuid:pseudo:montant.
    expect(premier).toContain('uuid-a:A1:196');
    expect(premier).toContain('uuid-arb:Arbi:4');
    // Schema : ... zoydFee, arbiterFee, arbiterFeeReel, pendingArbiterFee ...
    const colonnes = entete.replace('\uFEFF', '').split(',');
    expect(colonnes[9]).toBe('arbiterFee');
    expect(colonnes[10]).toBe('arbiterFeeReel');
    expect(colonnes[11]).toBe('pendingArbiterFee');
    const cellules = premier.split(',');
    expect(cellules[9]).toBe('4');   // theorique fige a la creation
    expect(cellules[10]).toBe('4');  // reel : 0 partie joueur + 4 commission
    expect(cellules[11]).toBe('');   // aucune creance
  });

  it('sort 0 en reel quand aucun versement n a encore eu lieu', () => {
    const nonRegle = { ...matchRegle(), status: 'in_progress', payouts: undefined, finishedAt: undefined };
    const premier = buildMatchesCsv([nonRegle]).split('\n')[1];
    // La colonne theorique garde la valeur de creation, la colonne reelle
    // reste a 0 : l'export ne doit pas presenter une creance imaginaire.
    const cellules = premier.split(',');
    expect(cellules[9]).toBe('4');
    expect(cellules[10]).toBe('0');
    expect(cellules[11]).toBe('');
    expect(premier.endsWith(',0,,Chef,A1 | B1,A1,')).toBe(true);
  });

  it('reporte la creance d arbitre en attente dans sa colonne', () => {
    // Le match a ete regle avec le joueur paye mais la commission a echoue :
    // la creance apparait telle quelle, prete pour le suivi admin.
    const enCreance = { ...matchRegle(), pendingArbiterFee: 4 };
    const cellules = buildMatchesCsv([enCreance]).split('\n')[1].split(',');
    expect(cellules[11]).toBe('4');
  });

  it('echappe une valeur contenant une virgule', () => {
    const contentieux = { ...matchRegle(), creatorPseudo: 'Chef, Jr' };
    const csv = buildMatchesCsv([contentieux]);
    expect(csv).toContain('"Chef, Jr"');
  });

  it('ne casse pas les colonnes quand match.payouts est corrompu', () => {
    // Defense en profondeur : une donnee a moitie migree ne doit pas bloquer
    // l'export qui sert d'audit.
    const corrompu = { ...matchRegle(), payouts: [{ pseudo: 'A1' }] };
    const csv = buildMatchesCsv([corrompu]);
    expect(csv.split('\n')).toHaveLength(3); // entete + 1 ligne + dernier \n
    expect(csv).toContain('A1:');
  });
});
