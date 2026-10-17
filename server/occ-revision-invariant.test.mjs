import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Invariant : toute écriture de `app_users` fait avancer `revision`.
 *
 * Pourquoi un test d'invariant, et pas un test de conflit
 * ------------------------------------------------------
 * Un test « deux instances ne s'écrasent pas » ne prouverait pas que la
 * protection couvre quoi que ce soit. Il suffit qu'UNE écriture oblique — un
 * changement de mot de passe, une maintenance — n'incrémente pas la révision
 * pour que le mécanisme soit percé : cette écriture laisse la révision intacte,
 * donc le CAS concurrent passe quand même et écrase.
 *
 * C'est le piège que j'ai rencontres une premiere fois : conditionner un seul
 * chemin sur cinq donnait une protection réelle pour un seul d'entre eux, avec
 * l'apparence de couvrir les autres. Bien pire que le risque assumé, parce
 * qu'on cesse alors de chercher.
 *
 * D'où l'invariant teste ici : le compteur n'avance que si TOUTES les écritures
 * passent par le meme point d'entree. C'est une propriete de la structure, pas
 * une discipline de relecture — un sixieme chemin oublie ne peut pas la casser.
 */

const lirePersistence = () => readFileSync(resolve('server/persistence.mjs'), 'utf8');

describe('OCC — invariant de revision', () => {
  it('aucune ecriture app_users hors du point d entree centralise', () => {
    const source = lirePersistence();
    // On retire le corps du helper : ses deux `sbUpsert` font partie du
    // mecanisme (creation de ligne, et repli si la migration manque).
    const debutHelper = source.indexOf('const ecrireUserRow = async');
    const finHelper = source.indexOf('const rechargerUserRow', debutHelper);
    expect(debutHelper, 'le point d entree centralise doit exister').toBeGreaterThan(-1);

    const horsHelper = source.slice(0, debutHelper) + source.slice(finHelper);
    const sites = horsHelper
      .split('\n')
      .map((l, i) => [i, l])
      .filter(([, l]) => l.includes("sbUpsert('app_users'"))
      // La ligne de commentaire qui annonce l'invariant ne compte pas.
      .filter(([, l]) => !l.trim().startsWith('//'));

    expect(sites.map(([i]) => i), 'toute ecriture doit passer par ecrireUserRow').toEqual([]);
  });

  it('le point d entree fait toujours avancer la revision', () => {
    const source = lirePersistence();
    const debut = source.indexOf('const ecrireUserRow = async');
    const fin = source.indexOf('const rechargerUserRow', debut);
    const corps = source.slice(debut, fin);

    // Chemin nominal : l'increment vit dans l'appelante conditionnelle, qui
    // recoit la revision observee et ecrit l observee + 1.
    expect(source).toMatch(/revision: revisionObservee \+ 1/);
    // Creation de ligne : revision 0, donc lisible et conditionnable ensuite.
    expect(corps).toMatch(/revision: 0/);
    // Rejeu sur l'etat frais : sans cela, le rejeu ecrirait le patch calcule
    // sur la base perimee — exactement l'ecrasement qu'on empeche.
    expect(corps).toMatch(/revisionCourante = frais\.revision/);
    expect(corps).toMatch(/recalculer\(frais\.payload\)/);
  });

  it('le repli sans colonne reste inconditionnel ET visible', () => {
    const source = lirePersistence();
    const corps = source.slice(source.indexOf('const ecrireUserRow = async'), source.indexOf('const rechargerUserRow'));

    // Migration non appliquee : on ne doit pas casser les mutations. Mais
    // l'absence de garantie doit etre signalee, pas silencieuse.
    expect(corps).toContain('occSupporte');
    expect(source).toContain('fenetre multi-instance ouverte');
  });

  it('la sonde est exportee pour etre pilotable en test', () => {
    // Sans cela, aucun test ne peut simuler la migration absente ou presente.
    expect(lirePersistence()).toContain('export const setOccSupportePourTest');
  });
});