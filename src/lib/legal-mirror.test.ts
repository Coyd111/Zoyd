import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Les CGU doivent dire la MEME chose que le serveur.
 *
 * Le trou que ce fichier comble
 * ----------------------------
 * Les Conditions d'utilisation sont un CONTENU JURIDIQUE fige dans un
 * composant React : `<strong>150 ZC</strong>`, `<strong>2 %</strong>`,
 * `<strong>50 000 ZC</strong>`... Les valeurs REELLES vivent dans
 * `server/wallet-engine.mjs` (`MIN_WITHDRAWAL_ZC`,
 * `WITHDRAWAL_FEE_RATE`, `MAX_WITHDRAWAL_DAILY_ZC`).
 *
 * Les deux copies n etaient liees par RIEN. Le jour ou le serveur change
 * un seuil, les CGU continueraient d annoncer l ancien : un document
 * juridique faux, et un joueur qui lit « minimum 150 ZC » avant de decouvrir
 * que le minimum est 200.
 *
 * Le test lit les constantes du serveur et verifie que les CGU les
 * reprennent. Il ne remplace pas la relecture juridique : il garantit
 * que les chiffres affiches SONT ceux appliques.
 *
 * PIEGE : le taux ZC -> FCFA passe par `ZC_TO_FCFA` (le front) et son
 * miroir serveur. Les CGU l utilsent deja (corrige par l audit de
 * redaction) : ce test verifie qu il reste utilise, pour qu on ne
 * remette pas un « 10 FCFA » en clair.
 */

const serverWallet = readFileSync(resolve('server/wallet-engine.mjs'), 'utf8');
const serverUtils = readFileSync(resolve('server/utils.mjs'), 'utf8');
const serverMatch = readFileSync(resolve('server/match-engine.mjs'), 'utf8');
const serverTournament = readFileSync(resolve('server/tournament-engine.mjs'), 'utf8');
const frontUtils = readFileSync(resolve('src/lib/utils.ts'), 'utf8');

/**
 * PIEGE : `toLocaleString('fr-FR')` utilise l espace fine insecable
 * (U+202F), pas l espace ordinaire. Les CGU, elles, ecrivent « 1 500 »
 * avec une espace ordinaire. On normalise les deux cotes, sinon la
 * comparaison echouerait sur une difference invisible.
 */
const normaliserEspaces = (texte: string): string => texte.replace(/[\u202f\u00a0]/g, ' ');
const nombreFr = (valeur: number): string => normaliserEspaces(valeur.toLocaleString('fr-FR'));

/**
 * Le CONTENU des CGU, sans les commentaires.
 *
 * PIEGE : le fichier des CGU explique dans un commentaire pourquoi le
 * taux ne doit pas etre ecrit en clair - et cite donc « 1 ZC = 10 FCFA ».
 * Tester le fichier brut confondrait l explication avec le contenu
 * affiche : le test doit porter sur ce que le JOUEUR LIT.
 */
const cgu = normaliserEspaces(
  readFileSync(resolve('src/app/pages/legal/ConditionsPage.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' '),
);

/** La valeur d une constante du serveur. */
const constante = (source: string, nom: string): number => {
  const m = new RegExp(`const ${nom}\\s*=\\s*([0-9_]+(?:\\.[0-9]+)?)`).exec(source);
  if (!m) throw new Error(`constante introuvable : ${nom}`);
  return Number(m[1].replace(/_/g, ''));
};

describe('Les CGU doivent dire la meme chose que le serveur', () => {
  it('le taux ZC -> FCFA passe par la constante, pas en clair', () => {
    const front = /export const ZC_TO_FCFA = ([0-9]+)/.exec(frontUtils);
    const serveur = /const ZC_TO_FCFA = ([0-9]+)/.exec(serverUtils);
    expect(front, 'la constante du front doit exister').not.toBeNull();
    expect(serveur, 'le miroir serveur doit exister').not.toBeNull();
    // Les deux constantes valent la MEME chose.
    expect(serveur![1]).toBe(front![1]);
    // Les CGU n'ecrivent plus le taux en clair.
    expect(cgu).not.toMatch(/1 ZC = 10 FCFA/);
    expect(cgu).toContain('1 ZC = {ZC_TO_FCFA} FCFA');
  });

  it('le retrait minimum des CGU est celui du serveur', () => {
    const minimum = constante(serverWallet, 'MIN_WITHDRAWAL_ZC');
    expect(cgu).toContain(`minimum : ${nombreFr(minimum)} ZC`);
    // ... et son equivalent en FCFA, calcule depuis la meme constante.
    const taux = Number(/export const ZC_TO_FCFA = ([0-9]+)/.exec(frontUtils)![1]);
    expect(cgu).toContain(`(${nombreFr(minimum * taux)} FCFA)`);
  });

  it('la commission ZOYD des CGU est celle du serveur', () => {
    const taux = constante(serverWallet, 'WITHDRAWAL_FEE_RATE');
    const pourcent = Math.round(taux * 10000) / 100;
    expect(cgu).toContain(`commission ZOYD : ${pourcent} %`);
  });

  it('le plafond quotidien des CGU est celui du serveur', () => {
    const plafond = constante(serverWallet, 'MAX_WITHDRAWAL_DAILY_ZC');
    expect(cgu).toContain(`plafond quotidien de ${nombreFr(plafond)} ZC`);
  });

  it('le maximum par retrait des CGU est celui du serveur', () => {
    const maximum = constante(serverWallet, 'MAX_WITHDRAWAL_AMOUNT_ZC');
    const taux = Number(/export const ZC_TO_FCFA = ([0-9]+)/.exec(frontUtils)![1]);
    expect(cgu).toContain(`${nombreFr(maximum * taux)} FCFA par retrait`);
  });

  it('la commission d arbitre de tournoi des CGU est celle du moteur', () => {
    // `buildPayout` : deux arbitres -> 10 %, sinon 5 %.
    const m = /const arbiterRate = arbitersNeeded === 2 \? ([0-9.]+) : ([0-9.]+)/.exec(serverTournament);
    expect(m, 'le taux d arbitrage du tournoi doit etre explicite').not.toBeNull();
    const deux = Math.round(Number(m![1]) * 100);
    const un = Math.round(Number(m![2]) * 100);
    expect(cgu).toContain(`<strong className="text-white">${un} %</strong>`);
    expect(cgu).toContain(`<strong className="text-white">${deux} %</strong>`);
  });

  it('la commission d arbitre de match des CGU est celle du moteur', () => {
    const m = /const ARBITER_FEE_RATE = ([0-9.]+)/.exec(serverMatch);
    expect(m, 'le taux d arbitrage du match doit etre explicite').not.toBeNull();
    const pourcent = Math.round(Number(m![1]) * 100);
    expect(cgu).toContain(`<strong className="text-white">${pourcent} %</strong>`);
  });
});
