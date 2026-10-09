import { describe, it, expect } from 'vitest';
import {
  isAnySupportedPhone,
  parsePhoneForFedaPay,
  phoneFormatError,
  PAYOUT_COUNTRY_CONFIG,
  normalizePayoutCountry,
} from './payout-countries.mjs';

describe('format de telephone : le plan beninois a 10 chiffres', () => {
  // Régression la plus grave de ce lot. L'ARCEP Bénin a fait passer le plan
  // national de 8 à 10 chiffres le 30 novembre 2024 : le préfixe `01` a été
  // ajouté devant TOUS les numéros existants. L'UIT précise que le `0`
  // initial est obligatoire depuis l'étranger (`+229 0ZXXXXXXXX`).
  // Notre configuration portait encore 8 chiffres : le numéro du joueur était
  // valide et se faisait refusait au retrait.
  it('accepte le numero reel du joueur (10 chiffres)', () => {
    expect(isAnySupportedPhone('+2290165240654')).toBe(true);
    expect(parsePhoneForFedaPay('+2290165240654', 'bj').number).toBe('0165240654');
    expect(parsePhoneForFedaPay('+229 01 65 24 06 54', 'bj').number).toBe('0165240654');
    expect(parsePhoneForFedaPay('0165240654', 'bj').number).toBe('0165240654');
  });

  it('accepte encore le format 8 chiffres anterieur a la migration', () => {
    // Des enregistrements plus anciens subsistent, dont le numéro admin par
    // defaut d'origine. Les bloquer rendrait ces comptes inutilisables.
    expect(isAnySupportedPhone('+22960000000')).toBe(true);
    expect(parsePhoneForFedaPay('+22960000000', 'bj').number).toBe('60000000');
  });

  it('refuse les longueurs qui ne sont ni 10 ni 8', () => {
    expect(isAnySupportedPhone('+2290165240')).toBe(false);   // 7 chiffres
    expect(isAnySupportedPhone('+229016524065')).toBe(false);  // 9 chiffres
    expect(isAnySupportedPhone('+22901652406543')).toBe(false); // 11 chiffres
  });

  it('le préfixe 01 est bien conservé dans le numéro transmis', () => {
    // Le 0 fait partie du numéro : le retirer produirait un identifiant faux
    // auprès de FedaPay.
    expect(parsePhoneForFedaPay('+2290165240654', 'bj').number.startsWith('01')).toBe(true);
    expect(parsePhoneForFedaPay('+2290165240654', 'bj').number).toHaveLength(10);
  });

  it('le message d\'erreur annonce 10 chiffres', () => {
    expect(phoneFormatError('bj')).toContain('229');
    expect(phoneFormatError('bj')).toContain('10');
  });
});

describe('format de telephone : aucun pays de retrait n\'est rejete', () => {
  // Une règle trop stricte qui bloque un pays entier serait pire que le
  // défaut : le joueur ne pourrait plus jamais retirer.
  const attendus = {
    bj: ['+2290165240654', '0165240654', '+2290161000001'],
    ci: ['+2250700000000', '0700000000'],
    sn: ['+221770000000', '770000000'],
    tg: ['+22890000000', '90000000'],
  };

  for (const [iso, numeros] of Object.entries(attendus)) {
    for (const numero of numeros) {
      it(`${iso} accepte ${numero}`, () => {
        expect(parsePhoneForFedaPay(numero, iso).number).not.toBe('');
        expect(isAnySupportedPhone(numero)).toBe(true);
      });
    }
  }

  it('couvre les quatre pays configures', () => {
    expect(Object.keys(PAYOUT_COUNTRY_CONFIG).sort()).toEqual(['bj', 'ci', 'sn', 'tg']);
    // Longueurs attendues, croisées avec les plans de numérotation en vigueur.
    // Seul le Bénin a migré (ARCEP, 30/11/2024).
    expect(PAYOUT_COUNTRY_CONFIG.bj.localLength).toBe(10);
    expect(PAYOUT_COUNTRY_CONFIG.ci.localLength).toBe(10);
    expect(PAYOUT_COUNTRY_CONFIG.sn.localLength).toBe(9);
    expect(PAYOUT_COUNTRY_CONFIG.tg.localLength).toBe(8);
  });

  it('un numéro invalide pour UN pays peut être valide pour un autre', () => {
    // 9 chiffres : invalide partout. La distinction doit se faire sur le
    // nombre de chiffres, pas sur un libellé.
    expect(parsePhoneForFedaPay('+229016524065', 'bj').number).toBe('');
    expect(isAnySupportedPhone('+2250123456789')).toBe(true);
  });
});

describe('entrees invalides', () => {
  it('refuse vide, undefined et non-chaine', () => {
    for (const value of ['', '   ', null, undefined, 42, {}]) {
      expect(isAnySupportedPhone(value), String(value)).toBe(false);
    }
  });

  it('refuse un pays inconnu', () => {
    expect(parsePhoneForFedaPay('+22901652406', 'zz').number).toBe('');
  });
});

describe('messages utiles au joueur', () => {
  it('donne le nombre de chiffres attendu', () => {
    // Sans ce detail, le joueur reformate au hasard — c'est exactement ce
    // qui a produit une longueur fausse.
    expect(phoneFormatError('bj')).toContain('229');
    expect(phoneFormatError('bj')).toContain('10');
    expect(phoneFormatError('ci')).toContain('10');
    expect(phoneFormatError('sn')).toContain('9');
    expect(phoneFormatError('tg')).toContain('8');
  });

  it('reste generique pour un pays inconnu', () => {
    expect(phoneFormatError('zz')).toBe('Numéro de téléphone invalide.');
  });
});

describe('normalisation de pays', () => {
  it('accepte nom FR et iso', () => {
    expect(normalizePayoutCountry('Benin')).toBe('bj');
    expect(normalizePayoutCountry('bj')).toBe('bj');
    expect(normalizePayoutCountry("Côte d'Ivoire")).toBe('ci');
    expect(normalizePayoutCountry('Sénégal')).toBe('sn');
    expect(normalizePayoutCountry('Togo')).toBe('tg');
  });

  it('refuse un pays non supporte', () => {
    expect(normalizePayoutCountry('France')).toBeNull();
    expect(normalizePayoutCountry(undefined)).toBeNull();
  });
});