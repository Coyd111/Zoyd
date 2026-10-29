/**
 * server/http-utils.test.mjs - Tests du mapping des erreurs HTTP.
 *
 * P1 C1 (audit-3) : `CLIENT_ABORTED` (le client coupe la connexion pendant
 * la lecture du corps, `parseRequestBody`) tombait dans le `default` de
 * `mapPersistenceError` — faux 500, logge en erreur, compte dans les
 * metriques 5xx (`respondMappedError` ne logge que les 500, le compteur que
 * les >= 500). Ces tests verrouillent le groupe 400 des trois codes que
 * `parseRequestBody` peut lever.
 */

import { describe, it, expect } from 'vitest';
import { mapPersistenceError } from './http-utils.mjs';

const err = (code, message = 'boom') => Object.assign(new Error(message), { code });

describe('mapPersistenceError - codes du corps de requete (audit-3 P1 C1)', () => {
  it('CLIENT_ABORTED tombe dans le groupe 400, pas dans le default 500', () => {
    const mapped = mapPersistenceError(err('CLIENT_ABORTED', 'Requete interrompue.'));
    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe('CLIENT_ABORTED');
    expect(mapped.message).toBe('Requete interrompue.');
  });

  it('INVALID_JSON et PAYLOAD_TOO_LARGE restent dans le groupe 400', () => {
    expect(mapPersistenceError(err('INVALID_JSON')).status).toBe(400);
    expect(mapPersistenceError(err('PAYLOAD_TOO_LARGE')).status).toBe(400);
  });

  it('un code inconnu reste un 500 generique', () => {
    const mapped = mapPersistenceError(err('TOTALLY_UNKNOWN'));
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe('TOTALLY_UNKNOWN');
  });
});
