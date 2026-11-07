/**
 * server/finance-observability.mjs - Observabilite des dettes d'argent.
 *
 * P0 (audit audit-4/fix) : les dettes de reglement et les retraits
 * `pending_review` etaient comptes en totaux anonymes dans /api/health,
 * mais invisibles depuis le tableau de bord admin et absents des metriques
 * Prometheus. Un `pending` que le cron ne selectionne pas gelait un pot en
 * silence (V1, V6, V2).
 *
 * Ce module est une FEUILLE (aucun import moteur/persistence, sauf utils) :
 * il ne mute rien, il ne lit pas les comptes lui-même — l'appelant fournit
 * les collections memoire et les accesseurs wallet. Il produit :
 *   - collectFinanceDebts : liste ACTIONNABLE (admin, 2FA), avec ids,
 *     montants ZC, age en ms, derniere erreur ;
 *   - summarizeFinanceDebts : resume ANONYME pour la sante publique et les
 *     metriques (comptes + total ZC + age, jamais d'identifiant).
 *
 * INVARIANT : les montants somment les dettes Telles quelles (montants
 *   portes par les entites), jamais recalcules. On affiche ce que le
 *   systeme doit encore aux joueurs, on n'invente pas une base.
 * INVARIANT : `ageMs` null si aucune date fiable : pas de `0` mensonger.
 * INVARIANT : la fonction publique n'expose AUCUN userId/matchId.
 * PIEGE : l'historique wallet est plafonne a 200 entrees — les retraits
 *   `pending_review` sortis de la fenetre ne sont trouves que via
 *   `payoutsEnAttente`. Toute liste qui ne lit que l'historique est
 *   fausse par construction.
 * PIEGE : `pendingRefunds` des tournois/ligues n'a pas de montant garanti
 *   selon les ecritures — `Number(... || 0)` est assume, le total est une
 *   borne basse, jamais definitive.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import { roundAmount } from './utils.mjs';

export const FINANCE_STALE_MS = 6 * 60 * 60 * 1000;
export const FINANCE_CRITICAL_MS = 24 * 60 * 60 * 1000;

const asMs = (value) => {
  if (value == null) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
};

const ageOf = (dates, nowMs) => {
  for (const d of dates) {
    const ts = asMs(d);
    if (ts != null) return Math.max(0, nowMs - ts);
  }
  return null;
};

/**
 * Collecte les dettes d'argent actionnables.
 * @param {object} input
 * @param {Array} input.matches - collection `matches`
 * @param {Array} input.tournaments - collection `tournaments`
 * @param {Array} input.leagues - collection `leagues`
 * @param {Array} input.brLobbies - collection `brLobbies`
 * @param {() => string[]} input.listUserIds
 * @param {(userId: string) => object|undefined} input.getWallet
 * @param {number} [input.nowMs]
 * @returns {{summary: object, debts: Array}}
 */
export const collectFinanceDebts = (input = {}) => {
  const {
    matches = [],
    tournaments = [],
    leagues = [],
    brLobbies = [],
    listUserIds = () => [],
    getWallet = () => undefined,
    nowMs = Date.now(),
  } = input;

  const debts = [];

  for (const m of Array.isArray(matches) ? matches : []) {
    if (!m?.id) continue;
    // Match en attente de versement (`pending` = a solder, jamais `false`).
    if (m?.result?.payoutDistributed === 'pending') {
      const basis = Number(m.settlementBasis?.lockedPot);
      const lockedPot = Number.isFinite(basis) && basis > 0
        ? basis
        : Number(m.prizePool || 0);
      debts.push({
        type: 'match_pending',
        id: String(m.id),
        status: String(m.status || 'awaiting_confirmation'),
        amountZC: roundAmount(lockedPot),
        ageMs: ageOf([m.result?.submittedAt, m.updatedAt, m.createdAt], nowMs),
        since: m.result?.submittedAt || m.updatedAt || m.createdAt || null,
        detail: m.confirmationDeadline ? 'confirmation deadline ouverte' : 'reglement intercerve',
      });
    }
    const arbiterDue = roundAmount(m?.pendingArbiterFee || 0);
    if (arbiterDue > 0) {
      debts.push({
        type: 'arbiter_fee_pending',
        id: String(m.id),
        amountZC: arbiterDue,
        ageMs: ageOf([m.updatedAt, m.finishedAt, m.createdAt], nowMs),
        since: m.updatedAt || m.finishedAt || m.createdAt || null,
        arbiterId: m.arbiter?.userId ? String(m.arbiter.userId) : null,
      });
    }
    const disputes = Array.isArray(m?.disputes) ? m.disputes : [];
    const openDispute = disputes.find((d) => d?.status === 'open' || d?.status === 'under_review');
    if (openDispute) {
      const basis = Number(m.settlementBasis?.lockedPot);
      debts.push({
        type: 'dispute_frozen',
        id: String(m.id),
        status: openDispute.status,
        amountZC: roundAmount(Number.isFinite(basis) && basis > 0 ? basis : Number(m.prizePool || 0)),
        ageMs: ageOf([openDispute.openedAt, m.updatedAt, m.createdAt], nowMs),
        since: openDispute.openedAt || m.updatedAt || null,
      });
    }
  }

  const collectPending = (entity, entityId, entries, type, label) => {
    for (const e of Array.isArray(entries) ? entries : []) {
      debts.push({
        type,
        id: String(entityId),
        label,
        userId: e?.userId || e?.captainId ? String(e.userId || e.captainId) : null,
        amountZC: roundAmount(Number(e?.amount || e?.amountZC || e?.value || 0)),
        ageMs: ageOf([e?.at, e?.createdAt, entity?.updatedAt, entity?.createdAt], nowMs),
        since: e?.at || entity?.updatedAt || null,
        lastError: e?.lastError || e?.error || null,
      });
    }
  };

  for (const t of Array.isArray(tournaments) ? tournaments : []) {
    if (!t?.id) continue;
    collectPending(t, t.id, t.pendingPayouts, 'tournament_payout_pending', t.name || t.id);
    collectPending(t, t.id, t.pendingRefunds, 'tournament_refund_pending', t.name || t.id);
    collectPending(t, t.id, t.uncollectableRefunds, 'tournament_refund_uncollectable', t.name || t.id);
  }
  for (const s of Array.isArray(leagues) ? leagues : []) {
    if (!s?.id) continue;
    collectPending(s, s.id, s.pendingPayouts, 'league_payout_pending', s.name || s.id);
    collectPending(s, s.id, s.pendingRefunds, 'league_refund_pending', s.name || s.id);
    collectPending(s, s.id, s.uncollectableRefunds, 'league_refund_uncollectable', s.name || s.id);
  }

  for (const l of Array.isArray(brLobbies) ? brLobbies : []) {
    if (!l?.id) continue;
    if (l.status === 'settling') {
      debts.push({
        type: 'br_settling',
        id: String(l.id),
        status: 'settling',
        amountZC: roundAmount(Number(l.pot || l.prizePool || 0)),
        ageMs: ageOf([l.updatedAt, l.settlingAt, l.createdAt], nowMs),
        since: l.updatedAt || null,
      });
    }
  }

  // Retraits `pending_review` : file dediee d'abord, historique ensuite
  // (miroir de countPendingWithdrawals / reconcilePendingWithdrawals).
  const seenPayouts = new Map();
  try {
    for (const userId of listUserIds()) {
      const wallet = getWallet(userId);
      if (!wallet) continue;
      const txById = new Map((wallet.transactions || []).map((t) => [t?.id, t]));
      for (const entree of wallet.payoutsEnAttente || []) {
        const payoutId = entree?.payoutId;
        if (!payoutId || seenPayouts.has(`${userId}:${payoutId}`)) continue;
        seenPayouts.set(`${userId}:${payoutId}`, true);
        const tx = txById.get(entree.txId) || null;
        debts.push({
          type: 'withdrawal_pending_review',
          id: String(payoutId),
          txId: entree.txId ? String(entree.txId) : null,
          userId: String(userId),
          amountZC: roundAmount(Math.abs(Number(tx?.amount || entree.amount || 0))),
          ageMs: ageOf([entree.since, tx?.timestamp, entree.at], nowMs),
          since: entree.since || tx?.timestamp || null,
          detail: 'payout peut-etre parti : ne pas rembourser sans lecture FedaPay',
        });
      }
      for (const tx of wallet.transactions || []) {
        if (tx?.type !== 'withdraw') continue;
        if (tx?.metadata?.payoutStatus !== 'pending_review') continue;
        const payoutId = tx?.metadata?.payoutId;
        if (!payoutId || seenPayouts.has(`${userId}:${payoutId}`)) continue;
        seenPayouts.set(`${userId}:${payoutId}`, true);
        debts.push({
          type: 'withdrawal_pending_review',
          id: String(payoutId),
          txId: String(tx.id || ''),
          userId: String(userId),
          amountZC: roundAmount(Math.abs(Number(tx.amount || 0))),
          ageMs: ageOf([tx.timestamp], nowMs),
          since: tx.timestamp || null,
        });
      }
    }
  } catch {
    // Accesseur de lecture en panne : on conserve les dettes deja
    // collectees plutot que de jeter tout le resume.
  }

  debts.sort((a, b) => (b.ageMs ?? -1) - (a.ageMs ?? -1));

  return { summary: summarizeFinanceDebts(debts), debts };
};

/**
 * Resume ANONYME : comptes + total ZC + age, jamais d'identifiant.
 * @param {Array} debts
 * @returns {object}
 */
export const summarizeFinanceDebts = (debts) => {
  const list = Array.isArray(debts) ? debts : [];
  const byType = {};
  let totalZC = 0;
  let oldestAgeMs = null;
  let staleCount = 0;
  let criticalCount = 0;
  let uncollectableCount = 0;
  for (const d of list) {
    byType[d.type] = (byType[d.type] || 0) + 1;
    totalZC = roundAmount(totalZC + Number(d.amountZC || 0));
    if (d.ageMs != null) {
      if (oldestAgeMs == null || d.ageMs > oldestAgeMs) oldestAgeMs = d.ageMs;
      if (d.ageMs > FINANCE_STALE_MS) staleCount += 1;
      if (d.ageMs > FINANCE_CRITICAL_MS) criticalCount += 1;
    }
    if (String(d.type).endsWith('_uncollectable')) uncollectableCount += 1;
  }
  return {
    totalDebts: list.length,
    totalZC,
    oldestAgeMs,
    staleCount,
    criticalCount,
    uncollectableCount,
    byType,
  };
};
