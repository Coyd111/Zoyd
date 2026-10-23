import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le remboursement d'un retrait refuse doit etre IDEMPOTENT.
 *
 * L'ordre historique de la reconciliation (A1 corrige mis a part) etait :
 * remboursement, puis tag, puis oubli de cle. Le `catch` unique englobait les
 * deux : si le TAG echouait apres un remboursement reussi, l'entree RESTAIT dans
 * la file et la transaction restait `pending_review` — le cycle suivant
 * remboursait ENCORE, avec un `depositToWallet` nu, sans aucune trace : perte
 * seche pour la plateforme, sur un montant de retrait entier.
 *
 * Aujourd'hui le remboursement passe par `refundRejectedWithdrawal` :
 * le credit et la trace `refund:...` (inscrite dans le portefeuille, donc
 * persistee) sont ECRITS DANS LA MEME OPERATION. Un rejeu du meme cycle ne
 * creditera jamais deux fois — quel que soit l'etat du tag.
 *
 * Ces tests verrouillent trois proprietes :
 *   1. un remboursement credite UNE fois ;
 *   2. une ecriture en echec ne laisse PAS de trace orpheline (le cycle suivant
 *      a le droit de crediter — sinon l'argent restait retenu a jamais) ;
 *   3. un tag en echec APRES un remboursement reussi ne declenche pas un second
 *      credit au cycle suivant.
 */

const hook = vi.hoisted(() => ({ echecEcriture: false }));

const tables = new Map();
const lignes = (nom) => {
  if (!tables.has(nom)) tables.set(nom, []);
  return tables.get(nom);
};

const colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: (name) => {
      const f = {};
      const api = {
        select: () => api,
        upsert: (payload) => {
          if (hook.echecEcriture && name === 'app_users') {
            return Promise.resolve({ error: { message: 'ecriture cassee (test)' } });
          }
          if (name === 'app_users' && Object.keys(payload).some((k) => !colonnesUsers.includes(k))) {
            return Promise.resolve({ error: { message: 'column does not exist' } });
          }
          const liste = lignes(name);
          const cle = payload.id !== undefined ? 'id' : 'token';
          const i = liste.findIndex((r) => r[cle] === payload[cle]);
          if (i >= 0) liste[i] = { ...liste[i], ...payload };
          else liste.push({ ...payload });
          return Promise.resolve({ error: null });
        },
        update: (patch) => { api._patch = patch; return api; },
        delete: () => { api._suppression = true; return api; },
        insert: (payload) => Promise.resolve({ error: null }),
        eq: (c, v) => { f[c] = v; return api; },
        order: () => api,
        limit: () => api,
        range: () => api,
        then: (resoudre) => {
          const cibles = lignes(name).filter((r) => Object.entries(f).every(([c, v]) => r[c] === v));
          if (api._suppression) {
            for (const c of cibles) lignes(name).splice(lignes(name).indexOf(c), 1);
            return Promise.resolve({ error: null, data: cibles }).then(resoudre);
          }
          if (api._patch) {
            if (hook.echecEcriture && name === 'app_users') {
              return Promise.resolve({ error: { message: 'ecriture cassee (test)' } }).then(resoudre);
            }
            if (name === 'app_users' && Object.keys(api._patch).some((k) => !colonnesUsers.includes(k))) {
              return Promise.resolve({ error: { message: 'column does not exist' } }).then(resoudre);
            }
            // Condition CAS : si le filtre porte sur `revision` et qu'aucune
            // ligne ne correspond, le conflit est signale par une liste vide.
            for (const c of cibles) Object.assign(c, api._patch);
            return Promise.resolve({ error: null, data: cibles.map((c) => ({ id: c.id })) }).then(resoudre);
          }
          return Promise.resolve({ data: cibles, error: null }).then(resoudre);
        },
      };
      return api;
    },
  },
}));

import {
  createUserAccount,
  updateWalletSnapshot,
  getWalletSnapshot,
  tagWalletTransaction,
  setOccSupportePourTest,
} from './persistence.mjs';
import { depositToWallet, refundRejectedWithdrawal, reconcilePendingWithdrawals } from './wallet-engine.mjs';
import { getNow } from './utils.mjs';

const MOT_DE_PASSE = 'MotDePasseSolide2026!';
const settle = () => new Promise((r) => setTimeout(r, 30));

let compteur = 0;
const nouveauJoueur = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const joueur = await createUserAccount({
    pseudo: `Remb${compteur}${stamp}`.slice(0, 24),
    email: `remb-${compteur}-${stamp}@test.local`,
    phone: `+2250800${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-REMB-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  await depositToWallet(joueur.id, 5000, 'test');
  await settle();
  return joueur;
};

const solde = (userId) => getWalletSnapshot(userId).cashBalance;
const refundTxs = (userId) => (getWalletSnapshot(userId).transactions || []).filter((t) => t?.type === 'refund');

/** Insere a la main l'etat d'un retrait « peut-etre parti » : la route a
 *  debite et FedaPay n'a pas tranche. C'est l'etat que la reconciliation lit. */
const semerRetraitEnAttente = async (userId, { cle, payoutId, txId = 'TX-1' }) => {
  await updateWalletSnapshot(userId, (wallet) => ({
    ...wallet,
    transactions: [
      {
        id: txId,
        type: 'withdraw',
        amount: -200,
        status: 'pending_review',
        timestamp: getNow(),
        metadata: { idempotencyKey: cle, payoutId, payoutStatus: 'pending_review' },
      },
      ...(Array.isArray(wallet.transactions) ? wallet.transactions : []),
    ].slice(0, 200),
    payoutsEnAttente: [
      ...(Array.isArray(wallet.payoutsEnAttente) ? wallet.payoutsEnAttente : []),
      { payoutId, txId, idempotencyKey: cle, since: getNow() },
    ],
  }));
  await settle();
};

/** Le wrapper EXACT du cron : meme derivation de cle, meme contexte. */
const refundDuCron = (userId, montant, extra) => refundRejectedWithdrawal(
  userId, montant,
  extra?.idempotencyKey
    ? `refund:${extra.idempotencyKey}`
    : (extra?.payoutId != null ? `refund:payout:${extra.payoutId}` : null),
  { metadata: { payoutId: extra?.payoutId ?? null } },
);

const PAIEMENT_REUSSITE = (s) => ['success', 'successful', 'completed'].includes(String(s).toLowerCase());
const PAIEMENT_ECHEC = (s) => ['failed', 'rejected', 'cancelled'].includes(String(s).toLowerCase());

beforeEach(() => {
  hook.echecEcriture = false;
  setOccSupportePourTest(true);
});

describe('refundRejectedWithdrawal — idempotence du remboursement', () => {
  it('un remboursement credite UNE fois : le second appel ne fait rien', async () => {
    const joueur = await nouveauJoueur();
    const avant = solde(joueur.id);

    const wallet1 = await refundRejectedWithdrawal(joueur.id, 200, 'refund:cle-1', {});
    expect(wallet1.cashBalance).toBe(avant + 200);
    const trace = refundTxs(joueur.id);
    expect(trace, 'la trace accompagne le credit dans la meme ecriture').toHaveLength(1);
    expect(trace[0].metadata.winningsKey).toBe('refund:cle-1');

    // Le rejeu : le cycle de reconciliation peut repasser par ici. Le solde
    // ne doit pas bouger une seconde fois.
    const wallet2 = await refundRejectedWithdrawal(joueur.id, 200, 'refund:cle-1', {});
    expect(wallet2.cashBalance, 'pas de double credit').toBe(avant + 200);
    expect(refundTxs(joueur.id)).toHaveLength(1);
  });

  it('les cles de remboursement ne se confondent pas avec les gains', async () => {
    // Un remboursement pour K ne doit pas laisser croire qu'un gain `prize_win:K`
    // a ete verse, et reciproquement : deux espaces distincts.
    const joueur = await nouveauJoueur();
    const avant = solde(joueur.id);
    await refundRejectedWithdrawal(joueur.id, 100, 'refund:cle-2', {});
    expect(solde(joueur.id)).toBe(avant + 100);
  });

  it('refuse un montant invalide et refuse sans cle', async () => {
    const joueur = await nouveauJoueur();
    await expect(refundRejectedWithdrawal(joueur.id, 0, 'refund:cle-3', {})).rejects.toThrow('Le montant du remboursement est invalide.');
    await expect(refundRejectedWithdrawal(joueur.id, 200, null, {})).rejects.toThrow('Remboursement sans cle d idempotence');
  });

  it('une ecriture en echec ne laisse PAS de trace orpheline', async () => {
    const joueur = await nouveauJoueur();
    const avant = solde(joueur.id);

    // Le credit se calcule, la trace s'inscrit en memoire… puis l'ecriture
    // en base echoue. Si le catch NE la retirait pas, le cycle suivant serait
    // aveugle : il croirait la dette traitee et l'argent resterait retenu
    // a jamais.
    hook.echecEcriture = true;
    await expect(refundRejectedWithdrawal(joueur.id, 200, 'refund:cle-4', {}))
      .rejects.toThrow('Sauvegarde du profil impossible');
    hook.echecEcriture = false;

    expect(solde(joueur.id), 'le solde n a pas change : l ecriture a echoue').toBe(avant);

    // Sans le untrack, ce second appel serait un no-op et le credit n'aurait
    // jamais lieu.
    await refundRejectedWithdrawal(joueur.id, 200, 'refund:cle-4', {});
    expect(solde(joueur.id), 'le remboursement finit par partir').toBe(avant + 200);
  });

  it('la file de reconciliation survit a toute ecriture du portefeuille', async () => {
    const joueur = await nouveauJoueur();
    await semerRetraitEnAttente(joueur.id, { cle: 'cle-file-1', payoutId: 49 });
    expect(getWalletSnapshot(joueur.id).payoutsEnAttente).toHaveLength(1);

    // Une ecriture sans rapport avec le retrait — ici un depot — ne doit pas
    // detruire la file qui attend la decision de FedaPay. Le normalisateur
    // reconstruait le portefeuille SANS elle : la dette disparaissait des la
    // premiere variation de solde.
    await depositToWallet(joueur.id, 100, 'test');
    expect(getWalletSnapshot(joueur.id).payoutsEnAttente, 'la file survit au depot').toHaveLength(1);
    expect(getWalletSnapshot(joueur.id).payoutsEnAttente[0]).toMatchObject({ payoutId: 49, idempotencyKey: 'cle-file-1' });
  });
});

describe('reconciliation — le tag rate apres un remboursement reussi', () => {
  it('le cycle suivant rejoue le remboursement SANS second credit', async () => {
    const joueur = await nouveauJoueur();
    await semerRetraitEnAttente(joueur.id, { cle: 'cle-loop-1', payoutId: 47 });
    const avant = solde(joueur.id);

    const retrieve = async (payoutId) => ({ payoutId, status: 'failed' });
    const oubliees = [];
    const appels = [];
    let tagPasse = false;
    const tagImpl = async (userId, txId, patch) => {
      appels.push('tag');
      if (!tagPasse) throw new Error('ecriture du tag cassee');
      await tagWalletTransaction(userId, txId, patch);
      return true;
    };
    const refundTrace = async (userId, montant, extra) => {
      appels.push('refund');
      return refundDuCron(userId, montant, extra);
    };

    // ─── Cycle 1 ────────────────────────────────────────────────────────────
    // Remboursement reussi, tag en echec : l'entree reste dans la file.
    const r1 = await reconcilePendingWithdrawals(
      PAIEMENT_REUSSITE, PAIEMENT_ECHEC, retrieve,
      () => [joueur.id],
      (userId) => getWalletSnapshot(userId),
      tagImpl,
      refundTrace,
      (userId, key) => oubliees.push(key),
      vi.fn(),
    );
    expect(r1, 'rien n est resolu tant que le tag echoue').toMatchObject({ resolved: 0, refunded: 0, stillPending: 1 });
    expect(solde(joueur.id), 'MAIS le credit tiene : rembourse une fois').toBe(avant + 200);
    tagPasse = true;

    // ─── Cycle 2 ────────────────────────────────────────────────────────────
    const r2 = await reconcilePendingWithdrawals(
      PAIEMENT_REUSSITE, PAIEMENT_ECHEC, retrieve,
      () => [joueur.id],
      (userId) => getWalletSnapshot(userId),
      tagImpl,
      refundTrace,
      (userId, key) => oubliees.push(key),
      vi.fn(),
    );
    expect(r2).toMatchObject({ resolved: 0, refunded: 1, stillPending: 0 });
    expect(solde(joueur.id), 'un SEUL credit, pas deux').toBe(avant + 200);
    expect(refundTxs(joueur.id), 'une seule trace de remboursement').toHaveLength(1);
    expect(getWalletSnapshot(joueur.id).payoutsEnAttente, 'la dette sort de la file').toHaveLength(0);
    expect(oubliees).toContain('cle-loop-1');
  });

  it('rembourse AVANT de taguer : le tag ne ferme jamais une dette non rendue', async () => {
    // L'ordre a une raison d'etre : si le tag passait en premier et que le
    // remboursement echouait, l'entree sortirait de la file et la
    // transaction, deja `failed`, ne serait PLUS rescannee — silence.
    const joueur = await nouveauJoueur();
    await semerRetraitEnAttente(joueur.id, { cle: 'cle-loop-2', payoutId: 48 });
    const avant = solde(joueur.id);

    const retrieve = async (payoutId) => ({ payoutId, status: 'failed' });
    const sequence = [];
    const result = await reconcilePendingWithdrawals(
      PAIEMENT_REUSSITE, PAIEMENT_ECHEC, retrieve,
      () => [joueur.id],
      (userId) => getWalletSnapshot(userId),
      async (userId, txId, patch) => {
        // Mesure AVANT le tag : le credit doit DEJA avoir eu lieu.
        sequence.push(['tag', solde(joueur.id) - avant]);
        await tagWalletTransaction(userId, txId, patch);
        return true;
      },
      async (userId, montant, extra) => {
        // Mesure APRES le remboursement : il doit avoir credite.
        const wallet = await refundDuCron(userId, montant, extra);
        sequence.push(['refund', solde(joueur.id) - avant]);
        return wallet;
      },
      () => {},
      vi.fn(),
    );

    expect(result).toMatchObject({ refunded: 1, stillPending: 0 });
    expect(sequence.map((e) => e[0]), 'le remboursement passe en premier').toEqual(['refund', 'tag']);
    expect(sequence[0][1], 'le remboursement a bien credite').toBe(200);
    // Au moment du tag, le credit a DEJA eu lieu : le tag ferme une dette rendue.
    expect(sequence[1][1]).toBe(200);
  });
});
