import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Collections d'état : révision OCC (scale / multi-instance).
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * `app_users.revision` protège les portefeuilles, mais les collections
 * (`state_snapshots` : matches, tournaments, leagues, brLobbies) n'avaient
 * aucune version : `replaceStateCollection` écrasait sans condition.
 * Deux instances pendant un déploiement perdaient l'écriture de l'autre,
 * en silence.
 *
 * Ce que les tests gardent
 * ------------------------
 * 1. Le schéma déclare `revision` sur `state_snapshots` (et la migration
 *    dédiée existe).
 * 2. La sonde `occStateSupporte` existe, est pilotable en test, et le
 *    repli sans colonne reste visible (avertissement + santé).
 * 3. `upsertStateEntity` écrit en conditionnel (`ecrireStateEntitySiRevision`)
 *    et lève `STATE_CONFLICT` en conflit.
 * 4. `getHealthInfo` expose `stateRevisionColumn`.
 * 5. `saveMatches` / `saveTournaments` / `saveLeagues` écrivent PAR ENTITÉ
 *    (plus de `replaceStateCollection` dans les routes).
 * 6. `http-utils` mappe `STATE_CONFLICT` en 409 (rejouable).
 */

const lire = (p) => readFileSync(resolve(p), 'utf8');

describe('state revision — invariant source', () => {
  it('le schema declare revision sur state_snapshots', () => {
    const schema = lire('supabase/schema.sql');
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS state_snapshots[\s\S]*?revision\s+BIGINT/i);
    expect(lire('supabase/migrate-state-revision.sql')).toContain('state_snapshots');
  });

  it('la sonde existe et est pilotable', () => {
    const source = lire('server/persistence.mjs');
    expect(source).toContain('const occStateSupporte');
    expect(source).toContain('export const setStateRevisionSupportedPourTest');
    expect(source).toContain('ecrireStateEntitySiRevision');
  });

  it('le repli sans colonne reste visible', () => {
    const source = lire('server/persistence.mjs');
    expect(source).toContain('state_snapshots.revision absente');
    expect(source).toContain('migrate-state-revision.sql');
  });

  it('upsertStateEntity leve STATE_CONFLICT en conflit', () => {
    const source = lire('server/persistence.mjs');
    expect(source).toContain("makeError('STATE_CONFLICT'");
    // La condition porte la révision observée.
    expect(source).toMatch(/\.eq\('revision',\s*revisionObservee|revisionObservee/);
  });

  it('getHealthInfo expose stateRevisionColumn', () => {
    expect(lire('server/persistence.mjs')).toContain('stateRevisionColumn');
  });

  it('saveMatches / saveTournaments / saveLeagues ecrivent par entite', () => {
    const source = lire('server/state-helpers.mjs');
    expect(source).toContain("upsertStateEntity('matches'");
    expect(source).toContain("upsertStateEntity('tournaments'");
    expect(source).toContain("upsertStateEntity('leagues'");
    // Plus aucun appel replace dans les saves (hors commentaires).
    const codeOnly = source.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(codeOnly).not.toContain('replaceStateCollection(');
  });

  it('http-utils mappe STATE_CONFLICT en 409', () => {
    const source = lire('server/http-utils.mjs');
    expect(source).toContain("'STATE_CONFLICT'");
  });
});
