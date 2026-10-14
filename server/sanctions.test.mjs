import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Application REELLE d une sanction.
 *
 * Le point verifie ici est celui qui decide si le bannissement existe : une
 * sanction qui n est pasee dans le chemin d authentification est un libelle
 * dans une base. Un joueur banni qui continue de jouer avec sa session deja
 * ouverte — de signer des matchs, de.manoeuvrer de l argent — n a pas ete
 * banni.
 */

const writes = { sanctions: [], reports: [] };
const reportRow = { current: null };

const makeThenable = (result) => {
  const t = {
    eq() { return t; },
    select() { return t; },
    order() { return t; },
    range() { return Promise.resolve(result); },
    then(onOk) { return Promise.resolve(onOk(result)); },
  };
  return t;
};

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn((table) => {
      // Chaque table expose les DEUX operations : `resolveReport` lit puis
      // ecrit sur `user_reports`, et un mock qui n offeringait qu une des
      // deux echouerait sur l'autre.
      const selectResult = table === 'user_reports'
        ? { data: reportRow.current ? [reportRow.current] : [], error: null }
        : { data: [], error: null };
      return {
        select: vi.fn(() => makeThenable(selectResult)),
        upsert: vi.fn((payload) => {
          if (table === 'user_sanctions') writes.sanctions.push(payload);
          else writes.reports.push(payload);
          return Promise.resolve({ error: null });
        }),
      };
    }),
  },
}));

import {
  createSanction,
  revokeSanction,
  getBlockingSanction,
  getActiveSanctions,
  listSanctionsForUser,
  resolveReport,
} from './persistence.mjs';

beforeEach(() => {
  writes.sanctions.length = 0;
  writes.reports.length = 0;
  reportRow.current = null;
});

describe('createSanction — ce qui bloque, ce qui ne bloque pas', () => {
  it('un avertissement n empeche PAS de jouer', () => {
    // Un avertissement est une trace. Bloquer dessus reviendrait a punir
    // deux fois, ou a bloquer un joueur qui ne l'a pas merite.
    return createSanction({ userId: 'U1', kind: 'warning', issuedBy: 'A1' }).then((r) => {
      expect(r.ok).toBe(true);
      expect(getActiveSanctions('U1')).toHaveLength(1);
      expect(getBlockingSanction('U1')).toBeNull();
    });
  });

  it('un bannissement temporaire EMPECHE de jouer', () => {
    return createSanction({ userId: 'U2', kind: 'temporary_ban', issuedBy: 'A1', durationDays: 7 }).then((r) => {
      expect(r.ok).toBe(true);
      expect(getBlockingSanction('U2')).not.toBeNull();
      expect(getBlockingSanction('U2').kind).toBe('temporary_ban');
    });
  });

  it('un bannissement definitif EMPECHE de jouer, sans echeance', () => {
    return createSanction({ userId: 'U3', kind: 'permanent_ban', issuedBy: 'A1' }).then(() => {
      const blocking = getBlockingSanction('U3');
      expect(blocking.kind).toBe('permanent_ban');
      expect(blocking.expiresAt).toBeNull();
    });
  });

  it('un definitif prime sur un temporaire en cours', () => {
    return Promise.all([
      createSanction({ userId: 'U4', kind: 'temporary_ban', issuedBy: 'A1', durationDays: 2 }),
      createSanction({ userId: 'U4', kind: 'permanent_ban', issuedBy: 'A1' }),
    ]).then(() => {
      expect(getBlockingSanction('U4').kind).toBe('permanent_ban');
    });
  });

  it('refuse une sanction sans joueur, sans type ou sans auteur', () => {
    return Promise.all([
      createSanction({ kind: 'warning', issuedBy: 'A1' }),
      createSanction({ userId: 'U5', issuedBy: 'A1' }),
      createSanction({ userId: 'U5', kind: 'warning' }),
    ]).then((rs) => {
      expect(rs.every((r) => r.ok === false)).toBe(true);
      expect(getActiveSanctions('U5')).toHaveLength(0);
    });
  });
});

describe('une sanction temporaire se leve TOUTE SEULE', () => {
  afterEach(() => vi.useRealTimers());

  it('elle cesse de bloquer a l echeance, sans aucune intervention', async () => {
    // Aucun nettoyage en tache de fond : la verification se fait a la
    // lecture. Un joueur ne doit pas rester banni parce qu une tache n a pas
    // tourne — et le comportement doit etre exact immediatement apres un
    // redemarrage, sans attendre un premier appel.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const created = await createSanction({
      userId: 'U6', kind: 'temporary_ban', issuedBy: 'A1', durationDays: 7,
    });
    expect(created.ok).toBe(true);
    expect(getBlockingSanction('U6')).not.toBeNull();

    // J-1 : encore banni.
    vi.setSystemTime(new Date('2026-01-07T23:59:59.000Z'));
    expect(getBlockingSanction('U6')).not.toBeNull();

    // J+1 : libere, sans que personne n ait rien fait.
    vi.setSystemTime(new Date('2026-01-08T00:00:01.000Z'));
    expect(getBlockingSanction('U6')).toBeNull();
    // La sanction reste dans l historique.
    expect(listSanctionsForUser('U6')).toHaveLength(1);
  });

  it('un definitif, lui, ne se leve jamais tout seul', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    await createSanction({ userId: 'U6B', kind: 'permanent_ban', issuedBy: 'A1' });

    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    expect(getBlockingSanction('U6B')).not.toBeNull();
  });
});

describe('revokeSanction', () => {
  it('une levee rend la main au joueur', () => {
    return createSanction({ userId: 'U7', kind: 'permanent_ban', issuedBy: 'A1' })
      .then((r) => revokeSanction(r.sanction.id, 'A2'))
      .then(() => {
        expect(getBlockingSanction('U7')).toBeNull();
      });
  });

  it('la levee est conservee dans l historique', () => {
    // La ligne n est jamais supprimee : c est l historique qui fait foi en
    // cas de contestation.
    return createSanction({ userId: 'U8', kind: 'warning', issuedBy: 'A1' })
      .then((r) => revokeSanction(r.sanction.id, 'A2'))
      .then(() => {
        const histo = listSanctionsForUser('U8');
        expect(histo).toHaveLength(1);
        expect(histo[0].revokedAt).toBeTruthy();
        expect(histo[0].revokedBy).toBe('A2');
      });
  });

  it('ne leve pas deux fois la meme sanction', async () => {
    const created = await createSanction({ userId: 'U9', kind: 'warning', issuedBy: 'A1' });
    expect(await revokeSanction(created.sanction.id, 'A2')).toBe(true);
    // Une seconde levee ne doit pas ecraser qui a leve la premiere : c est
    // l historique qui fait foi.
    expect(await revokeSanction(created.sanction.id, 'A3')).toBe(false);
    expect(listSanctionsForUser('U9')[0].revokedBy).toBe('A2');
  });
});

describe('resolveReport — la trace du traitement', () => {
  it('applique la sanction ET trace qui a tranche, quand, et sur quelle base', () => {
    reportRow.current = {
      id: 'RP-X', status: 'pending', target_id: 'U10', reporter_id: 'U11',
      reason: 'harassment', payload: { targetId: 'U10', reason: 'harassment' },
      created_at: '2026-01-01T00:00:00.000Z',
    };
    return resolveReport({ reportId: 'RP-X', resolution: 'temporary_ban', adminId: 'ADMIN', durationDays: 3 }).then((r) => {
      expect(r.ok).toBe(true);
      expect(r.sanction.kind).toBe('temporary_ban');
      expect(r.sanction.issuedBy).toBe('ADMIN');
      expect(r.sanction.reportId).toBe('RP-X');
      expect(getBlockingSanction('U10')).not.toBeNull();
    });
  });

  it('un classement seul ne cree AUCUNE sanction', () => {
    reportRow.current = {
      id: 'RP-Y', status: 'pending', target_id: 'U12', reason: 'no_show',
      payload: { targetId: 'U12' }, created_at: '2026-01-01T00:00:00.000Z',
    };
    return resolveReport({ reportId: 'RP-Y', resolution: 'dismissed', adminId: 'ADMIN' }).then((r) => {
      expect(r.ok).toBe(true);
      expect(r.sanction).toBeNull();
      expect(getBlockingSanction('U12')).toBeNull();
    });
  });

  it('refuse de REJOUER un signalement deja traite', () => {
    // Idempotence = exigence de securite : rejouer creerait une seconde
    // sanction pour le meme fait.
    reportRow.current = {
      id: 'RP-Z', status: 'resolved', target_id: 'U13', reason: 'cheating',
      payload: {}, created_at: '2026-01-01T00:00:00.000Z',
    };
    return resolveReport({ reportId: 'RP-Z', resolution: 'permanent_ban', adminId: 'ADMIN' }).then((r) => {
      expect(r.ok).toBe(false);
      expect(r.code).toBe('ALREADY_REVIEWED');
      expect(getBlockingSanction('U13')).toBeNull();
    });
  });

  it('refuse un signalement inexistant', () => {
    reportRow.current = null;
    return resolveReport({ reportId: 'RP-ABSENT', resolution: 'warning', adminId: 'ADMIN' }).then((r) => {
      expect(r.ok).toBe(false);
      expect(r.code).toBe('REPORT_NOT_FOUND');
    });
  });

  it('refuse une entree incomplete', () => {
    return Promise.all([
      resolveReport({ resolution: 'warning', adminId: 'A' }),
      resolveReport({ reportId: 'RP-1', adminId: 'A' }),
      resolveReport({ reportId: 'RP-1', resolution: 'warning' }),
    ]).then((rs) => {
      expect(rs.every((r) => r.ok === false && r.code === 'INVALID_INPUT')).toBe(true);
    });
  });
});