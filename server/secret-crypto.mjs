/**
 * server/secret-crypto.mjs - Chiffrement au repos des secrets TOTP admin.
 *
 * Pourquoi : les secrets 2FA etaient ecrits EN CLAIR dans
 * `admin_2fa_secrets.secret`. Un dump SQL ou un backup vole suffisait a
 * contourner la 2FA des actions d'argent admin (refunds, sanctions,
 * distribution des prix). Le serveur detient deja la cle en memoire pour
 * verifier les codes : la donner aussi a la base n'apporte rien.
 *
 * Choix : AES-256-GCM (confidentialite + integrite), format auto-descriptible
 * stocke dans la MEME colonne (`secret`, TEXT NOT NULL) :
 *
 *   v1:<iv base64>:<tag base64 16 octets>:<ciphertext base64>
 *
 * - `v1` = version + algorithme ; un stockage sans prefixe est LU COMME CLAIR
 *   (legacy) puis re-ecrit chiffre au prochain chargement (auto-migration),
 *   sans downtime ni etape manuelle de deploiement.
 * - IV aleatoire 12 octets par ecriture ; la cle fait exactement 32 octets.
 *
 * Cles (variables d'environnement, JAMAIS dans le depot) :
 *   ZOYD_2FA_ENC_KEY       - cle courante (base64 32 octets)
 *   ZOYD_2FA_ENC_KEY_NEXT  - cle de rotation : les NOUVELLES ecritures y
 *                            passent, la lecture essaie les deux. Une fois
 *                            tous les secrets reecrits, retirer KEY et
 *                            promouvoir NEXT en KEY.
 *
 * Règles :
 *   - production (NODE_ENV=production) SANS cle : l'ecriture REFUSE (makeError)
 *     plutot que d'ecrire en clair — la 2FA se signale, elle ne se sabote pas.
 *   - hors production sans cle : repli clair (dev/test), sciemment tolerant ;
 *     tout est trace par un warning au chargement.
 *   - lecture avec cle mais ligne incomprehensible/fausse : la ligne est
 *     SAUTEE avec une erreur loggee — jamais une valeur inventee, jamais un
 *     throw qui empeche le demarrage complet.
 *
 * Ce module ne connait ni la base ni Express : il est pur (entree -> sortie).
 */

import crypto from 'node:crypto';
import { makeError } from './utils.mjs';
import { createLogger } from './logger.mjs';

const log = createLogger('secret-crypto');

const PREFIX = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

const readKey = (name) => {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== KEY_BYTES) {
      log.error(`${name} invalide : ${KEY_BYTES} octets base64 attendus, recu ${buf.length}.`);
      return null;
    }
    return buf;
  } catch {
    log.error(`${name} invalide : base64 decodable attendu.`);
    return null;
  }
};

/** Cle d'ecriture : la cle de rotation si definie, sinon la cle courante. */
const getWriteKey = () => readKey('ZOYD_2FA_ENC_KEY_NEXT') || readKey('ZOYD_2FA_ENC_KEY');

/** Cles de lecture, sans doublons : courante + rotation eventuelle. */
const getReadKeys = () => {
  const keys = [readKey('ZOYD_2FA_ENC_KEY'), readKey('ZOYD_2FA_ENC_KEY_NEXT')];
  return keys.filter((key, index, arr) => key && arr.findIndex((k) => k && k.equals(key)) === index);
};

export const isSecretCryptoConfigured = () => Boolean(getWriteKey());

/** true si la valeur stockee est au format chiffre v1. */
export const isEncryptedSecret = (stored) => String(stored ?? '').startsWith(`${PREFIX}:`);

/**
 * Prefixe + chiffre un secret. Hors production sans cle : rend la valeur en
 * clair (repli dev explicite). En production sans cle : leve SERVER_BUSY.
 */
export const encryptSecret = (plaintext) => {
  const key = getWriteKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw makeError(
        'SERVER_BUSY',
        'ZOYD_2FA_ENC_KEY manquant : le serveur refuse d\'ecrire un secret 2FA en clair.',
      );
    }
    return { value: String(plaintext), encrypted: false };
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return {
    value: [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':'),
    encrypted: true,
  };
};

/**
 * Deduit le secret depuis le stockage.
 * @returns {{ plaintext: string|null, wasEncrypted: boolean, error?: string }}
 *   plaintext null => ligne inexploitable (a ignorer cote appelant).
 */
export const decryptSecret = (stored) => {
  const value = String(stored ?? '');
  if (!isEncryptedSecret(value)) {
    return { plaintext: value, wasEncrypted: false };
  }
  const parts = value.split(':');
  if (parts.length !== 4) {
    log.error('Secret 2FA au format v1 invalide (composants inattendus).');
    return { plaintext: null, wasEncrypted: true, error: 'format' };
  }
  const [, ivB64, tagB64, ciphertextB64] = parts;
  for (const key of getReadKeys()) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return { plaintext, wasEncrypted: true };
    } catch {
      // mauvaise cle ou donnees altérées : essayer la cle suivante
    }
  }
  log.error('Secret 2FA indechiffrable (cle manquante ou donnees alterees).');
  return { plaintext: null, wasEncrypted: true, error: 'decrypt' };
};
