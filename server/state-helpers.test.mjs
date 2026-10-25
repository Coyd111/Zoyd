import { describe, it, expect, vi, beforeEach } from 'vitest';

// `state-helpers.mjs` tire `push-notifications.mjs` -> `vapid-keys.mjs`, qui
// leve au chargement si les cles VAPID ne sont pas definies (cas du test
// unitaire). On coupe cette branche : ce fichier ne teste que la
// sanitisation, qui est une fonction PURE.
vi.mock('./push-notifications.mjs', () => ({
  broadcastStateSnapshot: vi.fn(),
  deliverNotification: vi.fn(),
}));

// Comptes simules pour tester la resolution du pseudo VIVANT. On garde le
// reste du module reel : seul `getUserById` est remplace.
const accounts = new Map();
vi.mock('./persistence.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getUserById: (id) => accounts.get(id) || null };
});

const { sanitizeMatchForBroadcast, toPublicBrLobby } = await import('./state-helpers.mjs');

/**
 * Ces tests verrouillent l'absence d'identifiant joueur dans ce qui part
 * vers le client. Ils ont ete ecrits parce que deux fuites ont existe :
 *   - `result.confirmedByTeams` (tableau de userIds) diffuse a chaque socket
 *   - la diffusion socket des lobbies BR envoyait l'etat BRUT
 * Les deux contournaient la sanitisation HTTP.
 */

const PLAYER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const ARBITER_ID = '33333333-3333-4333-8333-333333333333';

describe('sanitizeMatchForBroadcast — aucune fuite de userId', () => {
  const match = () => ({
    id: 'M-1',
    roomName: 'SALLE-1',
    roomPassword: 'secret',
    arbiter: { userId: ARBITER_ID, pseudo: 'ARB' },
    players: [
      { userId: PLAYER_ID, pseudo: 'P1', isCheckedIn: true },
      { userId: OTHER_ID, pseudo: 'P2', isCheckedIn: false },
    ],
    result: {
      winnerTeam: 0,
      confirmedByTeams: [PLAYER_ID, OTHER_ID],
      screenshots: ['data:image/png;base64,AAA'],
      proofs: ['preuve'],
    },
  });

  it('retire confirmedByTeams du resultat diffuse', () => {
    const safe = sanitizeMatchForBroadcast(match(), PLAYER_ID);
    const raw = JSON.stringify(safe);
    // C'etait LA fuite : chaque socket recevait les userIds des confirmants.
    expect(raw).not.toContain(PLAYER_ID);
    expect(raw).not.toContain(OTHER_ID);
    expect(raw).not.toContain(ARBITER_ID);
  });

  it('conserve les infos de confirmation au format isMe / hasConfirmed', () => {
    const safe = sanitizeMatchForBroadcast(match(), PLAYER_ID);
    const me = safe.players.find((p) => p.pseudo === 'P1');
    const other = safe.players.find((p) => p.pseudo === 'P2');
    expect(me.isMe).toBe(true);
    expect(other.isMe).toBe(false);
    expect(me.hasConfirmed).toBe(true);
    expect(other.hasConfirmed).toBe(true);
    expect(safe.arbiter.isMe).toBe(false);
  });

  it('ne laisse ni salle ni captures dans le payload', () => {
    const raw = JSON.stringify(sanitizeMatchForBroadcast(match(), PLAYER_ID));
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('SALLE-1');
    expect(raw).not.toContain('preuve');
  });

  it('remappe match.payouts en isMe sans exposer les UUID (A9)', () => {
    // Les versements reels (A9) rejoignent le payload public avec leur
    // montant, mais l'UUID de chaque paye doit suivre la meme regle que le
    // roster : remplace par `isMe`. Sans cela, une reponse publique
    // embarquait l'identifiant interne de chaque gagnant.
    const avecPayouts = {
      ...match(),
      payouts: [
        { userId: PLAYER_ID, pseudo: 'P1', amount: 196, type: 'prize_win', paidAt: '2026-01-01T00:00:00Z' },
        { userId: OTHER_ID, pseudo: 'P2', amount: 196, type: 'prize_win', paidAt: '2026-01-01T00:00:00Z' },
        { userId: ARBITER_ID, pseudo: 'ARB', amount: 4, type: 'arbitration_fee', paidAt: '2026-01-01T00:00:00Z' },
      ],
    };
    const safe = sanitizeMatchForBroadcast(avecPayouts, PLAYER_ID);
    const raw = JSON.stringify(safe);
    expect(raw).not.toContain(PLAYER_ID);
    expect(raw).not.toContain(OTHER_ID);
    expect(raw).not.toContain(ARBITER_ID);
    expect(safe.payouts).toHaveLength(3);
    expect(safe.payouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pseudo: 'P1', amount: 196, isMe: true }),
        expect.objectContaining({ pseudo: 'P2', isMe: false }),
        expect.objectContaining({ pseudo: 'ARB', amount: 4, isMe: false }),
      ]),
    );
    expect(safe.payouts.every((p) => p.userId === undefined)).toBe(true);
  });
});

/**
 * Un joueur peut renommer son pseudo comme en jeu. L'arbitre doit voir le nom
 * ACTUEL tant que le match n'est pas termine, et un repere STABLE a cote,
 * parce qu'un nom libre ne prouve rien : n'importe qui peut s'appeler comme
 * quelqu'un d'autre. Une fois le resultat soumis, l'historique ne se
 * reecrit pas — sinon on pourrait renommer apres une defaite pour la
 * disparaitre.
 */
describe('sanitizeMatchForBroadcast — identite des joueurs', () => {
  beforeEach(() => {
    accounts.clear();
    accounts.set(PLAYER_ID, { id: PLAYER_ID, pseudo: 'NouveauNom', gameId: 'CO-777' });
    accounts.set(OTHER_ID, { id: OTHER_ID, pseudo: 'Invaincu', gameId: 'CO-888' });
  });

  const matchWith = (status) => ({
    id: 'M-2',
    status,
    players: [
      { userId: PLAYER_ID, pseudo: 'AncienNom', isCheckedIn: true },
      { userId: OTHER_ID, pseudo: 'Invaincu', isCheckedIn: false },
    ],
  });

  it.each(['recruiting', 'full', 'check_in', 'ready', 'in_progress'])(
    'suit le pseudo vivant en %s',
    (status) => {
      const safe = sanitizeMatchForBroadcast(matchWith(status), PLAYER_ID);
      expect(safe.players[0].pseudo).toBe('NouveauNom');
    },
  );

  it.each(['awaiting_confirmation', 'finished', 'disputed', 'cancelled', 'forfeited'])(
    'fige le pseudo en %s',
    (status) => {
      const safe = sanitizeMatchForBroadcast(matchWith(status), PLAYER_ID);
      expect(safe.players[0].pseudo).toBe('AncienNom');
    },
  );

  it('expose le gameId comme repere stable', () => {
    const safe = sanitizeMatchForBroadcast(matchWith('in_progress'), PLAYER_ID);
    expect(safe.players[0].gameId).toBe('CO-777');
    expect(safe.players[1].gameId).toBe('CO-888');
  });

  it('ne laisse pas disparaitre un joueur dont le compte a disparu', () => {
    accounts.delete(PLAYER_ID);
    const safe = sanitizeMatchForBroadcast(matchWith('in_progress'), PLAYER_ID);
    expect(safe.players[0].pseudo).toBe('AncienNom');
  });

  it('ne laisse pas fuir le userId en ajoutant le pseudo vivant', () => {
    const raw = JSON.stringify(sanitizeMatchForBroadcast(matchWith('in_progress'), PLAYER_ID));
    expect(raw).not.toContain(PLAYER_ID);
    expect(raw).not.toContain(OTHER_ID);
  });

  it('garde le vrai gameId et pas un gameId injectable par le client', () => {
    const match = matchWith('in_progress');
    // Un snapshot forger par un client ne doit pas pouvoir maquiller l'ID.
    match.players[0].gameId = 'CO-FAUX';
    const safe = sanitizeMatchForBroadcast(match, PLAYER_ID);
    expect(safe.players[0].gameId).toBe('CO-777');
  });
});

describe('toPublicBrLobby — aucune fuite de userId', () => {
  const lobby = () => ({
    id: 'BR-1',
    creatorId: ARBITER_ID,
    arbiterId: ARBITER_ID,
    creatorPseudo: 'ZOYD Control',
    teams: [{ id: 'T-1', key: `solo-${PLAYER_ID}` }],
    players: [
      {
        userId: PLAYER_ID, pseudo: 'P1', teamId: 'T-1', killedBy: OTHER_ID,
        alive: false, kills: 1, placement: 2,
      },
    ],
  });

  it('retire userId, killedBy et teams[].key', () => {
    const raw = JSON.stringify(toPublicBrLobby(lobby()));
    expect(raw).not.toContain(PLAYER_ID);
    expect(raw).not.toContain(OTHER_ID);
    expect(raw).not.toContain(ARBITER_ID);
  });

  it('conserve ce dont l UI a besoin (pseudo, teamId, placement)', () => {
    const safe = toPublicBrLobby(lobby());
    expect(safe.players[0].pseudo).toBe('P1');
    expect(safe.players[0].teamId).toBe('T-1');
    expect(safe.players[0].placement).toBe(2);
    expect(safe.creatorPseudo).toBe('ZOYD Control');
  });

  it('porte le role arbitre via un booleen, pas via un id', () => {
    expect(toPublicBrLobby(lobby(), { isArbiter: true }).isArbiter).toBe(true);
    expect(toPublicBrLobby(lobby()).isArbiter).toBe(false);
  });
});

/**
 * S4 - les preuves de match et les identifiants de compte ne sortent plus
 * dans une reponse publique.
 *
 * Trois fuites ont cohabite dans le payload : `creatorId` (UUID de compte),
 * `disputes[].requestedBy` / `openedByPseudo` + `evidence` (l'auteur du
 * litige et ses URL de captures saisies librement), et `result.proofHash`
 * (qui, malgre son nom, est la CONCATENATION des URL de captures - pas un
 * condense). Le litige lui-meme reste visible (statut, niveau) : seul ce
 * qui relie un compte ou publie une URL franchit la barriere. Les pieces
 * jointes continuent de sortir pour les personnes habilitees : les parties,
 * l'arbitre et un admin - le modele du `isMe`.
 */
describe('sanitizeMatchForBroadcast — litiges et preuves (S4)', () => {
  const CAPTURE_URL = 'https://img.zoyd.test/capture-scoreboard.png';
  const OTHER_PLAYER_ID = '44444444-4444-4444-8444-444444444444';

  const disputeMatch = () => ({
    id: 'M-DSP',
    status: 'disputed',
    creatorId: PLAYER_ID,
    creatorPseudo: 'Crea',
    arbiter: { userId: ARBITER_ID, pseudo: 'ARB' },
    players: [
      { userId: PLAYER_ID, pseudo: 'P1' },
      { userId: OTHER_ID, pseudo: 'P2' },
    ],
    disputes: [{
      id: 'DSP-1',
      level: 1,
      status: 'open',
      reason: 'Score invente',
      evidence: [CAPTURE_URL],
      requestedBy: PLAYER_ID,
      openedByPseudo: 'P1',
      openedAt: '2026-01-01T00:00:00.000Z',
      prizePoolFrozen: true,
    }],
    dispute: {
      id: 'DSP-1',
      status: 'open',
      reason: 'Score invente',
      evidence: [CAPTURE_URL],
      requestedBy: PLAYER_ID,
      openedByPseudo: 'P1',
    },
    result: {
      winnerTeam: 0,
      proofHash: `m-dsp|0|2|1|${CAPTURE_URL.toLowerCase()}`,
    },
  });

  beforeEach(() => {
    accounts.clear();
  });

  it('anonyme : ni identite du createur, ni demandeur, ni URL de preuve', () => {
    const raw = JSON.stringify(sanitizeMatchForBroadcast(disputeMatch(), null));

    expect(raw).not.toContain(PLAYER_ID);
    expect(raw).not.toContain(ARBITER_ID);
    expect(raw).not.toContain(CAPTURE_URL);
    expect(raw).not.toContain('scoreboard');
    expect(raw).not.toContain('proofHash');
    expect(raw).not.toContain('requestedBy');
    expect(raw).not.toContain('openedByPseudo');
    // La structure du litige reste lisible : statut et raison.
    const safe = JSON.parse(raw);
    expect(safe.disputes[0].status).toBe('open');
    expect(safe.disputes[0].reason).toBe('Score invente');
    expect(safe.disputes[0].evidence).toEqual([]);
    expect(safe.dispute.evidence).toEqual([]);
    // Les elements non sensibles du resultat continuent de sortir : seul le
    // faux "hash" est retire.
    expect(safe.result.winnerTeam).toBe(0);
  });

  it('partie du litige : preuve visible, identite du createur toujours masquee', () => {
    const raw = JSON.stringify(sanitizeMatchForBroadcast(disputeMatch(), PLAYER_ID));

    // La piece jointe reste accessible aux parties (c'est le but du litige).
    expect(raw).toContain(CAPTURE_URL);
    // Mais l'.UUID de l'auteur ne fuit pas, meme pour une partie.
    expect(raw).not.toContain('proofHash');
  });

  it('arbitre : preuve visible', () => {
    const raw = JSON.stringify(sanitizeMatchForBroadcast(disputeMatch(), ARBITER_ID));
    expect(raw).toContain(CAPTURE_URL);
  });

  it('admin : preuve visible (il doit juger le litige)', () => {
    const ADMIN_ID = '55555555-5555-4555-8555-555555555555';
    accounts.set(ADMIN_ID, { id: ADMIN_ID, pseudo: 'ADMIN', role: 'admin' });

    const raw = JSON.stringify(sanitizeMatchForBroadcast(disputeMatch(), ADMIN_ID));
    expect(raw).toContain(CAPTURE_URL);
    // L'admin non partenaire ne recoit pas non plus les UUID des joueurs.
    expect(raw).not.toContain(PLAYER_ID);
    expect(raw).not.toContain('requestedBy');
  });

  it('lecteur hors partie : preuve masquee', () => {
    const raw = JSON.stringify(sanitizeMatchForBroadcast(disputeMatch(), OTHER_PLAYER_ID));
    expect(raw).not.toContain(CAPTURE_URL);
  });
});
