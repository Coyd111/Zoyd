import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { verifyTotp, toBase32, base32Decode, TOTP_DIGITS, TOTP_PERIOD } from './admin-totp.mjs';

/**
 * RFC 6238 (TOTP) — vecteurs de test officiels, appendix B, SHA-1.
 *
 * Le secret de la RFC est la chaine ASCII "12345678901234567890" (20 octets).
 * La RFC publie des codes a 8 chiffres ; on ne garde que les 6 derniers, ce qui
 * est exactement ce que fait l'implementation (otp % 10^6).
 *
 * Pourquoi ces vecteurs comptent : le TOTP est ecrit a la main ici (base32 +
 * HMAC + dynamic truncation). Une erreur d'un bit dans le compteur ou dans le
 * decoupage ne casse RIEN de visible : le code est simplement refuse, et la
 * 2FA de l'admin qui deplace l'argent devient inutilisable — ou, pire, valide
 * au mauvais moment. Ces vecteurs sont la seule preuve que l'implementation
 * est conforme au standard, et non seulement "plausible".
 */
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const RFC_VECTORS = [
  { time: 59, code: '287082' },
  { time: 1111111109, code: '081804' },
  { time: 1111111111, code: '050471' },
  { time: 1234567890, code: '005924' },
  { time: 2000000000, code: '279037' },
  { time: 20000000000, code: '353130' },
];

/** Fige l'horloge : verifyTotp lit Date.now(), le temps n'est donc pas injectable. */
const atTime = (seconds, fn) => {
  vi.useFakeTimers();
  vi.setSystemTime(seconds * 1000);
  try {
    return fn();
  } finally {
    vi.useRealTimers();
  }
};

describe('admin-totp — vecteurs officiels RFC 6238', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it('le secret de la RFC se decode bien (aller-retour base32)', () => {
    expect(toBase32(Buffer.from(RFC_SECRET_ASCII, 'ascii'))).toBe(RFC_SECRET_BASE32);
    expect(base32Decode(RFC_SECRET_BASE32).toString('ascii')).toBe(RFC_SECRET_ASCII);
  });

  for (const { time, code } of RFC_VECTORS) {
    it(`accepte le code officiel a T=${time} (${code})`, () => {
      const accepted = atTime(time, () => verifyTotp(RFC_SECRET_BASE32, code));
      expect(accepted).toBe(true);
    });
  }

  it('refuse le code officiel decale d un chiffre', () => {
    const wrong = atTime(59, () => verifyTotp(RFC_SECRET_BASE32, '287083'));
    expect(wrong).toBe(false);
  });
});

describe('admin-totp — fenetre de tolerance', () => {
  afterEach(() => vi.useRealTimers());

  it('accepte le code du pas de temps precedent (clock skew -1)', () => {
    const code = RFC_VECTORS[2].code;
    const t = RFC_VECTORS[2].time;
    const accepted = atTime(t + TOTP_PERIOD, () => verifyTotp(RFC_SECRET_BASE32, code));
    expect(accepted).toBe(true);
  });

  it('accepte le code du pas de temps suivant (clock skew +1)', () => {
    const code = RFC_VECTORS[2].code;
    const t = RFC_VECTORS[2].time;
    const accepted = atTime(t - TOTP_PERIOD, () => verifyTotp(RFC_SECRET_BASE32, code));
    expect(accepted).toBe(true);
  });

  it('refuse un code hors fenetre (au-dela de +/- 1 pas)', () => {
    const code = RFC_VECTORS[2].code;
    const t = RFC_VECTORS[2].time;
    const refused = atTime(t + 2 * TOTP_PERIOD, () => verifyTotp(RFC_SECRET_BASE32, code));
    expect(refused).toBe(false);
  });
});

describe('admin-totp — cas limites', () => {
  afterEach(() => vi.useRealTimers());

  it('refuse une chaine vide, une longueur fausse, du non-chiffre et du type incorrect', () => {
    atTime(59, () => {
      expect(verifyTotp(RFC_SECRET_BASE32, '')).toBe(false);
      expect(verifyTotp(RFC_SECRET_BASE32, '12345')).toBe(false);      // 5 chiffres
      expect(verifyTotp(RFC_SECRET_BASE32, '2870821')).toBe(false);   // 7 chiffres
      expect(verifyTotp(RFC_SECRET_BASE32, 'abcdef')).toBe(false);    // non numerique
      expect(verifyTotp(RFC_SECRET_BASE32, undefined)).toBe(false);   // undefined
      expect(verifyTotp(RFC_SECRET_BASE32, null)).toBe(false);
      expect(verifyTotp(RFC_SECRET_BASE32, 287082)).toBe(false);      // nombre
      expect(verifyTotp(RFC_SECRET_BASE32, {})).toBe(false);
    });
  });

  it('ne leve pas sur un secret corrompu, il refuse', () => {
    const refused = atTime(59, () => verifyTotp('!!!pas-base32!!!', '287082'));
    expect(refused).toBe(false);
  });

  it('formate toujours exactement TOTP_DIGITS chiffres, avec zeros initiaux', () => {
    // T=1234567890 donne 005924 : sans padStart, la comparaison de longueur
    // echouerait et le code officiel serait refuse.
    atTime(1234567890, () => {
      expect(verifyTotp(RFC_SECRET_BASE32, '005924')).toBe(true);
      expect(verifyTotp(RFC_SECRET_BASE32, '5924')).toBe(false);
    });
    expect(TOTP_DIGITS).toBe(6);
  });

  it('deux secrets differents ne partagent pas leurs codes', () => {
    const autreSecret = toBase32(Buffer.from('un-autre-secret-de-20o', 'ascii'));
    atTime(59, () => {
      expect(verifyTotp(RFC_SECRET_BASE32, '287082')).toBe(true);
      expect(verifyTotp(autreSecret, '287082')).toBe(false);
    });
  });
});