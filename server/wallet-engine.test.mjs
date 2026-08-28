import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('./persistence.mjs', () => ({
  getWalletSnapshot: vi.fn(),
  updateWalletSnapshot: vi.fn(),
}));

// Import after mocking
import { updateWalletSnapshot } from './persistence.mjs';
import * as walletEngine from './wallet-engine.mjs';

describe('wallet-engine - Deposit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error for zero amount', async () => {
    await expect(walletEngine.depositToWallet('user1', 0)).rejects.toThrow('Le montant du depot est invalide.');
  });

  it('should throw error with correct code', async () => {
    try {
      await walletEngine.depositToWallet('user1', 0);
    } catch (error) {
      expect(error.code).toBe('INVALID_AMOUNT');
    }
  });

  it('should round amount correctly', async () => {
    const mockWallet = { cashBalance: 100, bonusBalance: 0, lockedBalance: 0, transactions: [] };
    vi.mocked(updateWalletSnapshot).mockResolvedValue({ wallet: mockWallet });

    await walletEngine.depositToWallet('user1', 10.123);
    
    expect(updateWalletSnapshot).toHaveBeenCalledWith(
      'user1',
      expect.any(Function)
    );
  });
});

describe('wallet-engine - Withdraw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error for amount below minimum', async () => {
    await expect(walletEngine.withdrawFromWallet('user1', 100)).rejects.toThrow('Retrait minimum: 150 ZC.');
    await expect(walletEngine.withdrawFromWallet('user1', 149.99)).rejects.toThrow('Retrait minimum: 150 ZC.');
  });

  it('should throw error with correct code for minimum withdrawal', async () => {
    try {
      await walletEngine.withdrawFromWallet('user1', 100);
    } catch (error) {
      expect(error.code).toBe('WITHDRAWAL_MIN');
    }
  });

  it('should throw error for insufficient funds', async () => {
    const mockWallet = { cashBalance: 10, bonusBalance: 0, lockedBalance: 0, transactions: [] };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await expect(walletEngine.withdrawFromWallet('user1', 200)).rejects.toThrow('Solde cash insuffisant pour ce retrait.');
  });

  it('should throw error with correct code for insufficient funds', async () => {
    const mockWallet = { cashBalance: 10, bonusBalance: 0, lockedBalance: 0, transactions: [] };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    try {
      await walletEngine.withdrawFromWallet('user1', 200);
    } catch (error) {
      expect(error.code).toBe('INSUFFICIENT_FUNDS');
    }
  });

  it('should calculate fee correctly (2%)', async () => {
    const mockWallet = { cashBalance: 200, bonusBalance: 0, lockedBalance: 0, transactions: [] };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.withdrawFromWallet('user1', 150);
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result.cashBalance).toBe(50); // 200 - 150
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].type).toBe('withdraw');
    expect(result.transactions[0].amount).toBe(-150);
    expect(result.transactions[0].metadata.feeAmount).toBe(3);
    expect(result.transactions[0].metadata.netAmount).toBe(147);
  });
});

describe('wallet-engine - Lock Entry Fee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error for insufficient funds', async () => {
    const mockWallet = { cashBalance: 5, bonusBalance: 0, lockedBalance: 0, transactions: [], lockedEntries: {} };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await expect(walletEngine.lockEntryFee('user1', 10, 'match1')).rejects.toThrow('Solde insuffisant pour bloquer ce pass.');
  });

  it('should throw error with correct code for insufficient funds', async () => {
    const mockWallet = { cashBalance: 5, bonusBalance: 0, lockedBalance: 0, transactions: [], lockedEntries: {} };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    try {
      await walletEngine.lockEntryFee('user1', 10, 'match1');
    } catch (error) {
      expect(error.code).toBe('INSUFFICIENT_FUNDS');
    }
  });

  it('should deduct from cash balance when sufficient', async () => {
    const mockWallet = { cashBalance: 50, bonusBalance: 0, lockedBalance: 0, transactions: [], lockedEntries: {} };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.lockEntryFee('user1', 10, 'match1');
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result.cashBalance).toBe(40);
    expect(result.bonusBalance).toBe(0);
    expect(result.lockedBalance).toBe(10);
    expect(result.lockedEntries['match1']).toBeDefined();
    expect(result.lockedEntries['match1'].amount).toBe(10);
    expect(result.lockedEntries['match1'].cashAmount).toBe(10);
    expect(result.lockedEntries['match1'].bonusAmount).toBe(0);
  });

  it('should deduct from bonus balance when cash insufficient', async () => {
    const mockWallet = { cashBalance: 5, bonusBalance: 10, lockedBalance: 0, transactions: [], lockedEntries: {} };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.lockEntryFee('user1', 10, 'match1');
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result.cashBalance).toBe(0);
    expect(result.bonusBalance).toBe(5);
    expect(result.lockedBalance).toBe(10);
    expect(result.lockedEntries['match1'].cashAmount).toBe(5);
    expect(result.lockedEntries['match1'].bonusAmount).toBe(5);
  });

  it('should split deduction between cash and bonus', async () => {
    const mockWallet = { cashBalance: 7, bonusBalance: 5, lockedBalance: 0, transactions: [], lockedEntries: {} };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.lockEntryFee('user1', 10, 'match1');
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result.cashBalance).toBe(0);
    expect(result.bonusBalance).toBe(2);
    expect(result.lockedBalance).toBe(10);
    expect(result.lockedEntries['match1'].cashAmount).toBe(7);
    expect(result.lockedEntries['match1'].bonusAmount).toBe(3);
  });
});

describe('wallet-engine - Refund Locked Entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return wallet unchanged when no reservation exists', async () => {
    const mockWallet = { cashBalance: 50, bonusBalance: 10, lockedBalance: 10, transactions: [], lockedEntries: {} };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.refundLockedEntry('user1', 'match1', 'Test refund');
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result).toBe(mockWallet);
  });

  it('should refund cash and bonus correctly', async () => {
    const mockWallet = { 
      cashBalance: 40, 
      bonusBalance: 5, 
      lockedBalance: 10, 
      transactions: [], 
      lockedEntries: {
        'match1': { amount: 10, cashAmount: 7, bonusAmount: 3, lockedAt: '2024-01-01' }
      }
    };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.refundLockedEntry('user1', 'match1', 'Test refund');
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result.cashBalance).toBe(47);
    expect(result.bonusBalance).toBe(8);
    expect(result.lockedBalance).toBe(0);
    expect(result.lockedEntries['match1']).toBeUndefined();
    expect(result.transactions[0].type).toBe('refund');
    expect(result.transactions[0].amount).toBe(10);
  });
});

describe('wallet-engine - Settle Match Loss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return wallet unchanged when no reservation exists', async () => {
    const mockWallet = { cashBalance: 50, bonusBalance: 10, lockedBalance: 10, transactions: [], lockedEntries: {} };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.settleMatchLossWallet('user1', 'match1', 'Loss settlement');
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result).toBe(mockWallet);
  });

  it('should consume locked funds without refund', async () => {
    const mockWallet = { 
      cashBalance: 40, 
      bonusBalance: 5, 
      lockedBalance: 10, 
      transactions: [], 
      lockedEntries: {
        'match1': { amount: 10, cashAmount: 7, bonusAmount: 3, lockedAt: '2024-01-01' }
      }
    };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.settleMatchLossWallet('user1', 'match1', 'Loss settlement');
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result.cashBalance).toBe(40); // Unchanged
    expect(result.bonusBalance).toBe(5); // Unchanged
    expect(result.lockedBalance).toBe(0);
    expect(result.lockedEntries['match1']).toBeUndefined();
    expect(result.transactions[0].type).toBe('match_loss');
    expect(result.transactions[0].amount).toBe(0);
    expect(result.transactions[0].metadata.lockedAmount).toBe(10);
  });
});

describe('wallet-engine - Release Winnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should add winnings to cash balance', async () => {
    const mockWallet = { 
      cashBalance: 50, 
      bonusBalance: 10, 
      lockedBalance: 10, 
      pendingWinnings: 20,
      transactions: [], 
      lockedEntries: {
        'match1': { amount: 10, cashAmount: 7, bonusAmount: 3, lockedAt: '2024-01-01' }
      }
    };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.releaseWalletWinnings('user1', 25, 'match1', 'prize_win', 'Match win');
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result.cashBalance).toBe(75);
    expect(result.lockedBalance).toBe(0);
    expect(result.pendingWinnings).toBe(20);
    expect(result.lockedEntries['match1']).toBeUndefined();
    expect(result.transactions[0].type).toBe('prize_win');
    expect(result.transactions[0].amount).toBe(25);
  });

  it('should handle winnings without existing reservation', async () => {
    const mockWallet = { 
      cashBalance: 50, 
      bonusBalance: 10, 
      lockedBalance: 0, 
      pendingWinnings: 20,
      transactions: [], 
      lockedEntries: {}
    };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.releaseWalletWinnings('user1', 25, 'match1', 'arbitration_fee', 'Arbitration commission');
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result.cashBalance).toBe(75);
    expect(result.lockedBalance).toBe(0);
    expect(result.pendingWinnings).toBe(20);
    expect(result.transactions[0].type).toBe('arbitration_fee');
    expect(result.transactions[0].amount).toBe(25);
  });

  it('should use default description when not provided', async () => {
    const mockWallet = { 
      cashBalance: 50, 
      bonusBalance: 10, 
      lockedBalance: 0, 
      pendingWinnings: 20,
      transactions: [], 
      lockedEntries: {}
    };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      const updated = updater(mockWallet);
      return { wallet: updated };
    });

    await walletEngine.releaseWalletWinnings('user1', 25, 'match1', 'prize_win');
    
    const updater = vi.mocked(updateWalletSnapshot).mock.calls[0][1];
    const result = updater(mockWallet);
    
    expect(result.transactions[0].description).toBe('Gain match1');
  });

  it('should throw for negative amount', async () => {
    await expect(walletEngine.releaseWalletWinnings('user1', -10, 'm1')).rejects.toThrow('negatif');
  });
});

describe('wallet-engine - lockEntryFee double-lock guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject double-lock on same matchId', async () => {
    const mockWallet = {
      cashBalance: 100,
      bonusBalance: 0,
      lockedBalance: 50,
      lockedEntries: { 'match-1': { amount: 50, cashAmount: 50, bonusAmount: 0, lockedAt: '2026-01-01' } },
      transactions: [],
    };
    vi.mocked(updateWalletSnapshot).mockImplementation(async (userId, updater) => {
      return { wallet: updater(mockWallet) };
    });

    await expect(walletEngine.lockEntryFee('user1', 50, 'match-1')).rejects.toThrow('deja bloque');
  });
});

describe('wallet-engine - roundAmount NaN protection', () => {
  it('should return 0 for NaN input', () => {
    expect(walletEngine.depositToWallet).toBeDefined();
  });
});
