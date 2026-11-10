import { describe, it, expect, vi } from 'vitest';

vi.mock('./logger.mjs', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { setGauge, metricsToPrometheus, clearStaleFinanceTypeGauges } from './metrics.mjs';

describe('metrics — purge des séries finance byType', () => {
  it('éjecte les types résolus (ne restent pas figés)', () => {
    setGauge('zoyd_finance_debts_by_type', 1, { type: 'tournament_payout_pending' });
    setGauge('zoyd_finance_debts_by_type', 2, { type: 'league_refund_pending' });
    expect(metricsToPrometheus()).toContain('tournament_payout_pending');
    expect(metricsToPrometheus()).toContain('league_refund_pending');

    // Le résumé suivant ne contient que league_refund_pending.
    clearStaleFinanceTypeGauges({ league_refund_pending: 2 });
    const body = metricsToPrometheus();
    expect(body).toContain('league_refund_pending');
    expect(body).not.toContain('tournament_payout_pending');

    // Type entièrement résolu : plus aucune série byType.
    clearStaleFinanceTypeGauges({});
    expect(metricsToPrometheus()).not.toContain('league_refund_pending');
  });
});
