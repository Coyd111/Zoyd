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

/**
 * Retire les commentaires du source.
 *
 * PIEGE : une assertion sur le source BRUT tombe sur la PROSE qui explique
 * le code. Il faut verifier le CODE, pas le commentaire qui le decrit —
 * sinon le test echoue des qu on ecrit pourquoi on ne fait pas une chose.
 */
const sansCommentaires = (texte) => texte
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  // `[^:]` protege les URL (`https://`) : sans lui, le reste de la ligne
  // serait pris pour un commentaire.
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

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
    const code = sansCommentaires(source);
    for (const interdit of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      expect(code, `${interdit} interdit`).not.toContain(interdit);
    }
  });

  it('la sonde publique ne demande AUCUN identifiant', () => {
    // PIEGE : `sante` lit une URL PUBLIQUE. Exiger la cle `service_role`
    // pour la consulter rendait l outil inutilisable sur une machine qui
    // n a pas le secret — c est a dire precisement la machine ou l
    // operateur veut voir l etat de la production.
    const code = sansCommentaires(source);
    expect(code).toMatch(/COMMANDES_SANS_BASE\s*=\s*new Set\(\['sante'\]\)/);
    // Le client Supabase ne doit etre cree QUE pour les commandes qui
    // interrogent la base.
    expect(code).toMatch(/if \(!COMMANDES_SANS_BASE\.has\(commande\)\)/);
  });

  it('ne force pas la sortie du processus', () => {
    // PIEGE : sous Windows, `process.exit(0)` pendant que le socket HTTP
    // (undici) se ferme provoque une assertion libuv
    // (« Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) »).
    // L outil se terminait alors sur un code de CRASH (-1073740791)
    // alors que tout s etait passe : un script de diagnostic qui « echoue »
    // sans raison est un script auquel on ne fait plus confiance.
    const code = sansCommentaires(source);
    expect(code).not.toMatch(/process\.exit\(0\)/);
    expect(code).toMatch(/process\.exitCode = 0;/);
  });
});
