import { describe, it, expect, vi, beforeEach } from 'vitest';

// Le statut de la transaction et le type du remboursement sont ce que le
// joueur LIT. Avant, un retrait refusé par FedaPay restait `completed` avec une
// coche verte, et son remboursement apparaissait comme un dépôt : l'historique
// montrait des versements qui n'avaient jamais eu lieu.
vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      select: vi.fn(() => ({ range: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
      delete: vi.fn(() => {
        const chain = { eq: vi.fn(() => chain) };
        chain.then = (onOk) => Promise.resolve({ error: null }).then(onOk);
        return chain;
      }),
    })),
  },
}));

import * as p from './persistence.mjs';
import { depositToWallet, withdrawFromWallet } from './wallet-engine.mjs';

let counter = 0;

/**
 * Numéro béninois de test : TOUJOURS 10 chiffres après l'indicatif (format
 * ARCEP en vigueur). Une longueur fixe, sinon `counter` passant à deux chiffres
 * décalait tout et le numéro devenait invalide.
 */
const testPhone = () => `+229${String((Date.now() % 900000000) + counter * 7).padStart(10, '0')}`;

/** Compte cree, avec de quoi retirer : 1000 ZC de depart. */
const creditedUser = async (tag) => {
  counter += 1;
  const n = `${(Date.now() % 100000)}${counter}`.slice(-10);
  const created = await p.createUserAccount({
    pseudo: `${tag}${n}`,
    email: `${tag.toLowerCase()}-${n}@test.local`,
    phone: testPhone(),
    gameId: `CO-${tag}-${n}`,
    password: 'MotDePasse!Solide2026',
    acceptAdult: true,
    acceptTerms: true,
  });
  await depositToWallet(created.id, 1000, 'MTN MoMo');
  return created.id;
};

beforeEach(() => { counter = 0; });

describe('historique : un retrait echoue doit se lire comme tel', () => {
  it('marque le retrait en failed quand le payout est refuse', async () => {
    const userId = await creditedUser('Fail');
    const wallet = await withdrawFromWallet(userId, 200, 'Moov Money', '0165240654');
    const tx = wallet.transactions.find((t) => t.type === 'withdraw');
    expect(tx).toBeDefined();
    // Negatif : l'UI doit pouvoir afficher une sortie d'argent.
    expect(tx.amount).toBe(-200);

    // Ce que fait la route quand FedaPay refuse.
    await p.tagWalletTransaction(userId, tx.id, { payoutStatus: 'failed', status: 'failed' });

    const after = p.getUserById(userId).wallet.transactions.find((t) => t.id === tx.id);
    // Sans le `status`, l'historique affichait « completed » + coche verte :
    // un retrait que FedaPay avait refuse paraissait reussi.
    expect(after.status).toBe('failed');
    expect(after.metadata.payoutStatus).toBe('failed');
  });

  it('le remboursement est un refund, pas un depot', async () => {
    const userId = await creditedUser('Refu');
    await depositToWallet(userId, 200, 'Remboursement', {
      type: 'refund',
      description: 'Remboursement — retrait echoue (200 ZC rendus)',
      metadata: { reason: 'PAYOUT_FAILED' },
    });
    const tx = p.getUserById(userId).wallet.transactions[0];
    // Ecrit en `deposit`, il s'affichait « Depot ZC via Remboursement… » :
    // le joueur lisait un versement alors que c'etait son propre argent rendu.
    expect(tx.type).toBe('refund');
    expect(tx.amount).toBe(200);
    expect(tx.metadata.reason).toBe('PAYOUT_FAILED');
  });

  it('un depot normal reste un depot', async () => {
    const userId = await creditedUser('Norm');
    const tx = p.getUserById(userId).wallet.transactions[0];
    expect(tx.type).toBe('deposit');
    expect(tx.description).toContain('MTN MoMo');
  });

  it('un tag sans statut ne corrompt pas le statut existant', async () => {
    // Cas du payout CONFIRME : seul le metadonne est pose. Le statut doit
    // rester `completed`.
    const userId = await creditedUser('Keep');
    const wallet = await withdrawFromWallet(userId, 200, 'MTN MoMo', '0165240654');
    const tx = wallet.transactions.find((t) => t.type === 'withdraw');
    await p.tagWalletTransaction(userId, tx.id, { payoutId: 'P-1', payoutStatus: 'sent' });
    const after = p.getUserById(userId).wallet.transactions.find((t) => t.id === tx.id);
    expect(after.status).toBe('completed');
    expect(after.metadata.payoutId).toBe('P-1');
  });

  it('un retrait echoue puis rembourse laisse un solde intact et tracable', async () => {
    // Le scenario reel du joueur : FedaPay refuse, l'argent revient.
    const userId = await creditedUser('Scen');
    const avant = p.getWalletSnapshot(userId).cashBalance;

    const wallet = await withdrawFromWallet(userId, 200, 'Moov Money', '0165240654');
    const tx = wallet.transactions.find((t) => t.type === 'withdraw');
    expect(p.getWalletSnapshot(userId).cashBalance).toBe(avant - 200);

    await p.tagWalletTransaction(userId, tx.id, { payoutStatus: 'failed', status: 'failed' });
    await depositToWallet(userId, 200, 'Remboursement', { type: 'refund', description: 'Remboursement' });

    expect(p.getWalletSnapshot(userId).cashBalance).toBe(avant);
    const txs = p.getUserById(userId).wallet.transactions;
    // Le joueur voit un echec et un remboursement : il peut reconcilier.
    expect(txs.filter((t) => t.status === 'failed')).toHaveLength(1);
    expect(txs.filter((t) => t.type === 'refund')).toHaveLength(1);
  });
});

describe('transaction : le timestamp existe', () => {
  it('chaque transaction porte un timestamp lisible', async () => {
    const userId = await creditedUser('Stamp');
    const tx = p.getUserById(userId).wallet.transactions[0];
    // Le front lisait `created_at`, inexistant : tout retombait sur
    // `new Date()` et l'historique affichait « à l'instant » partout.
    expect(typeof tx.timestamp).toBe('string');
    expect(Number.isFinite(new Date(tx.timestamp).getTime())).toBe(true);
  });
});