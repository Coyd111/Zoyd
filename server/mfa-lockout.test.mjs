import { describe, it, expect, vi } from 'vitest';

// Même mock que persistence.test.mjs : Supabase absent, mémoire seule.
vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const find = { eq: vi.fn(() => Promise.resolve({ data: [], error: null, count: 0 })) };
      return {
        select: vi.fn(() => find),
        update: vi.fn(() => find),
        delete: vi.fn(() => find),
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
    }),
  },
}));

import * as persistence from './persistence.mjs';

describe('verrouillage 2FA par compte — helpers persistants', () => {
  it('compte les échecs et verrouille après le seuil', async () => {
    const adminId = 'admin-mfa-' + Date.now();
    persistence.clearMfaFailures(adminId);
    expect((await persistence.getMfaLockState(adminId)).lockedUntil).toBeNull();
    for (let i = 0; i < 4; i += 1) {
      const next = await persistence.recordMfaFailure(adminId);
      expect(next.lockedUntil).toBeNull();
    }
    const fifth = await persistence.recordMfaFailure(adminId);
    expect(fifth.lockedUntil).toBeGreaterThan(Date.now());
    const locked = await persistence.getMfaLockState(adminId);
    expect(locked.lockedUntil).toBeGreaterThan(Date.now());
    persistence.clearMfaFailures(adminId);
    expect((await persistence.getMfaLockState(adminId)).lockedUntil).toBeNull();
  });

  it('unj compte isolé n affecte pas un autre admin', async () => {
    const a = 'admin-mfa-a-' + Date.now();
    const b = 'admin-mfa-b-' + Date.now();
    persistence.clearMfaFailures(a);
    persistence.clearMfaFailures(b);
    for (let i = 0; i < 5; i += 1) await persistence.recordMfaFailure(a);
    expect((await persistence.getMfaLockState(a)).lockedUntil).toBeGreaterThan(Date.now());
    expect((await persistence.getMfaLockState(b)).lockedUntil).toBeNull();
    persistence.clearMfaFailures(a);
    persistence.clearMfaFailures(b);
  });
});
