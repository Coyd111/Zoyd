import { describe, it, expect, vi } from 'vitest';

vi.mock('fedapay', () => ({
  Webhook: { constructEvent: vi.fn() },
  FedaPay: { setApiKey: vi.fn(), setEnvironment: vi.fn(), apiKey: null },
  Transaction: { retrieve: vi.fn() },
  Payout: { retrieve: vi.fn() },
}));

vi.mock('./persistence.mjs', () => ({
  getUserById: vi.fn(() => undefined),
  listUserIds: vi.fn(() => []),
  tagWalletTransaction: vi.fn(async () => true),
  forgetWithdrawalKey: vi.fn(() => {}),
  hasTransactionBeenProcessed: vi.fn(async () => false),
  claimTransaction: vi.fn(async () => true),
  releaseTransaction: vi.fn(async () => {}),
  makeError: (code, message) => {
    const err = new Error(message);
    err.code = code;
    return err;
  },
}));

vi.mock('./wallet-engine.mjs', () => ({
  depositToWallet: vi.fn(),
  debitFromWallet: vi.fn(),
  reconcilePendingWithdrawals: vi.fn(async () => ({})),
  refundRejectedWithdrawal: vi.fn(async () => ({})),
}));

vi.mock('./push-notifications.mjs', () => ({
  deliverNotification: vi.fn(async () => true),
  sendPushToUser: vi.fn(),
  broadcastStateSnapshot: vi.fn(),
  notifyAllAdmins: vi.fn(),
}));

vi.mock('./mutex.mjs', () => ({
  withWalletMutex: async (_id, fn) => fn(),
}));

import { extractWebhookEntity, extractWebhookEventName } from './routes/webhook.mjs';

describe('webhook - formes reelles FedaPay (SDK)', () => {
  it('entity string + object = transaction', () => {
    const event = { type: 'transaction.approved', entity: 'transaction', object: { id: 777, status: 'approved', description: 'ZOYD:u-1' }, object_id: 777 };
    expect(extractWebhookEventName(event)).toBe('transaction.approved');
    expect(extractWebhookEntity(event).id).toBe(777);
  });

  it('name + entity objet (ancien format docs)', () => {
    const event = { name: 'transaction.approved', entity: { id: 888, status: 'approved', description: 'ZOYD:u-1' } };
    expect(extractWebhookEntity(event).id).toBe(888);
  });
});
