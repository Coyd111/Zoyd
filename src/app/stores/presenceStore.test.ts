import { describe, it, expect, beforeEach, vi } from 'vitest';

const { emitPresenceJoin, emitPresenceLeave, emitTypingUpdate, isRealtimeSocketConnected } =
  vi.hoisted(() => ({
    emitPresenceJoin: vi.fn(),
    emitPresenceLeave: vi.fn(),
    emitTypingUpdate: vi.fn(),
    emitChannelSeen: vi.fn(),
    isRealtimeSocketConnected: vi.fn(() => true),
  }));

vi.mock('../lib/realtimeClient', () => ({
  emitPresenceJoin,
  emitPresenceLeave,
  emitTypingUpdate,
  isRealtimeSocketConnected,
}));

import { usePresenceStore } from './presenceStore';

/**
 * `presenceStore` couvre qui est present dans un salon et qui tape. Aucun test
 * ne l'atteignait (11 %).
 *
 * Deux risques precis sont verrouilles ici :
 *
 *  - la fusion d une arrivee et d un depart, qui peut faire disparaitre un
 *    joueur de l ecran alors qu il est encore dans le match ;
 *  - la purge des salons, qui borne la memoire : un salon oublie ne doit pas
 *    laisser un joueur « en ligne » pour toujours.
 */

const member = (over: Record<string, unknown> = {}) => ({
  userId: 'U1',
  pseudo: 'Alice',
  role: 'player',
  team: 0,
  isCheckedIn: false,
  isReady: false,
  isOnline: true,
  lastActiveAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const reset = () => {
  usePresenceStore.setState({
    activeChannelIds: [],
    roomPresence: {},
    typingByChannel: {},
    seenByChannel: {},
  } as never);
};

describe('presenceStore — arrivee dans un salon', () => {
  beforeEach(() => {
    reset();
    emitPresenceJoin.mockClear();
    isRealtimeSocketConnected.mockReturnValue(true);
  });

  it('ajoute le membre et marque le salon actif', () => {
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice', { role: 'player', team: 0 });

    const state = usePresenceStore.getState();
    expect(state.activeChannelIds).toEqual(['CH-1']);
    expect(state.getChannelPresence('CH-1')).toHaveLength(1);
    expect(state.getChannelPresence('CH-1')[0].pseudo).toBe('Alice');
  });

  it('ne duplique pas un membre deja present', () => {
    // Sans cela, deux arrivees du meme joueur l'afficheraient deux fois dans
    // le salon.
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice');
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice');
    expect(usePresenceStore.getState().getChannelPresence('CH-1')).toHaveLength(1);
  });

  it('met a jour les details d un membre deja connu', () => {
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice', { isCheckedIn: false });
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice', { isCheckedIn: true });

    const found = usePresenceStore.getState().getChannelPresence('CH-1')[0];
    expect(found.isCheckedIn).toBe(true);
  });

  it('n ajoute pas deux fois le salon actif', () => {
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice');
    usePresenceStore.getState().joinChannel('CH-1', 'U2', 'Bob');
    expect(usePresenceStore.getState().activeChannelIds).toEqual(['CH-1']);
  });

  it('emet vers le socket seulement si la connexion est etablie', () => {
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice');
    expect(emitPresenceJoin).toHaveBeenCalledTimes(1);

    emitPresenceJoin.mockClear();
    isRealtimeSocketConnected.mockReturnValue(false);
    usePresenceStore.getState().joinChannel('CH-2', 'U1', 'Alice');

    // L etat local doit TOUJOURS se mettre a jour : sans socket, le joueur
    // doit voir sa propre presence, sinon le salon parait vide.
    expect(emitPresenceJoin).not.toHaveBeenCalled();
    expect(usePresenceStore.getState().getChannelPresence('CH-2')).toHaveLength(1);
  });
});

describe('presenceStore — sortie de salon', () => {
  beforeEach(reset);

  it('marque le membre hors ligne sans le supprimer', () => {
    // Le supprimer le ferait disparaitre du salon alors qu il est encore dans
    // le match : on le passe simplement hors ligne.
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice');
    usePresenceStore.getState().leaveChannel('CH-1', 'U1');

    const state = usePresenceStore.getState();
    expect(state.activeChannelIds).not.toContain('CH-1');
    const members = state.getChannelPresence('CH-1');
    expect(members).toHaveLength(1);
    expect(members[0].isOnline).toBe(false);
  });

  it('ne leve pas sur un salon inconnu', () => {
    expect(() => usePresenceStore.getState().leaveChannel('INCONNU', 'U1')).not.toThrow();
  });

  it('ne touche pas aux autres membres du salon', () => {
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice');
    usePresenceStore.getState().joinChannel('CH-1', 'U2', 'Bob');
    usePresenceStore.getState().leaveChannel('CH-1', 'U1');

    const members = usePresenceStore.getState().getChannelPresence('CH-1');
    expect(members.find((m) => m.userId === 'U2')?.isOnline).toBe(true);
  });
});

describe('presenceStore — marquage vu', () => {
  beforeEach(reset);

  it('enregistre qu un salon a ete vu', () => {
    usePresenceStore.getState().markChannelSeen('CH-1', 'U1');
    const seen = usePresenceStore.getState().seenByChannel;
    expect(Object.keys(seen)).toContain('CH-1');
    expect(Object.keys(seen['CH-1'])).toContain('U1');
  });

  it('ne leve pas sur un salon inconnu', () => {
    expect(() => usePresenceStore.getState().markChannelSeen('INCONNU', 'U1')).not.toThrow();
  });
});

describe('presenceStore — saisie en cours', () => {
  beforeEach(() => {
    reset();
    emitTypingUpdate.mockClear();
  });

  it('enregistre puis retire le typage', () => {
    usePresenceStore.getState().setTyping('CH-1', 'U1', 'Alice', true);
    expect(usePresenceStore.getState().getTypingUsers('CH-1')).toHaveLength(1);

    usePresenceStore.getState().setTyping('CH-1', 'U1', 'Alice', false);
    expect(usePresenceStore.getState().getTypingUsers('CH-1')).toHaveLength(0);
  });

  it('exclut l utilisateur courant de la liste affichee', () => {
    // Sans cela, le joueur voit son propre « Alice est en train d ecrire »,
    // ce qui est incoherent et revele une logique defiltrage cassee.
    usePresenceStore.getState().setTyping('CH-1', 'U1', 'Alice', true);
    usePresenceStore.getState().setTyping('CH-1', 'U2', 'Bob', true);

    const forU1 = usePresenceStore.getState().getTypingUsers('CH-1', 'U1');
    expect(forU1.map((t) => t.userId)).toEqual(['U2']);
  });

  it('sans identifiant courant, personne n est exclu', () => {
    usePresenceStore.getState().setTyping('CH-1', 'U1', 'Alice', true);
    expect(usePresenceStore.getState().getTypingUsers('CH-1')).toHaveLength(1);
  });

  it('remplace le pseudo si le joueur tape de nouveau', () => {
    usePresenceStore.getState().setTyping('CH-1', 'U1', 'Alice', true);
    usePresenceStore.getState().setTyping('CH-1', 'U1', 'Alice', true);
    expect(usePresenceStore.getState().getTypingUsers('CH-1')).toHaveLength(1);
  });
});

describe('presenceStore — instantanes du serveur', () => {
  beforeEach(reset);

  it('applique un instantane de presence du serveur', () => {
    usePresenceStore.getState().applyServerPresenceSnapshot({
      channelId: 'CH-1',
      members: [member({ userId: 'U9', pseudo: 'Zoe', isOnline: true })],
    } as never);

    const members = usePresenceStore.getState().getChannelPresence('CH-1');
    expect(members).toHaveLength(1);
    expect(members[0].pseudo).toBe('Zoe');
  });

  it('applique un instantane de saisie du serveur', () => {
    usePresenceStore.getState().applyServerTypingSnapshot({
      channelId: 'CH-1',
      members: [{ userId: 'U9', pseudo: 'Zoe', since: '2026-01-01T00:00:00.000Z' }],
    } as never);

    expect(usePresenceStore.getState().getTypingUsers('CH-1')).toHaveLength(1);
  });

  it('tolere un instantane vide', () => {
    expect(() =>
      usePresenceStore.getState().applyServerPresenceSnapshot({ channelId: 'CH-1', members: [] } as never)
    ).not.toThrow();
    expect(() =>
      usePresenceStore.getState().applyServerTypingSnapshot({ channelId: 'CH-1', members: [] } as never)
    ).not.toThrow();
  });
});

describe('presenceStore — synthese et purge', () => {
  beforeEach(reset);

  it('compte les joueurs en ligne, presentes et prets', () => {
    usePresenceStore.setState({
      roomPresence: {
        'CH-1': [
          member({ userId: 'U1', isOnline: true, isCheckedIn: true, isReady: true }),
          member({ userId: 'U2', isOnline: true, isCheckedIn: true, isReady: false }),
          member({ userId: 'U3', isOnline: false, isCheckedIn: false, isReady: false }),
        ],
      },
    } as never);

    const summary = usePresenceStore.getState().getPresenceSummary('CH-1');
    expect(summary.onlineCount).toBe(2);
    expect(summary.checkedInCount).toBe(2);
    expect(summary.readyCount).toBe(1);
  });

  it('signale un arbitre en ligne, et son absence', () => {
    usePresenceStore.setState({
      roomPresence: {
        'CH-1': [member({ userId: 'A1', role: 'arbiter', isOnline: true })],
        'CH-2': [member({ userId: 'A1', role: 'arbiter', isOnline: false })],
      },
    } as never);

    expect(usePresenceStore.getState().getPresenceSummary('CH-1').arbiterOnline).toBe(true);
    expect(usePresenceStore.getState().getPresenceSummary('CH-2').arbiterOnline).toBe(false);
  });

  it('resume un salon inconnu sans lever', () => {
    const summary = usePresenceStore.getState().getPresenceSummary('INCONNU');
    expect(summary.onlineCount).toBe(0);
    expect(summary.arbiterOnline).toBe(false);
  });

  it('un salon vide n est pas considere comme actif', () => {
    expect(usePresenceStore.getState().isChannelLive('CH-1')).toBe(false);
  });

  it('clearPresence reinitialise tout', () => {
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice');
    usePresenceStore.getState().setTyping('CH-1', 'U1', 'Alice', true);
    usePresenceStore.getState().markChannelSeen('CH-1', 'U1');

    usePresenceStore.getState().clearPresence();

    const state = usePresenceStore.getState();
    expect(state.activeChannelIds).toEqual([]);
    expect(state.roomPresence).toEqual({});
    expect(state.typingByChannel).toEqual({});
    expect(state.seenByChannel).toEqual({});
  });

  it('clearPresence est sur : un logout ne doit pas laisser de presence', () => {
    // Une presence fantome apres deconnexion afficherait un joueur « present »
    // dans un salon ou il n est plus.
    usePresenceStore.getState().joinChannel('CH-1', 'U1', 'Alice');
    usePresenceStore.getState().clearPresence();
    expect(usePresenceStore.getState().getChannelPresence('CH-1')).toEqual([]);
  });
});