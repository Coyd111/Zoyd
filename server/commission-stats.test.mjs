import { describe, it, expect } from 'vitest';
import { sumCommissionTransactions } from './commission-stats.mjs';

/**
 * La statistique « commissions » doit dire ce qui est SORTI, pas ce qui etait
 * PREVU.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Le dashboard admin additionnait `match.arbiterFee` pour la sortie de
 * tresorerie vers les arbitres. Ce champ est fige a la creation sur le pot
 * THEORIQUE (`maxPlayers x entryFee`), alors que le reglement preleve 2 % du
 * pot REELLEMENT VERROUILLE.
 *
 * Consequence : sur un match au roster incomplet, l admin voyait un montant
 * SUPERIEUR a celui reellement verse. Et `arbiterFee` n est jamais mis a jour
 * au reglement : l ecart ne se resorbait pas tout seul.
 *
 * La seule trace du montant reellement versee est la transaction du
 * portefeuille. Ce module lit donc les transactions — comme le fait deja la
 * commission de retrait, depuis la meme source de verite.
 *
 * Le module est PUR : pas de dependance, pas de base. C'est ce qui le rend
 * testable sans demarrer quoi que ce soit.
 */

const portefeuille = (transactions) => ({ wallet: { transactions } });

describe('Statistiques de commission — ce qui est sorti, pas ce qui etait prevu', () => {
  it('additionne les commissions d arbitre REELLEMENT versees', () => {
    const res = sumCommissionTransactions([
      portefeuille([
        { type: 'arbitration_fee', amount: 40, status: 'completed' },
        { type: 'arbitration_fee', amount: 12.5, status: 'completed' },
      ]),
    ]);

    expect(res.arbiterFees).toBe(52.5);
  });

  it('ne compte pas un versement en echec', () => {
    const res = sumCommissionTransactions([
      portefeuille([
        { type: 'arbitration_fee', amount: 40, status: 'completed' },
        { type: 'arbitration_fee', amount: 30, status: 'failed' },
      ]),
    ]);

    expect(res.arbiterFees).toBe(40);
  });

  it('ne confond pas les gains des joueurs avec les commissions d arbitre', () => {
    // Les primes des vainqueurs sortent aussi de la cagnotte, mais ce ne sont
    // PAS des commissions : les melanger gonflerait la sortie de tresorerie.
    const res = sumCommissionTransactions([
      portefeuille([
        { type: 'prize_win', amount: 980, status: 'completed' },
        { type: 'arbitration_fee', amount: 40, status: 'completed' },
      ]),
    ]);

    expect(res.arbiterFees).toBe(40);
  });

  it('compte la commission de retrait, et elle seule est le revenu', () => {
    const res = sumCommissionTransactions([
      portefeuille([
        { type: 'withdraw', amount: 1000, metadata: { feeAmount: 20 } },
        { type: 'arbitration_fee', amount: 40, status: 'completed' },
      ]),
    ]);

    expect(res.withdrawalFees).toBe(20);
    expect(res.withdrawalCount).toBe(1);
    // La commission d arbitre est HORS du revenu : ce sont deux flux differents.
    expect(res.arbiterFees).toBe(40);
  });

  it('ignore un retrait dont le payout a echoue', () => {
    // Le joueur a recu son brut, la commission n a jamais ete encaissee.
    const res = sumCommissionTransactions([
      portefeuille([
        { type: 'withdraw', amount: 1000, metadata: { feeAmount: 20, payoutStatus: 'failed' } },
      ]),
    ]);

    expect(res.withdrawalFees).toBe(0);
    expect(res.withdrawalCount).toBe(0);
  });

  it('ne compte pas un retrait sans commission', () => {
    const res = sumCommissionTransactions([
      portefeuille([{ type: 'withdraw', amount: 1000, metadata: {} }]),
    ]);

    expect(res.withdrawalCount).toBe(1);
    expect(res.withdrawalFees).toBe(0);
  });

  it('tient compte de plusieurs joueurs', () => {
    const res = sumCommissionTransactions([
      portefeuille([{ type: 'arbitration_fee', amount: 10, status: 'completed' }]),
      portefeuille([{ type: 'arbitration_fee', amount: 15, status: 'completed' }]),
      { wallet: {} },
      { },
    ]);

    expect(res.arbiterFees).toBe(25);
  });
});
