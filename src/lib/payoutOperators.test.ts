import { describe, it, expect } from 'vitest';
import {
  formatPhoneInput,
  isValidPhoneForCountry,
  isAnySupportedPhone,
  getPayoutCountry,
  PAYOUT_COUNTRIES,
} from './payoutOperators';

const BJ = PAYOUT_COUNTRIES.bj;

describe('formatPhoneInput : le pave numerique n a pas de touche espace', () => {
  // Le placeholder affichait `+229 01 61 00 00 01` alors que le champ est
  // `type="tel"` : sur mobile, le joueur ne pouvait pas taper l'exemple qu'on
  // lui montrait. Le format est donc applique automatiquement.
  it('formate le numero du joueur', () => {
    expect(formatPhoneInput('+2290165240654', BJ)).toBe('+229 01 65 24 06 54');
  });

  it('formate un numero local', () => {
    expect(formatPhoneInput('0165240654', BJ)).toBe('01 65 24 06 54');
  });

  it('l indicatif pays n est pas compte dans les groupes', () => {
    // Sinon +229 donnerait « +229 22 90 16 52 … ».
    expect(formatPhoneInput('+2290161000001', BJ)).toBe('+229 01 61 00 00 01');
  });

  it('tolere un numero deja formate', () => {
    expect(formatPhoneInput('+229 01 65 24 06 54', BJ)).toBe('+229 01 65 24 06 54');
  });

  it('tolere separateurs et points', () => {
    expect(formatPhoneInput('+229.01.65.24.06.54', BJ)).toBe('+229 01 65 24 06 54');
    expect(formatPhoneInput('+229-01-65-24-06-54', BJ)).toBe('+229 01 65 24 06 54');
    expect(formatPhoneInput('(+229) 01 65 24 06 54', BJ)).toBe('+229 01 65 24 06 54');
  });

  it('accepte le prefixe international 00', () => {
    expect(formatPhoneInput('002290165240654', BJ)).toBe('+229 01 65 24 06 54');
  });

  it('reste utilisable pendant la saisie progressive', () => {
    // Le joueur tape chiffre par chiffre : chaque état intermédiaire doit
    // conserver exactement les chiffres déjà saisis. Une première version
    // insérait « +229 » dès le premier « 2 » tapé, donc le champ réécrivait la
    // saisie en cours — le joueur perdait ce qu'il venait de taper.
    const saisi = '+2290165240654';
    let accumule = '';
    let chiffresTapes = 0;
    for (const char of saisi) {
      accumule = formatPhoneInput(accumule + char, BJ);
      // Le « + » n'est pas un chiffre : on ne compte que les chiffres tapés.
      if (/\d/.test(char)) chiffresTapes += 1;
      const chiffresAffiches = (accumule.match(/\d/g) || []).length;
      expect(chiffresAffiches, `après "${saisi.slice(0, chiffresTapes)}" -> "${accumule}"`).toBe(chiffresTapes);
    }
    expect(accumule).toBe('+229 01 65 24 06 54');
    // L'état final est bien accepté par la validation.
    expect(isValidPhoneForCountry(accumule, BJ)).toBe(true);
  });

  it('ne casse pas sur une saisie vide ou en cours', () => {
    expect(formatPhoneInput('', BJ)).toBe('');
    expect(formatPhoneInput('   ', BJ)).toBe('');
    expect(formatPhoneInput('+', BJ)).toBe('+');
  });

  it('fonctionne sans pays connu', () => {
    // Le retrait est bloque, mais le champ ne doit pas planter ni mentir.
    expect(formatPhoneInput('0165240654', null)).toBe('01 65 24 06 54');
  });

  it('le format produit reste accepte par la validation', () => {
    const formate = formatPhoneInput('+2290165240654', BJ);
    expect(isValidPhoneForCountry(formate, BJ)).toBe(true);
    // La validation doit ignorer les espaces que l'affichage introduit.
    expect(isValidPhoneForCountry('+229 01 65 24 06 54', BJ)).toBe(true);
  });
});

describe('les deux formats beninois restent acceptes', () => {
  it('10 chiffres, format courant depuis la migration ARCEP', () => {
    expect(isValidPhoneForCountry('+229 01 65 24 06 54', BJ)).toBe(true);
    expect(isAnySupportedPhone('+2290165240654')).toBe(true);
  });

  it('8 chiffres, format anterieur conserve pour les comptes existants', () => {
    expect(isValidPhoneForCountry('+229 60 00 00 00', BJ)).toBe(true);
    expect(isAnySupportedPhone('+22960000000')).toBe(true);
  });
});

describe('pays : recherche insensible aux accents', () => {
  it('retrouve les quatre payssupportes depuis leurs libelles FR', () => {
    // Un profil enregistre sous « Benin » — la forme affichee — renvoyait
    // null : le joueur lisait « retraits bientot disponibles pour ton pays ».
    expect(getPayoutCountry('Benin')?.iso).toBe('bj');
    expect(getPayoutCountry('Bénin')?.iso).toBe('bj');
    expect(getPayoutCountry("Cote d'Ivoire")?.iso).toBe('ci');
    expect(getPayoutCountry("Côte d’Ivoire")?.iso).toBe('ci');
    expect(getPayoutCountry('Senegal')?.iso).toBe('sn');
    expect(getPayoutCountry('Sénégal')?.iso).toBe('sn');
    expect(getPayoutCountry('Togo')?.iso).toBe('tg');
  });

  it('renvoie null pour un pays non supporte', () => {
    expect(getPayoutCountry('France')).toBeNull();
    expect(getPayoutCountry('')).toBeNull();
    expect(getPayoutCountry(undefined)).toBeNull();
  });
});