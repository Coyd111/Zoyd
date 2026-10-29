/**
 * server/chat-helpers.test.mjs - Diffusion des canaux de chat.
 *
 * P8 C2 (audit-3) : le canal `inbox: 'all'` etait emit a TOUT LE MONDE via
 * `io.emit`, PUIS encore une fois vers la room `user:<id>` de chaque
 * participant — un participant du canal recevait deux evenements
 * `chat:channel` identiques (l'ecrasement front est idempotent, donc pur
 * bruit socket). Miroir du patron
 * deja correct de `broadcastChatMessage` sur le canal global : early
 * return apres la diffusion generale.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./persistence.mjs', () => ({
  getChatChannelById: vi.fn(),
  upsertChatChannel: vi.fn(),
  ensureGlobalChatChannel: vi.fn(),
  getChatChannelsForUser: vi.fn(),
  getUnreadCountForUser: vi.fn(),
  getChatMessagesForChannel: vi.fn(),
}));

vi.mock('./utils.mjs', () => ({
  getNow: vi.fn(() => '2026-01-01T00:00:00.000Z'),
}));

import { broadcastChatChannel, broadcastChatMessage } from './chat-helpers.mjs';

const testChannel = (overrides = {}) => ({
  id: 'chan-1',
  type: 'dm',
  name: 'Test channel',
  participants: ['u1', 'u2', 'u3'],
  scope: 'participants',
  inbox: 'participants',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/**
 * Double socket.io minimal : on enregistre les emissions GLOBALES et celles
 * visees par room (`user:<id>`), pour compter les eventuelles doubles.
 */
const makeIo = () => {
  const calls = { globals: [], rooms: [] };
  const io = {
    emit: (event, payload) => calls.globals.push({ event, payload }),
    to: (room) => ({
      emit: (event, payload) => calls.rooms.push({ room, event, payload }),
    }),
  };
  return { io, calls };
};

describe('broadcastChatChannel — dedupe des emissions (P8 C2)', () => {
  it('inbox all : un seul evenement par destinataire, la boucle participants ne re-emet plus', () => {
    const { io, calls } = makeIo();

    broadcastChatChannel(io, testChannel({ inbox: 'all', type: 'public' }));

    expect(calls.globals).toHaveLength(1);
    expect(calls.globals[0]?.event).toBe('chat:channel');
    // Avant le correctif, ce compteur valait 3 : chaque participant
    // recevait le meme canal deux fois.
    expect(calls.rooms).toHaveLength(0);
  });

  it('inbox participants : une emission par room user, rien en global', () => {
    const { io, calls } = makeIo();

    broadcastChatChannel(io, testChannel());

    expect(calls.globals).toHaveLength(0);
    expect(calls.rooms).toHaveLength(3);
    expect(calls.rooms.map((c) => c.room)).toEqual(['user:u1', 'user:u2', 'user:u3']);
    expect(calls.rooms.every((c) => c.event === 'chat:channel')).toBe(true);
  });
});

describe('broadcastChatMessage — patron miroir (deja correct, garde ici)', () => {
  it('canal global : diffusion generale seule, sans boucle participants', () => {
    const { io, calls } = makeIo();
    const channel = testChannel({ id: 'global', inbox: 'all' });
    const message = { id: 'm1', text: 'salut' };

    broadcastChatMessage(io, channel, message);

    expect(calls.globals).toHaveLength(1);
    expect(calls.globals[0]?.event).toBe('chat:message');
    expect(calls.rooms).toHaveLength(0);
  });
});
