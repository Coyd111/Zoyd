import { describe, it, expect, beforeEach } from 'vitest';
import { useWalletStore } from './walletStore';

describe('walletStore - Hydration', () => {
  beforeEach(() => {
    useWalletStore.setState({
      cashBalance: 0,
      bonusBalance: 0,
      lockedBalance: 0,
      pendingWinnings: 0,
      transactions: [],
      lockedEntries: {},
    });
  });

  it('should hydrate from server snapshot', () => {
    const snapshot = {
      cashBalance: 100.50,
      bonusBalance: 50.25,
      lockedBalance: 25.75,
      pendingWinnings: 10,
      transactions: [
        {
          id: 'tx1',
          type: 'deposit' as const,
          amount: 100,
          description: 'Test deposit',
          status: 'completed' as const,
          timestamp: '2024-01-01',
        },
      ],
      lockedEntries: {
        match1: {
          amount: 25,
          cashAmount: 20,
          bonusAmount: 5,
          lockedAt: '2024-01-01',
        },
      },
    };

    useWalletStore.getState().hydrateFromServer(snapshot);

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(100.5);
    expect(state.bonusBalance).toBe(50.25);
    expect(state.lockedBalance).toBe(25.75);
    expect(state.pendingWinnings).toBe(10);
    expect(state.transactions).toHaveLength(1);
    expect(state.lockedEntries['match1']).toBeDefined();
  });

  it('should handle null values in snapshot', () => {
    const snapshot = {
      cashBalance: null,
      bonusBalance: undefined,
      lockedBalance: 0,
      pendingWinnings: 0,
      transactions: null,
      lockedEntries: undefined,
    };

    useWalletStore.getState().hydrateFromServer(snapshot);

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(0);
    expect(state.bonusBalance).toBe(0);
    expect(state.transactions).toEqual([]);
    expect(state.lockedEntries).toEqual({});
  });
});

describe('walletStore - Fund Locking', () => {
  beforeEach(() => {
    useWalletStore.setState({
      cashBalance: 100,
      bonusBalance: 50,
      lockedBalance: 0,
      pendingWinnings: 0,
      transactions: [],
      lockedEntries: {},
    });
  });

  it('should lock funds successfully', () => {
    const result = useWalletStore.getState().lockFunds(30, 'match1');

    expect(result).toBe(true);
    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(70);
    expect(state.bonusBalance).toBe(50);
    expect(state.lockedBalance).toBe(30);
    expect(state.lockedEntries['match1']).toBeDefined();
    expect(state.lockedEntries['match1'].amount).toBe(30);
  });

  it('should fail when insufficient funds', () => {
    const result = useWalletStore.getState().lockFunds(200, 'match1');

    expect(result).toBe(false);
    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(100);
    expect(state.lockedBalance).toBe(0);
  });

  it('should create transaction for lock', () => {
    useWalletStore.getState().lockFunds(30, 'match1');

    const state = useWalletStore.getState();
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].type).toBe('entry_fee');
    expect(state.transactions[0].amount).toBe(-30);
  });
});

describe('walletStore - Fund Unlocking', () => {
  beforeEach(() => {
    useWalletStore.setState({
      cashBalance: 70,
      bonusBalance: 45,
      lockedBalance: 30,
      pendingWinnings: 0,
      transactions: [],
      lockedEntries: {
        match1: {
          amount: 30,
          cashAmount: 25,
          bonusAmount: 5,
          lockedAt: '2024-01-01',
        },
      },
    });
  });

  it('should unlock funds successfully', () => {
    useWalletStore.getState().unlockFunds(30, 'match1');

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(95);
    expect(state.bonusBalance).toBe(50);
    expect(state.lockedBalance).toBe(0);
    expect(state.lockedEntries['match1']).toBeUndefined();
  });

  it('should do nothing when no reservation exists', () => {
    useWalletStore.getState().unlockFunds(30, 'match2');

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(70);
    expect(state.bonusBalance).toBe(45);
    expect(state.lockedBalance).toBe(30);
  });

  it('should create refund transaction', () => {
    useWalletStore.getState().unlockFunds(30, 'match1');

    const state = useWalletStore.getState();
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].type).toBe('refund');
    expect(state.transactions[0].amount).toBe(30);
  });
});

describe('walletStore - Winnings Release', () => {
  beforeEach(() => {
    useWalletStore.setState({
      cashBalance: 70,
      bonusBalance: 45,
      lockedBalance: 30,
      pendingWinnings: 20,
      transactions: [],
      lockedEntries: {
        match1: {
          amount: 30,
          cashAmount: 25,
          bonusAmount: 5,
          lockedAt: '2024-01-01',
        },
      },
    });
  });

  it('should release winnings and unlock entry', () => {
    useWalletStore.getState().releaseWinnings(50, 'match1', 'prize_win', 'Match win');

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(120);
    expect(state.lockedBalance).toBe(0);
    expect(state.pendingWinnings).toBe(0);
    expect(state.lockedEntries['match1']).toBeUndefined();
  });

  it('should release winnings without existing reservation', () => {
    useWalletStore.setState({ lockedEntries: {} });
    useWalletStore.getState().releaseWinnings(50, 'match1', 'arbitration_fee', 'Commission');

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(120);
    expect(state.lockedBalance).toBe(0);
  });

  it('should create prize_win transaction', () => {
    useWalletStore.getState().releaseWinnings(50, 'match1', 'prize_win', 'Match win');

    const state = useWalletStore.getState();
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].type).toBe('prize_win');
    expect(state.transactions[0].amount).toBe(50);
  });

  it('should create arbitration_fee transaction', () => {
    useWalletStore.getState().releaseWinnings(10, 'match1', 'arbitration_fee');

    const state = useWalletStore.getState();
    expect(state.transactions[0].type).toBe('arbitration_fee');
  });
});

describe('walletStore - Match Loss Settlement', () => {
  beforeEach(() => {
    useWalletStore.setState({
      cashBalance: 70,
      bonusBalance: 45,
      lockedBalance: 30,
      pendingWinnings: 0,
      transactions: [],
      lockedEntries: {
        match1: {
          amount: 30,
          cashAmount: 25,
          bonusAmount: 5,
          lockedAt: '2024-01-01',
        },
      },
    });
  });

  it('should settle match loss without refund', () => {
    useWalletStore.getState().settleMatchLoss('match1', 'Loss settlement');

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(70);
    expect(state.bonusBalance).toBe(45);
    expect(state.lockedBalance).toBe(0);
    expect(state.lockedEntries['match1']).toBeUndefined();
  });

  it('should do nothing when no reservation exists', () => {
    useWalletStore.setState({ lockedEntries: {} });
    useWalletStore.getState().settleMatchLoss('match1', 'Loss settlement');

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(70);
    expect(state.bonusBalance).toBe(45);
  });

  it('should create match_loss transaction', () => {
    useWalletStore.getState().settleMatchLoss('match1', 'Loss settlement');

    const state = useWalletStore.getState();
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].type).toBe('match_loss');
    expect(state.transactions[0].amount).toBe(0);
    expect(state.transactions[0].metadata?.lockedAmount).toBe(30);
  });
});

describe('walletStore - Entry Fee Deduction', () => {
  beforeEach(() => {
    useWalletStore.setState({
      cashBalance: 100,
      bonusBalance: 50,
      lockedBalance: 0,
      pendingWinnings: 0,
      transactions: [],
      lockedEntries: {},
    });
  });

  it('should deduct from cash when sufficient', () => {
    const result = useWalletStore.getState().deductEntryFee(30, 'match1');

    expect(result).toBe(true);
    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(70);
    expect(state.bonusBalance).toBe(50);
    expect(state.lockedBalance).toBe(30);
  });

  it('should deduct from bonus when cash insufficient', () => {
    useWalletStore.setState({ cashBalance: 10, bonusBalance: 50 });
    const result = useWalletStore.getState().deductEntryFee(30, 'match1');

    expect(result).toBe(true);
    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(0);
    expect(state.bonusBalance).toBe(30);
    expect(state.lockedBalance).toBe(30);
  });

  it('should split deduction between cash and bonus', () => {
    const result = useWalletStore.getState().deductEntryFee(30, 'match1');

    expect(result).toBe(true);
    const state = useWalletStore.getState();
    expect(state.lockedEntries['match1'].cashAmount).toBe(30);
    expect(state.lockedEntries['match1'].bonusAmount).toBe(0);
  });

  it('should fail when insufficient total funds', () => {
    useWalletStore.setState({ cashBalance: 10, bonusBalance: 5 });
    const result = useWalletStore.getState().deductEntryFee(30, 'match1');

    expect(result).toBe(false);
  });
});

describe('walletStore - Bonus Addition', () => {
  beforeEach(() => {
    useWalletStore.setState({
      cashBalance: 100,
      bonusBalance: 50,
      lockedBalance: 0,
      pendingWinnings: 0,
      transactions: [],
      lockedEntries: {},
    });
  });

  it('should add bonus successfully', () => {
    useWalletStore.getState().addBonus(25, 'Welcome bonus');

    const state = useWalletStore.getState();
    expect(state.bonusBalance).toBe(75);
    expect(state.cashBalance).toBe(100);
  });

  it('should create bonus transaction', () => {
    useWalletStore.getState().addBonus(25, 'Welcome bonus');

    const state = useWalletStore.getState();
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].type).toBe('bonus');
    expect(state.transactions[0].amount).toBe(25);
  });
});

describe('walletStore - Balance Calculations', () => {
  beforeEach(() => {
    useWalletStore.setState({
      cashBalance: 100,
      bonusBalance: 50,
      lockedBalance: 25,
      pendingWinnings: 10,
      transactions: [],
      lockedEntries: {},
    });
  });

  it('should calculate total balance', () => {
    const total = useWalletStore.getState().getTotalBalance();
    expect(total).toBe(185);
  });

  it('should calculate available cash', () => {
    const cash = useWalletStore.getState().getAvailableCash();
    expect(cash).toBe(100);
  });

  it('should calculate available to spend (cash + bonus)', () => {
    const available = useWalletStore.getState().getAvailableToSpend();
    expect(available).toBe(150);
  });
});

describe('walletStore - Transaction Management', () => {
  beforeEach(() => {
    useWalletStore.setState({
      cashBalance: 100,
      bonusBalance: 50,
      lockedBalance: 0,
      pendingWinnings: 0,
      transactions: [],
      lockedEntries: {},
    });
  });

  it('should add transaction', () => {
    useWalletStore.getState().addTransaction({
      type: 'deposit' as const,
      amount: 100,
      description: 'Test deposit',
      status: 'completed' as const,
    });

    const state = useWalletStore.getState();
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].id).toBeDefined();
    expect(state.transactions[0].timestamp).toBeDefined();
  });
});
