/**
 * server/commission-stats.mjs - Agregation des flux de commission.
 *
 * Pourquoi ce module existe
 * -------------------------
 * La statistique « commissions » du dashboard admin additionnait
 * `match.arbiterFee` : un champ FIGE a la creation sur le pot THEORIQUE
 * (`maxPlayers x entryFee`). Or le reglement preleve 2 % du pot REELLEMENT
 * VERROUILLE.
 *
 * Sur un match au roster incomplet, le champ annoncait donc un montant
 * SUPERIEUR a celui reellement verse. Et comme `arbiterFee` n est jamais mis a
 * jour au reglement, l ecart ne se resorbait pas tout seul.
 *
 * La seule trace du montant reellement versee est la TRANSACTION du
 * portefeuille. Ce module lit donc les transactions — comme le fait deja la
 * commission de retrait, depuis la meme source de verite.
 *
 * Module PUR, sans dependance : la logique est testable seule, sans
 * charger la persistance ni la base.
 */

/**
 * Somme des flux de commission a partir des portefeuilles en memoire.
 *
 * @param {Iterable<{wallet?: {transactions?: object[]}}>} users
 * @returns {{withdrawalFees: number, withdrawalCount: number, arbiterFees: number}}
 */
export const sumCommissionTransactions = (users) => {
  let withdrawalFees = 0;
  let withdrawalCount = 0;
  let arbiterFees = 0;

  for (const user of users || []) {
    const txs = user?.wallet?.transactions;
    if (!Array.isArray(txs)) continue;
    for (const tx of txs) {
      // Commission de retrait (2 %) : le SEUL revenu de ZOYD.
      //
      // Payout echoue + rembourse : le joueur a recu son brut, la commission
      // n a jamais ete encaissee.
      if (tx?.type === 'withdraw') {
        if (tx.metadata?.payoutStatus === 'failed') continue;
        withdrawalFees += Number(tx.metadata?.feeAmount || 0);
        withdrawalCount++;
        continue;
      }
      // Commission d arbitre : sortie de tresorerie, hors revenu.
      //
      // On lit la transaction, pas le champ du match : la transaction porte le
      // montant REELLEMENT verse, et elle n existe que si le versement a
      // abouti. Un versement en echec n a pas de transaction — et la reprise
      // (V2) en creera une, une seule fois (idempotence).
      if (tx?.type === 'arbitration_fee' && tx.status !== 'failed') {
        arbiterFees += Number(tx.amount || 0);
      }
    }
  }

  return {
    withdrawalFees: Math.round(withdrawalFees * 100) / 100,
    withdrawalCount,
    arbiterFees: Math.round(arbiterFees * 100) / 100,
  };
};
