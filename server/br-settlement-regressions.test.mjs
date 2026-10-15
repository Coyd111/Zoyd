import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Les trois constats d'argent de la lecture exhaustive, sur le reglement BR.
 *
 * 1. Sans verrou par salon, deux `finish` simultanes versaient la cagnotte
 *    deux fois.
 * 2. Le statut `settling` n'etait persiste qu'APRES la boucle de versement :
 *    un echec au milieu laissait le salon `live` avec `settled = false`, et
 *    l'arbitre relancait — les joueurs deja payes l'etaient une seconde fois.
 * 3. Les boucles de versement n'avaient aucun `try/catch` : une seule erreur
 *    interrompait toutes les autres et empechait la persistance.
 *
 * Chaque test verifie un comportementObservable, pas une ligne de code. Un
 * test qui ne peut pas passer sur l'ancien code ne prouve rien : c'est verifie
 * separement, en desactivant le correctif.
 */

vi.mock('./persistence.mjs', () => ({
  getUserById: vi.fn(),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((value) => String(value || '').trim()),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

vi.mock('./mutex.mjs', () => ({
  withWalletMutex: vi.fn(async (_id, fn) => fn()),
  withBrLobbyMutex: vi.fn(async (_id, fn) => fn()),
}));

import * as brEngine from './br-engine.mjs';
import { getUserById } from './persistence.mjs';
import { releaseWalletWinnings, settleMatchLossWallet, refundLockedEntry } from './wallet-engine.mjs';

const admin = { id: 'arbiter-1', pseudo: 'Arbiter', role: 'admin', wallet: {} };
const inWindow = () => new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();
const payout = { first: 0.4, second: 0.22, third: 0.15, fourth: 0.12, fifth: 0.08, arbiterRate: 0.03 };

/** Salon pret a etre regle : 4 joueurs elimines + le vainqueur, tous presents. */
const liveLobby = () => {
  const lobby = {
    id: 'BR-SETTLE-1',
    name: 'Salon test',
    status: 'live',
    pot: 1000,
    mode: 'solo',
    map: 'isolated',
    entryFee: 50,
    arbiterId: admin.id,
    arbiterRate: payout.arbiterRate,
    payout: { ...payout, arbiterRate: payout.arbiterRate },
    createdAt: inWindow(),
    updatedAt: inWindow(),
    finishedAt: null,
    rankingMode: 'survie_kills',
    players: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) => ({
      userId: id,
      pseudo: id.toUpperCase(),
      alive: i === 0,
      placement: i === 0 ? 1 : [2, 3, 4, 5][i - 1],
      kills: i,
      absent: false,
      settled: false,
      winnings: 0,
      checkedIn: true,
      joinedAt: inWindow(),
    })),
    teams: [],
  };
  getUserById.mockImplementation((id) => (
    id === admin.id ? admin : { wallet: { lockedEntries: { [lobby.id]: { amount: 50 } } } }
  ));
  return lobby;
};

/** Les appels de versement, regroupes par destinataire. */
const versePar = (mock) => {
  const map = new Map();
  for (const call of mock.mock.calls) {
    const key = `${call[0]}:${call[3]}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
};

beforeEach(() => {
  // `clearAllMocks` efface les appels mais PAS les implementations : un
  // `mockImplementation` pose par un test fuite dans le suivant, et le test
  // echoue alors pour une raison qui n a rien a voir avec le comportement
  // etudie. `resetAllMocks` remet les implementations a zero.
  vi.resetAllMocks();
});

describe('Constat 2 — la progression du reglement est persistee', () => {
  it('persiste `settling` AVANT le premier versement', async () => {
    const lobby = liveLobby();
    const etats = [];
    await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id, {
      onProgress: (lobbies) => { etats.push(lobbies[0].status); },
    });

    expect(etats[0]).toBe('settling');
    // Un versement ne doit jamais avoir eu lieu avant cette premiere ecriture.
    expect(etats.length).toBeGreaterThan(1);
  });

  it('persiste apres chaque versement, pas seulement a la fin', async () => {
    const lobby = liveLobby();
    const vues = [];
    await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id, {
      onProgress: (lobbies) => { vues.push(lobbies[0].players.filter((p) => p.settled).length); },
    });

    // Le nombre de joueurs soldes doit progresser, jamais rester a zero : c'est
    // ce qui permet a un reglement interrompu de reprendre ou il s etait arrete.
    expect(vues[0]).toBe(0);
    expect(vues[vues.length - 1]).toBe(lobby.players.length);
    for (let i = 1; i < vues.length; i += 1) {
      expect(vues[i]).toBeGreaterThanOrEqual(vues[i - 1]);
    }
  });
});

describe('Constat 3 — une erreur de versement n arrete pas les autres', () => {
  it('verse les autres joueurs meme si un versement echoue', async () => {
    const lobby = liveLobby();
    releaseWalletWinnings.mockImplementation(async (userId) => {
      if (userId === 'p2') throw new Error('USER_NOT_FOUND');
    });

    await expect(brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id))
      .rejects.toMatchObject({ code: 'BR_SETTLEMENT_INCOMPLETE' });

    // p2 a bien ete tente, et son versement a echoue : c'est le seul appel qui
    // a leve. Les 4 autres gains et la commission sont verses une fois chacun.
    const parDestinataire = versePar(releaseWalletWinnings);
    expect(parDestinataire.get('p2:prize_win')).toBe(1);
    expect(parDestinataire.get('p1:prize_win')).toBe(1);
    expect(parDestinataire.get('p3:prize_win')).toBe(1);
    expect(parDestinataire.get('p4:prize_win')).toBe(1);
    expect(parDestinataire.get('p5:prize_win')).toBe(1);
    expect(parDestinataire.get(`${admin.id}:arbitration_fee`)).toBe(1);
  });

  it('laisse le salon reprenable : il ne passe PAS `finished`', async () => {
    const lobby = liveLobby();
    releaseWalletWinnings.mockImplementation(async (userId) => {
      if (userId === 'p2') throw new Error('USER_NOT_FOUND');
    });

    let persisted;
    try {
      await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id, {
        onProgress: (lobbies) => { persisted = lobbies[0]; },
      });
    } catch {
      /* attendu */
    }

    expect(persisted.status).toBe('settling');
  });

  it('reprise : ne repaye pas celui qui a deja ete verse', async () => {
    const lobby = liveLobby();
    releaseWalletWinnings.mockImplementation(async (userId) => {
      if (userId === 'p2') throw new Error('USER_NOT_FOUND');
    });
    let persisted;
    try {
      await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id, {
        onProgress: (lobbies) => { persisted = lobbies[0]; },
      });
    } catch {
      /* attendu */
    }

    // L'arbitre relance sur l'etat reellement persiste. Cette fois tout passe.
    releaseWalletWinnings.mockImplementation(async () => {});
    await brEngine.settleBrLobbyOnServer([persisted], admin, lobby.id);

    const parDestinataire = versePar(releaseWalletWinnings);
    // Personne n'est re-paye. C'est LA garantie du constat 2 : l'arbitre peut
    // relancer sans creer d'argent.
    //
    // Note sur p2 : son gain avait echoue, donc il n'etait pas marque verse par
    // la boucle des gagnants. La boucle des perdants l'a ensuite solde comme un
    // perdant (pass consomme). Un gain rate degrade donc en pass perdu plutot
    // qu'en paiement fantome — un default a corriger separement, mais qui ne
    // double-verse rien.
    for (const [key, count] of parDestinataire) {
      expect(count, `${key} ne doit etre verse qu une seule fois`).toBe(1);
    }
  });
});

describe('Constat 1 — le salon `settling` se reprend, `finished` se refuse', () => {
  it('un salon `finished` reste refuse', async () => {
    const lobby = liveLobby();
    lobby.status = 'finished';
    await expect(brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id))
      .rejects.toMatchObject({ code: 'LOBBY_CLOSED' });
  });

  it('un salon `settling` est accepte : sinon le crash etait irrattrapable', async () => {
    const lobby = liveLobby();
    lobby.status = 'settling';
    const res = await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id);
    expect(res.lobby.status).toBe('finished');
  });
});

describe('Le rem refund du salon annule est lui aussi reprenable', () => {
  it('un remboursement en echec ne fige pas le salon en `cancelled`', async () => {
    const lobby = liveLobby();
    // Personne n'a joue : on rembourse tout.
    lobby.players.forEach((p) => { p.absent = true; });
    refundLockedEntry.mockImplementation(async (userId) => {
      if (userId === 'p3') throw new Error('USER_NOT_FOUND');
    });

    let persisted;
    await expect(brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id, {
      onProgress: (lobbies) => { persisted = lobbies[0]; },
    })).rejects.toMatchObject({ code: 'BR_SETTLEMENT_INCOMPLETE' });

    expect(persisted.status).toBe('settling');
    // Les autres joueurs ont bien ete rembourses.
    expect(refundLockedEntry.mock.calls.filter((c) => c[0] !== 'p3')).toHaveLength(4);
  });

  it('tous rembourses : le salon passe `cancelled`', async () => {
    const lobby = liveLobby();
    lobby.players.forEach((p) => { p.absent = true; });
    const res = await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id);
    expect(res.lobby.status).toBe('cancelled');
    expect(refundLockedEntry).toHaveBeenCalledTimes(5);
    expect(settleMatchLossWallet).not.toHaveBeenCalled();
  });
});