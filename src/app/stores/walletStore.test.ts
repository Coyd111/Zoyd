/**
 * walletStore.test.ts
 *
 * Tests for the wallet Zustand store after the "backend-as-source-of-truth"
 * refactor. All business-logic mutations (releaseWinnings, settleMatchLoss,
 * deductEntryFee, addBonus) are now handled exclusively by persistence.mjs.
 * The store only exposes:
 *   - hydrateFromServer  : full state replacement from a server snapshot
 *   - lockFunds          : optimistic-UI helper to lock entry fees locally
 *   - unlockFunds        : optimistic-UI helper to revert a lock on cancellation
 *   - addTransaction     : append a transaction record
 *   - deposit / withdraw : async calls that go through the API
 *   - getTotalBalance / getAvailableCash / getAvailableToSpend : selectors
 *
 * TODO: Once the WebSocket layer emits wallet_update events, replace the
 * lockFunds / unlockFunds tests with socket-driven integration tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useWalletStore } from './walletStore';

// ---------------------------------------------------------------------------
// Shared reset state
// ---------------------------------------------------------------------------
const EMPTY_WALLET = {
  cashBalance: 0,
  bonusBalance: 0,
  lockedBalance: 0,
  pendingWinnings: 0,
  transactions: [],
  lockedEntries: {},
};

const FUNDED_WALLET = {
  cashBalance: 100,
  bonusBalance: 50,
  lockedBalance: 0,
  pendingWinnings: 0,
  transactions: [],
  lockedEntries: {},
};

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------
describe('walletStore - Hydration', () => {
  beforeEach(() => {
    useWalletStore.setState(EMPTY_WALLET);
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

  it('should handle null / undefined values in snapshot gracefully', () => {
    const snapshot = {
      cashBalance: null as any,
      bonusBalance: undefined as any,
      lockedBalance: 0,
      pendingWinnings: 0,
      transactions: null as any,
      lockedEntries: undefined as any,
    };

    useWalletStore.getState().hydrateFromServer(snapshot);

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(0);
    expect(state.bonusBalance).toBe(0);
    expect(state.transactions).toEqual([]);
    expect(state.lockedEntries).toEqual({});
  });

  it('should replace existing state completely on hydration', () => {
    useWalletStore.setState({ cashBalance: 999 });
    useWalletStore.getState().hydrateFromServer({ cashBalance: 42, bonusBalance: 0, lockedBalance: 0, pendingWinnings: 0, transactions: [], lockedEntries: {} });

    expect(useWalletStore.getState().cashBalance).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Optimistic-UI fund locking (lockFunds)
// ---------------------------------------------------------------------------
describe('walletStore - Optimistic Fund Locking', () => {
  beforeEach(() => {
    useWalletStore.setState({ ...FUNDED_WALLET });
  });

  it('should lock funds from cash when cash is sufficient', () => {
    const result = useWalletStore.getState().lockFunds(30, 'match1');

    expect(result).toBe(true);
    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(70);
    expect(state.bonusBalance).toBe(50);
    expect(state.lockedBalance).toBe(30);
    expect(state.lockedEntries['match1']).toBeDefined();
    expect(state.lockedEntries['match1'].amount).toBe(30);
  });

  it('should lock funds from bonus when cash is insufficient', () => {
    useWalletStore.setState({ cashBalance: 10, bonusBalance: 50, lockedBalance: 0, lockedEntries: {} });
    const result = useWalletStore.getState().lockFunds(30, 'match1');

    expect(result).toBe(true);
    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(0);
    expect(state.bonusBalance).toBe(30);
    expect(state.lockedBalance).toBe(30);
  });

  it('should return false and not mutate state when total funds are insufficient', () => {
    useWalletStore.setState({ cashBalance: 10, bonusBalance: 5, lockedBalance: 0, lockedEntries: {} });
    const result = useWalletStore.getState().lockFunds(30, 'match1');

    expect(result).toBe(false);
    expect(useWalletStore.getState().lockedBalance).toBe(0);
  });

  it('should create an entry_fee transaction when locking', () => {
    useWalletStore.getState().lockFunds(30, 'match1');

    const state = useWalletStore.getState();
    const entryFeeTx = state.transactions.find((tx) => tx.type === 'entry_fee');
    expect(entryFeeTx).toBeDefined();
    expect(entryFeeTx?.amount).toBe(-30);
  });
});

// ---------------------------------------------------------------------------
// Optimistic-UI fund unlocking (unlockFunds)
// ---------------------------------------------------------------------------
describe('walletStore - Optimistic Fund Unlocking', () => {
  beforeEach(() => {
    useWalletStore.setState({
      cashBalance: 70,
      bonusBalance: 45,
      lockedBalance: 30,
      pendingWinnings: 0,
      transactions: [],
      lockedEntries: {
        match1: { amount: 30, cashAmount: 25, bonusAmount: 5, lockedAt: '2024-01-01' },
      },
    });
  });

  it('should restore cash and bonus on unlock', () => {
    useWalletStore.getState().unlockFunds(30, 'match1');

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(95);   // 70 + 25
    expect(state.bonusBalance).toBe(50);  // 45 + 5
    expect(state.lockedBalance).toBe(0);
    expect(state.lockedEntries['match1']).toBeUndefined();
  });

  it('should do nothing when entry key has no reservation', () => {
    useWalletStore.getState().unlockFunds(30, 'unknown');

    const state = useWalletStore.getState();
    expect(state.cashBalance).toBe(70);
    expect(state.lockedBalance).toBe(30);
  });

  it('should create a refund transaction on unlock', () => {
    useWalletStore.getState().unlockFunds(30, 'match1');

    const state = useWalletStore.getState();
    const refundTx = state.transactions.find((tx) => tx.type === 'refund');
    expect(refundTx).toBeDefined();
    expect(refundTx?.amount).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Balance selectors
// ---------------------------------------------------------------------------
describe('walletStore - Balance Selectors', () => {
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

  it('getTotalBalance should sum all balance components', () => {
    expect(useWalletStore.getState().getTotalBalance()).toBe(185);
  });

  it('getAvailableCash should return only cash balance', () => {
    expect(useWalletStore.getState().getAvailableCash()).toBe(100);
  });

  it('getAvailableToSpend should return cash + bonus (excludes locked)', () => {
    expect(useWalletStore.getState().getAvailableToSpend()).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// Transaction management
// ---------------------------------------------------------------------------
describe('walletStore - Transaction Management', () => {
  beforeEach(() => {
    useWalletStore.setState({ ...EMPTY_WALLET });
  });

  it('should append a transaction with generated id and timestamp', () => {
    useWalletStore.getState().addTransaction({
      type: 'deposit',
      amount: 100,
      description: 'Test deposit',
      status: 'completed',
    });

    const state = useWalletStore.getState();
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].id).toBeDefined();
    expect(state.transactions[0].timestamp).toBeDefined();
    expect(state.transactions[0].type).toBe('deposit');
  });

  it('should prepend newer transactions (most recent first)', () => {
    useWalletStore.getState().addTransaction({ type: 'deposit', amount: 10, description: 'A', status: 'completed' });
    useWalletStore.getState().addTransaction({ type: 'bonus', amount: 5, description: 'B', status: 'completed' });

    const state = useWalletStore.getState();
    expect(state.transactions[0].type).toBe('bonus');
    expect(state.transactions[1].type).toBe('deposit');
  });
});
