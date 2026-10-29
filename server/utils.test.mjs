/**
 * server/utils.test.mjs - Tests de `makeError`.
 *
 * P1 C5 (audit-3) : `details` s'appliquait APRES `{ code }` dans
 * `Object.assign` — un `details.code` ecrasait silencieusement le code
 * metier, donc le mapping HTTP (faux 500 generique). L'invariant est
 * maintenant structurel : `code` gagne toujours.
 */

import { describe, it, expect } from 'vitest';
import { makeError } from './utils.mjs';

describe('makeError - invariant `code` gagne (audit-3 P1 C5)', () => {
  it("un details.code n'ecrase jamais le code metier", () => {
    const err = makeError('WITHDRAWAL_MIN', 'Trop bas.', {
      code: 'FEDA_OVERRIDDEN',
      payoutId: 'PAY-1',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('WITHDRAWAL_MIN');
    expect(err.message).toBe('Trop bas.');
    expect(err.payoutId).toBe('PAY-1');
  });

  it('sans details, le code et le message sont poses', () => {
    const err = makeError('SOLO', 'Seul.');
    expect(err.code).toBe('SOLO');
    expect(err.message).toBe('Seul.');
  });

  it('details null est accepte', () => {
    const err = makeError('X', 'msg', null);
    expect(err.code).toBe('X');
    expect(err.message).toBe('msg');
  });
});
