import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Chiffrement au repos des secrets TOTP admin (server/secret-crypto.mjs).
 *
 * Ce que ces tests verrouillent :
 *  - un secret n'est JAMAIS ecrit en clair quand ZOYD_2FA_ENC_KEY est la ;
 *  - le format est auto-descriptible (v1:), la lecture fait les deux (legacy + chiffre) ;
 *  - une ligne chiffree avec une autre cle (ou alteree) est SAUTEE, jamais fabriquee ;
 *  - la rotation de cle fonctionne (NEXT en ecriture, les deux en lecture) ;
 *  - l'auto-migration au chargement reecrit les lignes legacy chiffrees,
 *    SANS downtime ni action manuelle ;
 *  - en production sans cle, l'ecriture REFUSE (fail-closed) — jamais en clair.
 */

const KEY_A = Buffer.alloc(32, 'a').toString('base64');
const KEY_B = Buffer.alloc(32, 'b').toString('base64');

const state = { rows: [], upserts: [], failUpsert: false };

vi.mock('./supabase.mjs', () => {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    upsert: vi.fn((data) => {
      state.upserts.push(data);
      return Promise.resolve({
        error: state.failUpsert ? { message: 'upsert down', code: 'UNKNOWN_ERROR' } : null,
      });
    }),
    then: (resolve) => resolve({ data: state.rows, error: null }),
  };
  return { supabase: { from: vi.fn(() => q) } };
});

import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  isSecretCryptoConfigured,
} from './secret-crypto.mjs';
import { loadAdminTotpSecrets, saveAdminTotpSecret } from './persistence.mjs';

const cleanEnv = () => {
  delete process.env.ZOYD_2FA_ENC_KEY;
  delete process.env.ZOYD_2FA_ENC_KEY_NEXT;
  delete process.env.NODE_ENV;
};

beforeEach(() => {
  cleanEnv();
  state.rows = [];
  state.upserts = [];
  state.failUpsert = false;
});
afterEach(cleanEnv);

describe('secret-crypto — roundtrip et robustesse', () => {
  it('chiffre puis dechiffre un secret', () => {
    process.env.ZOYD_2FA_ENC_KEY = KEY_A;
    const { value, encrypted } = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(encrypted).toBe(true);
    expect(value.startsWith('v1:')).toBe(true);
    expect(isEncryptedSecret(value)).toBe(true);
    expect(isSecretCryptoConfigured()).toBe(true);
    const { plaintext, wasEncrypted } = decryptSecret(value);
    expect(wasEncrypted).toBe(true);
    expect(plaintext).toBe('JBSWY3DPEHPK3PXP');
  });

  it('deux chiffrements du meme secret different (IV aleatoire)', () => {
    process.env.ZOYD_2FA_ENC_KEY = KEY_A;
    const a = encryptSecret('MEME-SECRET').value;
    const b = encryptSecret('MEME-SECRET').value;
    expect(a).not.toBe(b);
  });

  it('une donnee alteree est refusee (tag GCM)', () => {
    process.env.ZOYD_2FA_ENC_KEY = KEY_A;
    const { value } = encryptSecret('SECRET-TO-TAMPER');
    const parts = value.split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0x01;
    parts[3] = ct.toString('base64');
    const { plaintext, error } = decryptSecret(parts.join(':'));
    expect(plaintext).toBeNull();
    expect(error).toBe('decrypt');
  });

  it('une cle differente ne dechiffre pas', () => {
    process.env.ZOYD_2FA_ENC_KEY = KEY_A;
    const { value } = encryptSecret('SECRET-A');
    process.env.ZOYD_2FA_ENC_KEY = KEY_B;
    const { plaintext, error } = decryptSecret(value);
    expect(plaintext).toBeNull();
    expect(error).toBe('decrypt');
  });

  it('rotation : encrypt avec NEXT, lecture avec les deux', () => {
    process.env.ZOYD_2FA_ENC_KEY = KEY_A;
    const legacy = encryptSecret('SECRET-AVEC-A').value;

    process.env.ZOYD_2FA_ENC_KEY_NEXT = KEY_B;
    // Les nouvelles ecritures passent sur NEXT...
    const rotated = encryptSecret('SECRET-AVEC-B').value;
    // ...et les deux restes dechiffrables pendant la transition.
    expect(decryptSecret(legacy).plaintext).toBe('SECRET-AVEC-A');
    expect(decryptSecret(rotated).plaintext).toBe('SECRET-AVEC-B');

    delete process.env.ZOYD_2FA_ENC_KEY;
    expect(decryptSecret(legacy).plaintext, 'ancienne ligne illisible sans ancienne cle').toBeNull();
    expect(decryptSecret(rotated).plaintext).toBe('SECRET-AVEC-B');
  });

  it('sans cle hors production : repli clair explicite (dev/test)', () => {
    const { value, encrypted } = encryptSecret('DEV-SECRET');
    expect(encrypted).toBe(false);
    expect(value).toBe('DEV-SECRET');
    expect(isSecretCryptoConfigured()).toBe(false);
  });

  it('sans cle en PRODUCTION : refus (fail-closed, jamais en clair)', () => {
    process.env.NODE_ENV = 'production';
    expect(() => encryptSecret('PROD-SECRET')).toThrowError(/ZOYD_2FA_ENC_KEY/);
  });

  it('un secret legacy en clair est lu tel quel', () => {
    const { plaintext, wasEncrypted } = decryptSecret('CLEAR-LEGACY-SECRET');
    expect(plaintext).toBe('CLEAR-LEGACY-SECRET');
    expect(wasEncrypted).toBe(false);
    expect(isEncryptedSecret('CLEAR-LEGACY-SECRET')).toBe(false);
  });
});

describe('persistance 2FA — ecriture et auto-migration', () => {
  it('saveAdminTotpSecret ecrit chiffre quand la cle est la', async () => {
    process.env.ZOYD_2FA_ENC_KEY = KEY_A;
    await saveAdminTotpSecret('admin-1', 'SECRET-PLAIN', true);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].user_id).toBe('admin-1');
    expect(state.upserts[0].secret.startsWith('v1:')).toBe(true);
    expect(decryptSecret(state.upserts[0].secret).plaintext).toBe('SECRET-PLAIN');
  });

  it('saveAdminTotpSecret en production sans cle REFUSE', async () => {
    process.env.NODE_ENV = 'production';
    await expect(saveAdminTotpSecret('admin-1', 'SECRET-PLAIN', true))
      .rejects.toMatchObject({ code: 'SERVER_BUSY' });
    expect(state.upserts).toHaveLength(0);
  });

  it('loadAdminTotpSecrets lit une ligne legacy et la re-ecrit chiffree', async () => {
    process.env.ZOYD_2FA_ENC_KEY = KEY_A;
    state.rows = [{ user_id: 'admin-legacy', secret: 'LEGACY-PLAIN', enabled: true }];

    const loaded = await loadAdminTotpSecrets();
    expect(loaded.get('admin-legacy')).toMatchObject({ secret: 'LEGACY-PLAIN', enabled: true });
    // Auto-migration : une reecriture chiffree a eu lieu.
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].user_id).toBe('admin-legacy');
    expect(state.upserts[0].secret.startsWith('v1:')).toBe(true);
    expect(decryptSecret(state.upserts[0].secret).plaintext).toBe('LEGACY-PLAIN');
  });

  it('loadAdminTotpSecrets ne reecrit PAS une ligne deja chiffree', async () => {
    process.env.ZOYD_2FA_ENC_KEY = KEY_A;
    const stored = encryptSecret('ALREADY-ENC').value;
    state.rows = [{ user_id: 'admin-enc', secret: stored, enabled: false }];

    const loaded = await loadAdminTotpSecrets();
    expect(loaded.get('admin-enc')?.secret).toBe('ALREADY-ENC');
    expect(state.upserts).toHaveLength(0);
  });

  it('une ligne chiffree avec une autre cle est SAUTEE, le reste passe', async () => {
    process.env.ZOYD_2FA_ENC_KEY = KEY_B;
    const secretWithB = encryptSecret('SECRET-B').value;
    process.env.ZOYD_2FA_ENC_KEY = KEY_A;
    state.rows = [
      { user_id: 'admin-other-key', secret: secretWithB, enabled: true },
      { user_id: 'admin-ok', secret: 'LEGACY-OK', enabled: true },
    ];

    const loaded = await loadAdminTotpSecrets();
    expect(loaded.has('admin-other-key'), 'ligne indechiffrable sautee').toBe(false);
    expect(loaded.get('admin-ok')?.secret).toBe('LEGACY-OK');
  });
});
