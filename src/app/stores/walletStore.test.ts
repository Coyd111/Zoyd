/**
 * walletStore.test.ts
 *
 * Tests for the wallet Zustand store after the "backend-as-source-of-truth"
 * refactor. All business-logic mutations (releaseWinnings, settleMatchLoss,
 * deductEntryFee, addBonus) are now handled exclusively by persistence.mjs.
 * The store only exposes:
 *   - hydrateFromServer : full state replacement from a server snapshot
 *   - deposit / withdraw : async calls that go through the API
 *   - getTotalBalance / getAvailableCash / getAvailableToSpend : selectors
 *   - addTransaction : append a transaction record
 *
 * Le verrouillage des fonds est desormais integralement serveur : la copie
 * client `lockFunds`/`unlockFunds` a ete supprimee (voir docs/audit/02-argent.md).
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
          created_at: '2024-01-01',
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
