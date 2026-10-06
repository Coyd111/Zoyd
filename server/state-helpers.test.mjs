import { describe, it, expect, vi } from 'vitest';

// `state-helpers.mjs` tire `push-notifications.mjs` -> `vapid-keys.mjs`, qui
// leve au chargement si les cles VAPID ne sont pas definies (cas du test
// unitaire). On coupe cette branche : ce fichier ne teste que la
// sanitisation, qui est une fonction PURE.
vi.mock('./push-notifications.mjs', () => ({
  broadcastStateSnapshot: vi.fn(),
  deliverNotification: vi.fn(),
}));

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
