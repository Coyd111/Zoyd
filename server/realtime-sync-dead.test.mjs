import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `POST /api/realtime/state/sync` est un endpoint MORT, et cette suite
 * verifie qu'il le reste — volontairement.
 *
 * Pourquoi ne pas simplement le supprimer : c'est une API publique. La
 * retirer est un changement de contrat qui regarde au-dela de ce depot, et
 * personne ici n'a mesure qui l'appelle encore.
 *
 * Pourquoi le tester malgre tout : la fonction client `syncRealtimeState`
 * ressemble a un appel qui fonctionne. Le serveur repond pourtant 409 ou 400
 * a TOUT. Un developpeur qui l'appelle decouvre un 400 sans comprendre
 * pourquoi. Un test qui ecrit noir sur blanc « cet endpoint ne sert a rien »
 * transforme un piege en information.
 *
 * Si un jour la route doit disparaitre, ce test doit disparaitre avec elle :
 * c'est le signal que le contrat a change volontairement.
 */

const routeFile = path.join(process.cwd(), 'server', 'routes', 'realtime.mjs');
const source = fs.readFileSync(routeFile, 'utf8');

describe('POST /api/realtime/state/sync — contrat verrouille', () => {
  it('refuse les tournois avec DEPRECATED_ROUTE', () => {
    // Les tournois passent par des routes API dediees. Acceptes ici, ils
    // seraient ecrits par le client — donc perdus au prochain demarrage.
    expect(source).toContain("pathname === '/api/realtime/state/sync'");
    expect(source).toContain('DEPRECATED_ROUTE');
  });

  it('refuse tout le reste avec INVALID_PAYLOAD', () => {
    expect(source).toContain('INVALID_PAYLOAD');
  });

  it('n ecrit rien : la route ne appelle aucun moteur ni aucune persistance', () => {
    const bloc = source.slice(
      source.indexOf("pathname === '/api/realtime/state/sync'")
    ).slice(0, 1200);

    // Si une ecriture un jour apparait ici, le statut « dead » n'est plus
    // vrai et ce test doit sauter.
    for (const interdit of ['sbUpsert', 'replaceStateCollection', 'saveMatches', 'sbFire']) {
      expect(bloc, `la route ne doit pas appeler ${interdit}`).not.toContain(interdit);
    }
  });

  it("l appelant cote client n existe plus : rien ne l'invoque", () => {
    // `syncServerState` (store) est le seul appelant de `syncRealtimeState`,
    // et lui n'est appele par personne. Sans cette verification, quelqu'un
    // pourrait rebrancher la chaine et decouvrir le 400 en production.
    const storePath = path.join(process.cwd(), 'src', 'app', 'stores', 'socketConnectionStore.ts');
    const store = fs.readFileSync(storePath, 'utf8');

    const definitSyncServerState = /syncServerState: async/.test(store);
    expect(definitSyncServerState, 'la fonction existe mais doit rester non appelee').toBe(true);

    // On compte les usages hors definition : il doit y en avoir zero.
    const horsDefinition = store.replace(/syncServerState: async[\s\S]*?\n {2}\},/, '');
    expect(horsDefinition).not.toContain('syncServerState(');
  });
});