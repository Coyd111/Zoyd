import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fedapay', () => ({
  FedaPay: { setApiKey: vi.fn(), setEnvironment: vi.fn(), apiKey: null },
  Transaction: { retrieve: vi.fn() },
}));

vi.mock('./persistence.mjs', () => ({
  hasTransactionBeenProcessed: vi.fn(),
  claimTransaction: vi.fn(),
  makeError: (code, message) => {
    const err = new Error(message);
    err.code = code;
    return err;
  },
}));

vi.mock('./wallet-engine.mjs', () => ({
  depositToWallet: vi.fn(),
  debitFromWallet: vi.fn(),
}));

import { verifyFedaPayTransactionAndCredit, isTransactionOwnedBy } from './payment-engine.mjs';
import { Transaction } from 'fedapay';
import {
  hasTransactionBeenProcessed,
  claimTransaction,
} from './persistence.mjs';
import { depositToWallet } from './wallet-engine.mjs';

const mockUser = { id: 'user-1', pseudo: 'TestPlayer' };

describe('payment-engine - verifyFedaPayTransactionAndCredit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEDAPAY_SECRET_KEY = 'sk_test_sandbox_abc';
    hasTransactionBeenProcessed.mockReturnValue(false);
    claimTransaction.mockResolvedValue(true);
  });

  it('should credit ZC on approved transaction', async () => {
    Transaction.retrieve.mockResolvedValue({
      status: 'approved',
      amount: 5000,
      description: 'ZOYD:user-1 — Recharge 500 ZC',
    });
    depositToWallet.mockResolvedValue(mockUser);

    const result = await verifyFedaPayTransactionAndCredit('TX-123', mockUser);

    expect(result.success).toBe(true);
    expect(result.amountZC).toBe(500);
    expect(depositToWallet).toHaveBeenCalledWith(
      'user-1',
      500,
      'FedaPay'
    );
    expect(claimTransaction).toHaveBeenCalledWith(
      'TX-123',
      'user-1',
      500
    );
  });

  it('should reject if FedaPay not configured', async () => {
    delete process.env.FEDAPAY_SECRET_KEY;
    await expect(
      verifyFedaPayTransactionAndCredit('TX-123', mockUser)
    ).rejects.toThrow(/configuré/);
  });

  it('should reject already processed transactions (idempotence)', async () => {
    hasTransactionBeenProcessed.mockReturnValue(true);

    await expect(
      verifyFedaPayTransactionAndCredit('TX-DUPLICATE', mockUser)
    ).rejects.toThrow(/déjà été traitée/);
  });

  it('should reject non-approved transactions', async () => {
    Transaction.retrieve.mockResolvedValue({
      status: 'pending',
      amount: 5000,
    });

    await expect(
      verifyFedaPayTransactionAndCredit('TX-PENDING', mockUser)
    ).rejects.toThrow(/vérification/);
  });

  it('should reject declined transactions', async () => {
    Transaction.retrieve.mockResolvedValue({
      status: 'declined',
      amount: 5000,
    });

    await expect(
      verifyFedaPayTransactionAndCredit('TX-DECLINED', mockUser)
    ).rejects.toThrow(/vérification/);
  });

  it('should handle FedaPay API errors gracefully', async () => {
    Transaction.retrieve.mockRejectedValue(new Error('Network error'));

    await expect(
      verifyFedaPayTransactionAndCredit('TX-ERR', mockUser)
    ).rejects.toThrow(/vérification/);
  });

  it('should compute ZC correctly (1 ZC = 10 FCFA)', async () => {
    Transaction.retrieve.mockResolvedValue({
      status: 'approved',
      amount: 15000,
      description: 'ZOYD:user-1 — Recharge 1500 ZC',
    });
    depositToWallet.mockResolvedValue(mockUser);

    const result = await verifyFedaPayTransactionAndCredit('TX-BIG', mockUser);
    expect(result.amountZC).toBe(1500);
  });

  it('should re-throw idempotence errors from DB constraint', async () => {
    Transaction.retrieve.mockResolvedValue({
      status: 'approved',
      amount: 1000,
      description: 'ZOYD:user-1 — Recharge 100 ZC',
    });
    depositToWallet.mockResolvedValue(mockUser);
    claimTransaction.mockResolvedValue(false);

    await expect(
      verifyFedaPayTransactionAndCredit('TX-RACE', mockUser)
    ).rejects.toThrow(/déjà été traitée/);
  });

  it('should reject a transaction owned by another user (anti-theft)', async () => {
    Transaction.retrieve.mockResolvedValue({
      status: 'approved',
      amount: 5000,
      description: 'ZOYD:victim-9 — Recharge 500 ZC',
    });

    await expect(
      verifyFedaPayTransactionAndCredit('TX-STOLEN', mockUser)
    ).rejects.toThrow(/ne correspond pas à ton compte/);
    expect(depositToWallet).not.toHaveBeenCalled();
    expect(claimTransaction).not.toHaveBeenCalled();
  });

  it('should accept legacy transactions matching payer phone', async () => {
    Transaction.retrieve.mockResolvedValue({
      status: 'approved',
      amount: 5000,
      description: 'Ancien format sans binding',
      customer: { phone_number: '+2290165240654' },
    });
    depositToWallet.mockResolvedValue(mockUser);
    const userWithPhone = { ...mockUser, phone: '+2290165240654' };

    const result = await verifyFedaPayTransactionAndCredit('TX-LEGACY', userWithPhone);
    expect(result.success).toBe(true);
  });
});

describe('payment-engine - isTransactionOwnedBy', () => {
  const user = { id: 'user-1', phone: '+2290165240654', email: 'User@Zoyd.com' };

  it('accepts ZOYD:userId description binding', () => {
    expect(isTransactionOwnedBy({ description: 'ZOYD:user-1 — Recharge 500 ZC' }, user)).toBe(true);
  });

  it('rejects binding to another user', () => {
    expect(isTransactionOwnedBy({ description: 'ZOYD:victim-9 — Recharge 500 ZC' }, user)).toBe(false);
  });

  it('accepts matching payer phone (legacy)', () => {
    expect(isTransactionOwnedBy({ description: 'x', customer: { phone_number: '+229 01 65 24 06 54' } }, user)).toBe(true);
  });

  it('accepts matching payer email, case-insensitive (legacy)', () => {
    expect(isTransactionOwnedBy({ description: 'x', customer: { email: 'user@zoyd.com' } }, user)).toBe(true);
  });

  it('rejects when nothing matches', () => {
    expect(isTransactionOwnedBy({ description: 'x', customer: { phone_number: '+22800000000', email: 'stranger@x.com' } }, user)).toBe(false);
    expect(isTransactionOwnedBy({}, user)).toBe(false);
    expect(isTransactionOwnedBy(null, user)).toBe(false);
  });
});
