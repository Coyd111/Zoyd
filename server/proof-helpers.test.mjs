import { describe, it, expect, vi } from 'vitest';

/**
 * Preuves durcies (P1) — URL https-only, dedup, distinctness.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * E5 ne gardait que le XSS (javascript:, <>, on*=). Une preuve pouvait
 * être `http://192.168.1.1/internal.png`, `https://user:pass@host/x`,
 * ou la même capture deux fois (scoreboard == écran final). Le même
 * module feuille (`proof-helpers.mjs`) sert MJ et ligue.
 *
 * Ce que les tests gardent
 * ------------------------
 * 1. `http://` et `www.` sans https refusés ; `https://` public accepté.
 * 2. Hôtes localhost / IP privée / `*.local` refusés.
 * 3. Identifiants `user:pass@` refusés.
 * 4. `normalizeProofRefs` déduplique (insensible à la casse).
 * 5. `hasDistinctProofs` : une seule image ne sert pas les deux preuves.
 * 6. `buildProofContentHash` : stable, sensible au contenu, ordre indifférent.
 */

import {
  isSafeProofRef,
  normalizeProofRefs,
  hasDistinctProofs,
  buildProofContentHash,
} from './proof-helpers.mjs';

describe('preuves durcies - URLs', () => {
  it('refuse http:// (https-only)', () => {
    expect(isSafeProofRef('http://example.com/a.png')).toBe(false);
    expect(isSafeProofRef('https://example.com/a.png')).toBe(true);
  });

  it('refuse les hôtes internes', () => {
    expect(isSafeProofRef('https://localhost/a.png')).toBe(false);
    expect(isSafeProofRef('https://127.0.0.1/a.png')).toBe(false);
    expect(isSafeProofRef('https://10.0.0.1/a.png')).toBe(false);
    expect(isSafeProofRef('https://192.168.1.1/a.png')).toBe(false);
    expect(isSafeProofRef('https://172.16.0.5/a.png')).toBe(false);
    expect(isSafeProofRef('https://printer.local/a.png')).toBe(false);
    expect(isSafeProofRef('https://svc.internal/a.png')).toBe(false);
  });

  it('refuse les identifiants dans l URL', () => {
    expect(isSafeProofRef('https://user:pass@example.com/a.png')).toBe(false);
    expect(isSafeProofRef('https://u@example.com/a.png')).toBe(false);
  });

  it('accepte les formes legacy non-URL', () => {
    expect(isSafeProofRef('ref-scoreboard')).toBe(true);
    expect(isSafeProofRef('screenshot 10-5')).toBe(true);
  });

  it('refuse data: non-image et svg', () => {
    expect(isSafeProofRef('data:image/svg+xml;base64,xxx')).toBe(false);
    expect(isSafeProofRef('data:text/html;base64,xxx')).toBe(false);
  });
});

describe('preuves durcies - dedup', () => {
  it('deduplique insensible à la casse, ordre préservé', () => {
    expect(normalizeProofRefs(['A.png', 'a.PNG ', ' B.png'])).toEqual(['A.png', 'B.png']);
  });
});

describe('preuves durcies - distinctness', () => {
  it('une image ne sert pas les deux preuves', () => {
    expect(hasDistinctProofs({ scoreboard: ['a.png'], finalResult: ['a.png'] })).toBe(false);
    expect(hasDistinctProofs({ scoreboard: ['a.png'], finalResult: ['b.png'] })).toBe(true);
    expect(hasDistinctProofs({ scoreboard: [], finalResult: ['b.png'] })).toBe(false);
  });
});

describe('preuves durcies - content hash', () => {
  it('stable, insensible à l ordre, sensible au contenu', () => {
    const h1 = buildProofContentHash(['a.png', 'b.png']);
    const h2 = buildProofContentHash(['b.png', 'a.png']);
    const h3 = buildProofContentHash(['a.png', 'c.png']);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });
});
