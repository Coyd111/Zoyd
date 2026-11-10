/**
 * server/channel-presence.test.mjs - Whitelist de presence (P10 C1/C2).
 *
 * Avant le durcissement, `upsertChannelMember` appliquait TOUTES les
 * valeurs du client : `role: 'admin'` se declarable au join (frime dans
 * les snapshots), `team: -5` ou `0.5` acceptes par `presence:update`
 * (garde tronquee a `number <= 1`). La presentation est la meme borne
 * que le contrat du front (`realtimeClient.ts`) : role
 * player/arbiter/spectator, team entier 0 ou 1.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./persistence.mjs', () => ({
  getMemoryChatChannels: vi.fn(() => []),
}));

vi.mock('./utils.mjs', () => ({
  getNow: vi.fn(() => '2026-01-01T00:00:00.000Z'),
}));

import {
  PRESENCE_ROLES,
  presenceRoleOf,
  presenceTeamOf,
  upsertChannelMember,
} from './channel-presence.mjs';

const CHANNEL = 'room-1';

/** Double socket minimal : upsertChannelMember ne lit que id et join(). */
const makeSocket = (id = 's1') => ({ id, join: vi.fn() });

describe('Whitelist de presence (P10 C1/C2 audit-3)', () => {
  it("presence:join : se declarer 'admin' retombe en spectator (P10 C2)", () => {
    const socket = makeSocket();
    const member = upsertChannelMember(socket, {
      channelId: CHANNEL,
      userId: 'u-admin',
      pseudo: 'P1',
      role: 'admin',
    });
    expect(member.role).toBe('spectator');
    expect(socket.join).toHaveBeenCalledWith(CHANNEL);
  });

  it('les roles du contrat front passent tels quels', () => {
    for (const role of PRESENCE_ROLES) {
      const member = upsertChannelMember(makeSocket(`s-${role}`), {
        channelId: CHANNEL,
        userId: `u-${role}`,
        pseudo: 'P',
        role,
      });
      expect(member.role).toBe(role);
    }
  });

  it('team : -5 et 0.5 refus a la creation, 0/1 acceptes (P10 C1)', () => {
    const negatif = upsertChannelMember(makeSocket('s-neg'), {
      channelId: CHANNEL,
      userId: 'u-neg',
      pseudo: 'P',
      team: -5,
    });
    expect(negatif.team).toBeUndefined();

    const demi = upsertChannelMember(makeSocket('s-demi'), {
      channelId: CHANNEL,
      userId: 'u-demi',
      pseudo: 'P',
      team: 0.5,
    });
    expect(demi.team).toBeUndefined();

    const un = upsertChannelMember(makeSocket('s-un'), {
      channelId: CHANNEL,
      userId: 'u-un',
      pseudo: 'P',
      team: 1,
    });
    expect(un.team).toBe(1);
  });

  it('team invalide a la mise a jour : la valeur precedente est conservee', () => {
    upsertChannelMember(makeSocket('s-maintien'), {
      channelId: CHANNEL,
      userId: 'u-maintien',
      pseudo: 'P',
      team: 0,
    });
    // Deuxieme passage sur le MEME membre avec un team truque : la garde
    // doit reprendre la valeur precedente, pas celle du payload.
    const maintenu = upsertChannelMember(makeSocket('s-maintien-2'), {
      channelId: CHANNEL,
      userId: 'u-maintien',
      pseudo: 'P',
      team: 0.5,
    });
    expect(maintenu.team).toBe(0);
  });
});

describe('helpers de contrat exportes', () => {
  it('presenceTeamOf : uniquement les entiers 0 et 1', () => {
    expect(presenceTeamOf(0)).toBe(0);
    expect(presenceTeamOf(1)).toBe(1);
    expect(presenceTeamOf(-1)).toBeUndefined();
    expect(presenceTeamOf(0.5)).toBeUndefined();
    expect(presenceTeamOf(2)).toBeUndefined();
    expect(presenceTeamOf(undefined)).toBeUndefined();
  });

  it('presenceRoleOf : whitelist sinon spectator', () => {
    expect(presenceRoleOf('arbiter')).toBe('arbiter');
    expect(presenceRoleOf('player')).toBe('player');
    expect(presenceRoleOf('spectator')).toBe('spectator');
    expect(presenceRoleOf('admin')).toBe('spectator');
    expect(presenceRoleOf(undefined)).toBe('spectator');
  });
});
