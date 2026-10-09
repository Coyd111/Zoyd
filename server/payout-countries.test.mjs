import { describe, it, expect } from 'vitest';
import {
  isAnySupportedPhone,
  parsePhoneForFedaPay,
  phoneFormatError,
  PAYOUT_COUNTRY_CONFIG,
  normalizePayoutCountry,
} from './payout-countries.mjs';

describe('format de telephone : le cas reel', () => {
  // Capture d'ecran du joueur : dix chiffres apres l'indicatif, alors qu'un
  // mobile beninois en compte huit. Le compte etait stocke tel quel et
  // l'echec n'apparut qu'au payout.
  it('refuse le numero qui a bloque le retrait', () => {
    expect(isAnySupportedPhone('+2290165240654')).toBe(false);
    expect(parsePhoneForFedaPay('+2290165240654', 'bj').number).toBe('');
  });

  it('accepte le meme numero sans les deux chiffres en trop', () => {
    expect(isAnySupportedPhone('+22901652406')).toBe(true);
    expect(parsePhoneForFedaPay('+22901652406', 'bj').number).toBe('01652406');
  });

  it('tolere les separateurs usuels', () => {
    for (const variant of ['+229 01 65 24 06', '+229-01-65-24-06', '+229.01.65.24.06', '(01) 65 24 06']) {
      expect(isAnySupportedPhone(variant), variant).toBe(true);
    }
  });

  it('accepte un numero local sans indicatif', () => {
    expect(parsePhoneForFedaPay('01652406', 'bj').number).toBe('01652406');
    expect(parsePhoneForFedaPay('01652406', 'bj').country).toBe('bj');
  });

  it('refuse un numero trop court ou trop long', () => {
    expect(isAnySupportedPhone('+2290165240')).toBe(false);   // 7 chiffres
    expect(isAnySupportedPhone('+229016524065')).toBe(false);  // 9 chiffres
  });
});

describe('format de telephone : aucun pays de retrait n\'est rejete', () => {
  // Une regle trop stricte qui bloque un pays entier serait pire que le
  // defaut : le joueur ne pourrait plus jamais retirer.
  const attendus = {
    bj: ['+22901652406', '01652406', '+229 61 00 00 01'],
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
    // Longueurs attendues, croisees avec les operateurs FedaPay documentes.
    expect(PAYOUT_COUNTRY_CONFIG.bj.localLength).toBe(8);
    expect(PAYOUT_COUNTRY_CONFIG.ci.localLength).toBe(10);
    expect(PAYOUT_COUNTRY_CONFIG.sn.localLength).toBe(9);
    expect(PAYOUT_COUNTRY_CONFIG.tg.localLength).toBe(8);
  });

  it('un numero invalide pour UN pays peut etre valide pour un autre', () => {
    // 10 chiffres : invalide au Benin (8 attendus), valide en CI (10 attendus).
    // D'ou l importance de tester "un pays quelconque" a l'inscription.
    expect(parsePhoneForFedaPay('+2290123456789', 'bj').number).toBe('');
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
    // qui a produit dix chiffres.
    expect(phoneFormatError('bj')).toContain('229');
    expect(phoneFormatError('bj')).toContain('8');
    expect(phoneFormatError('ci')).toContain('10');
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