import { describe, it, expect, vi } from 'vitest';

// Même harness que les autres tests persistence : Supabase absent,
// état en mémoire. Le garde ci-dessous DOIT lever avant tout accès base.
vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
      delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
      select: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
  },
}));

import * as persistence from './persistence.mjs';

const baseUser = (overrides = {}) => ({
  id: overrides.id,
  role: 'player',
  pseudo: overrides.pseudo,
  email: overrides.email,
  phone: '66000001',
  gameId: '881000001',
  wallet: {
    cashBalance: 150,
    bonusBalance: 0,
    lockedBalance: 0,
    pendingWinnings: 0,
    lockedEntries: {},
    transactions: overrides.transactions || [],
    payoutsEnAttente: overrides.payoutsEnAttente || [],
  },
  ...overrides,
});

describe('suppression de compte — garde pending_review', () => {
  it('refuse la suppression tant qu un retrait est en pending_review', async () => {
    const user = baseUser({
      id: 'u-del-pending-' + Date.now(),
      pseudo: 'delpending',
      email: 'delpending@example.com',
      transactions: [{ id: 'TX-1', type: 'withdraw', amount: 150, status: 'pending_review', metadata: { payoutStatus: 'pending_review', payoutId: 123 } }],
    });
    persistence.forceUserCache(user.id, user);
    await expect(persistence.deleteUserAccount(user.id)).rejects.toMatchObject({ code: 'PAYOUT_PENDING_REVIEW' });
  });

  it('refuse la suppression si la file payoutsEnAttente est non vide', async () => {
    const user = baseUser({
      id: 'u-del-file-' + Date.now(),
      pseudo: 'delfile',
      email: 'delfile@example.com',
      payoutsEnAttente: [{ payoutId: 42, txId: 'TX-2', since: new Date().toISOString() }],
    });
    persistence.forceUserCache(user.id, user);
    await expect(persistence.deleteUserAccount(user.id)).rejects.toMatchObject({ code: 'PAYOUT_PENDING_REVIEW' });
  });
});
