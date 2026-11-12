import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * L outil d exploitation doit montrer l etat de la purge de l historique.
 *
 * Pourquoi ce test lit la SOURCE
 * -------------------------------
 * `scripts/prod-inspect.mjs` est un script en lecture seule : il lit
 * `.env.production.local` et interroge la production. L executer dans un
 * test imposerait des identifiants reels et un acces reseau — donc un
 * test qui depend de l environnement, et qui ne testerait rien en CI.
 *
 * Ce qui compte ici est une PROPRIETE de l outil : il affiche l etat de
 * la purge, et il signale l echec. Le source est donc lue, comme c'est
 * fait ailleurs dans le depot pour les modules qui assemblent une sonde.
 *
 * Pourquoi c'est une ALERTE et pas un simple affichage
 * ---------------------------------------------------
 * La purge a deja echoue EN SILENCE en production : un `limit()` invalide
 * sur le DELETE (`DELETE ... RETURNING id LIMIT n` = erreur SQL 42601).
 * L historique grossissait de plusieurs milliers de lignes par jour, sans
 * borne, et AUCUN signal ne le montrait. Un operateur qui lit la sonde
 * doit donc voir l echec — c est le meme principe que la purge publiee
 * dans `/api/health`.
 */
const source = readFileSync(resolve('scripts/prod-inspect.mjs'), 'utf8');

describe('prod-inspect — etat de la purge de l historique', () => {
  it('affiche l etat de la purge et son horodatage', () => {
    // Mot entier : `toContain` matcherait aussi un nom prefixes par
    // d autre caractere, et le test passerait sur un code qui n affiche
    // rien.
    expect(source).toMatch(/\bcronLeaseAuditPurgedAt\b/);
    expect(source).toMatch(/\bcronLeaseAuditPurgeError\b/);
    expect(source).toMatch(/\bcronLeaseAuditAvailable\b/);
  });

  it('signale l ECHEC de purge, pas seulement son horodatage', () => {
    // Un simple affichage de l horodatage ne revele rien : quand la purge
    // echoue, c est l ERREUR qu il faut voir.
    expect(source).toMatch(/if \(persistance\.cronLeaseAuditPurgeError\)/);
    expect(source).toContain('la purge de l historique ECHOUE');
  });

  it('reste en LECTURE SEULE', () => {
    // L outil ne doit jamais ecrire dans la production. Une seule
    // ecriture transformerait un outil de diagnostic en outil de
    // modification de donnees.
    for (const interdit of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      expect(source, `${interdit} interdit`).not.toContain(interdit);
    }
  });
});
