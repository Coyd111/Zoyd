import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * E5 — Les preuves sont anti-XSS et bornées : ≤ 2000 caractères,
 * ≤ 10 références.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * `isSafeProofRef` / `normalizeProofRefs` (match-engine.mjs) filtrent les
 * preuves du résultat (scoreboard, écran final, capture salle, extra).
 * Sans test, une régression qui élargit le filtre (autoriser `data:text/html`,
 * les chevrons, ou les gestionnaires `on...=`) réintroduirait du XSS stocké
 * servi ensuite en public (page match, profil, export).
 *
 * Ce que les tests gardent
 * ------------------------
 * 1. Direct : javascript:, vbscript:, data non-image, chevrons, on*=.
 * 2. Direct : data:image/png|jpeg|jpg|webp;base64 passe (image).
 * 3. Direct : non-chaîne, vide, > 2000 = rejeté.
 * 4. normalize : trim + slice(0, 10), entrée unique string supportée.
 * 5. Intégration : submitMatchResultOnServer persiste les preuves nettoyées
 *    et lève PROOFS_REQUIRED quand tout est filtré — l'aval ne peut pas
 *    transformer une preuve bloquée en preuve valide.
 */

vi.mock('./persistence.mjs', () => ({
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
  getUserById: vi.fn((id) => ({
    id,
    pseudo: id,
    role: 'player',
    trustScore: 100,
    stats: { elo: 1200, wins: 0, losses: 0, draws: 0 },
    progression: {},
    wallet: { cashBalance: 1000, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
  })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

import { isSafeProofRef, normalizeProofRefs, MAX_PROOF_REF_LENGTH, submitMatchResultOnServer } from './match-engine.mjs';

beforeEach(() => vi.clearAllMocks());

describe('E5 - isSafeProofRef', () => {
  it('refuse les schemas dangereux', () => {
    expect(isSafeProofRef('javascript:alert(1)')).toBe(false);
    expect(isSafeProofRef('  JaVaScRiPt:alert(1)')).toBe(false);
    expect(isSafeProofRef('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeProofRef('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false);
  });

  it('refuse les chevrons et les gestionnaires d evenements', () => {
    expect(isSafeProofRef('<script>alert(1)</script>')).toBe(false);
    expect(isSafeProofRef('<img src=x onerror=alert(1)>')).toBe(false);
    expect(isSafeProofRef('photo.png" onload="alert(1)')).toBe(false);
  });

  it('accepte les images data:base64', () => {
    expect(isSafeProofRef('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeProofRef('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isSafeProofRef('data:image/jpg;base64,/9j/')).toBe(true);
    expect(isSafeProofRef('data:image/webp;base64,UklGRg==')).toBe(true);
  });

  it('accepte les liens simples et le texte libre', () => {
    expect(isSafeProofRef('https://example.com/scoreboard.png')).toBe(true);
    expect(isSafeProofRef('screenshot-score-10-5')).toBe(true);
    expect(isSafeProofRef('  https://example.com/a.png  ')).toBe(true);
  });

  it('refuse non-chaines et vide', () => {
    expect(isSafeProofRef(undefined)).toBe(false);
    expect(isSafeProofRef(null)).toBe(false);
    expect(isSafeProofRef(42)).toBe(false);
    expect(isSafeProofRef('')).toBe(false);
    expect(isSafeProofRef('   ')).toBe(false);
  });

  it('refuse au-dela de 2000 caracteres', () => {
    expect(MAX_PROOF_REF_LENGTH).toBe(2000);
    expect(isSafeProofRef('a'.repeat(2000))).toBe(true);
    expect(isSafeProofRef('a'.repeat(2001))).toBe(false);
  });
});

describe('E5 - normalizeProofRefs', () => {
  it('trim, filtre puis borne a 10', () => {
    const refs = Array.from({ length: 15 }, (_, i) => `  ref-${i}  `);
    refs.push('javascript:alert(1)');
    refs.push(null);
    const out = normalizeProofRefs(refs);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe('ref-0');
    expect(out).not.toContain('javascript:alert(1)');
  });

  it('supporte une entree unique string', () => {
    expect(normalizeProofRefs('solo-ref')).toEqual(['solo-ref']);
    expect(normalizeProofRefs(['solo-ref'])).toEqual(['solo-ref']);
    expect(normalizeProofRefs([])).toEqual([]);
  });
});

describe('E5 - integration submitMatchResultOnServer', () => {
  const matchBase = () => ({
    id: 'M-1',
    status: 'in_progress',
    arbiter: { userId: 'arb-1', pseudo: 'arb-1', assignedAt: new Date().toISOString(), hasSubmittedResult: false },
    players: [
      { userId: 'p-1', team: 0, isCheckedIn: true, isReady: true },
      { userId: 'p-2', team: 1, isCheckedIn: true, isReady: true },
    ],
    disputes: [],
    prizePool: 100,
    entryFee: 50,
    teamSize: 1,
    maxPlayers: 2,
  });

  it('persist les preuves nettoyees', async () => {
    const { match } = await submitMatchResultOnServer(
      [matchBase()],
      { id: 'arb-1' },
      'M-1',
      {
        winnerTeam: 0,
        scores: { team0: 5, team1: 2 },
        proofs: {
          scoreboard: ['clean-ref', 'javascript:alert(1)', '<b>x</b>'],
          finalResult: ['final-ref'],
        },
      },
      { deferSettlement: true },
    );
    expect(match.result.proofs.scoreboard).toEqual(['clean-ref']);
    expect(match.result.proofs.finalResult).toEqual(['final-ref']);
    expect(match.result.screenshots).toEqual(['clean-ref', 'final-ref']);
  });

  it('PROOFS_REQUIRED quand toutes les preuves sont filtrees', async () => {
    await expect(
      submitMatchResultOnServer(
        [matchBase()],
        { id: 'arb-1' },
        'M-1',
        {
          winnerTeam: 0,
          scores: { team0: 5, team1: 2 },
          proofs: {
            scoreboard: ['javascript:alert(1)'],
            finalResult: ['<script>alert(1)</script>'],
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'PROOFS_REQUIRED' });
  });

  it('PROOFS_REQUIRED quand scoreboard == ecran final (preuve unique)', async () => {
    await expect(
      submitMatchResultOnServer(
        [matchBase()],
        { id: 'arb-1' },
        'M-1',
        {
          winnerTeam: 0,
          scores: { team0: 5, team1: 2 },
          proofs: {
            scoreboard: ['unique-ref'],
            finalResult: ['unique-ref'],
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'PROOFS_REQUIRED' });
  });
});
