import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Le blueprint Render (`render.yaml`) est une configuration de PRODUCTION.
 *
 * Pourquoi un test sur un fichier de configuration
 * --------------------------------------------------
 * Un commentaire explique pourquoi une variable est posee. Mais un
 * commentaire n'empeche RIEN : le jour ou quelqu'un nettoie le YAML, la
 * ligne disparait, le commentaire part avec, et rien ne bronche — jusqu au
 * premier incident.
 *
 * Concretement, `TRUST_PROXY=true` est PORTEUSE : sans elle, si le pair
 * du load balancer Render n'est pas dans une plage privee, TOUS les
 * utilisateurs partagent un seul bucket de rate-limit — et l application
 * repond 429 a tout le monde, en serie. Aucun test ne le verifiait : la
 * variable etait posee dans le YAML, et c'etait tout.
 *
 * Pourquoi une lecture par motif, et non un parseur YAML
 * -------------------------------------------------------
 * Le projet n'a aucune dependance YAML, et il n'en faut pas une pour
 * verifier trois lignes. Le motif est volontairement strict : il doit
 * correspondre a la forme exacte du blueprint, donc une reecriture de la
 * structure (une liste, un ancrage) fait ECHOUER le test — on veut etre
 * prevenu qu il faut le relire, pas qu il passe en silence.
 */
const source = readFileSync(resolve('render.yaml'), 'utf8');

/** Valeur d une variable posee explicitement (`value:`). */
const valeurEnv = (cle) => {
  const m = source.match(new RegExp(`- key: ${cle}\\s*\\n\\s*value:\\s*"?([^"\\n]*)"?`));
  return m ? m[1].trim() : null;
};

/** La variable est-elle declaree dans le blueprint, quelle que soit sa valeur ? */
const declareeEnv = (cle) => new RegExp(`- key: ${cle}\\b`).test(source);

describe('Blueprint Render — les variables porteuses', () => {
  it('TRUST_PROXY vaut true : sans lui, tous les utilisateurs partagent un bucket', () => {
    // PIEGE : le trafic arrive par le load balancer Render. Si le peer du
    // LB n est pas dans une plage privee, le X-Forwarded-For n est pas
    // cru, et TOUS les clients se retrouvent dans le meme bucket de
    // rate-limit -> 429 en serie pour tout le monde.
    //
    // Le pair n etant pas garanti prive par Render, on force la confiance.
    // Le service n est accessible que par le LB : le risque symrique
    // (un client qui forge son XFF) n existe pas ici.
    expect(valeurEnv('TRUST_PROXY'), 'TRUST_PROXY doit rester a true').toBe('true');
  });

  it('WEB_CONCURRENCY vaut 1 : le service doit rester mono-processus', () => {
    // Le garde-fou d execution (`single-process-guard.mjs`) refuse de
    // demarrer avec WEB_CONCURRENCY>1. Mais ce garde-fou ne dit rien du
    // YAML : si la variable disparait du blueprint, le service demarre
    // quand meme, et la garantie « un seul processus » redevient un
    // concours de circonstances (absence de `cluster` dans la commande).
    expect(valeurEnv('WEB_CONCURRENCY')).toBe('1');
  });

  it('aucune cle anon : tout passe par la cle service_role', () => {
    // PIEGE : le code ne lit pas `SUPABASE_ANON_KEY`. La poser donnerait
    // l illusion qu un acces « public » fonctionne, alors que toute
    // ecriture echouerait derriere le RLS — avec un client pourtant
    // annonce actif. Le depose d une cle dans le tableau de bord n
    // changerait rien.
    expect(declareeEnv('SUPABASE_ANON_KEY')).toBe(false);
  });

  it('la cle service_role est bien declaree', () => {
    // Contradictoire du test precedent : sans elle, aucune ecriture ne
    // passe, et le mode memoire s active silencieusement.
    expect(declareeEnv('SUPABASE_SERVICE_KEY')).toBe(true);
  });
});
