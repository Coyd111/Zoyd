import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fedapay', () => ({
  FedaPay: { setApiKey: vi.fn(), setEnvironment: vi.fn(), apiKey: null },
  Transaction: { retrieve: vi.fn() },
}));

vi.mock('./persistence.mjs', () => ({
  hasTransactionBeenProcessed: vi.fn(),
  markTransactionAsProcessed: vi.fn(),
}));

vi.mock('./wallet-engine.mjs', () => ({
  depositToWallet: vi.fn(),
}));

import { verifyFedaPayTransactionAndCredit } from './payment-engine.mjs';
import { Transaction } from 'fedapay';
import {
  hasTransactionBeenProcessed,
  markTransactionAsProcessed,
} from './persistence.mjs';
import { depositToWallet } from './wallet-engine.mjs';

const mockUser = { id: 'user-1', pseudo: 'TestPlayer' };

describe('payment-engine - verifyFedaPayTransactionAndCredit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEDAPAY_SECRET_KEY = 'sk_test_sandbox_abc';
    hasTransactionBeenProcessed.mockReturnValue(false);
  });

  it('should credit ZC on approved transaction', async () => {
    Transaction.retrieve.mockResolvedValue({
      status: 'approved',
      amount: 5000,
    });
    depositToWallet.mockReturnValue(mockUser);

    const result = await verifyFedaPayTransactionAndCredit('TX-123', mockUser);

    expect(result.success).toBe(true);
    expect(result.amountZC).toBe(500);
    expect(depositToWallet).toHaveBeenCalledWith(
      'user-1',
      500,
      'FedaPay'
    );
    expect(markTransactionAsProcessed).toHaveBeenCalledWith(
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
    });
    depositToWallet.mockReturnValue(mockUser);

    const result = await verifyFedaPayTransactionAndCredit('TX-BIG', mockUser);
    expect(result.amountZC).toBe(1500);
  });

  it('should re-throw idempotence errors from DB constraint', async () => {
    hasTransactionBeenProcessed.mockReturnValue(false);
    Transaction.retrieve.mockResolvedValue({
      status: 'approved',
      amount: 1000,
    });
    markTransactionAsProcessed.mockImplementation(() => {
      const err = new Error('UNIQUE constraint failed');
      throw err;
    });

    await expect(
      verifyFedaPayTransactionAndCredit('TX-RACE', mockUser)
    ).rejects.toThrow(/enregistrement de la transaction/);
  });
});
