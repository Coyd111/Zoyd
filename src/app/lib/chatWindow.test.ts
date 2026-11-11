import { describe, it, expect } from 'vitest';
import {
  FENETRE_MESSAGES,
  selectVisibleMessages,
  countHiddenMessages,
} from './chatWindow';

/**
 * Fenetrage de l'affichage des messages (audit front — rendu non borne).
 *
 * Le constat
 * ----------
 * Le store conserve jusqu'a 500 messages par canal (`chatStore.ts`,
 * `MAX_MESSAGES`). `ChatPage` les rendait TOUS : `currentMessages.map(...)`.
 * Sur un canal charge (500 messages), le DOM contenait 500 noeuds de message,
 * chacun anime par `motion` — le scroll saccadait sur telephone d'entree de
 * gamme et le rendu coutait cher, sans que le joueur y gagne quoi que ce
 * soit : l'historique se parcourt par defilement, pas d'un bloc.
 *
 * Le correctif
 * ------------
 * On rend les DERNIERS messages (fenetre de 80) et un bouton remonte dans
 * l'historique. La logique pure est ici, donc elle est testee SANS DOM :
 * `vitest.config.mjs` impose `environment: 'node'` (pas de jsdom dans les
 * dependances), et c'est deliberé — les stores client sont du zustand pur.
 *
 * Ce que le test garantit
 * -----------------------
 * 1. La fenetre rend les messages les PLUS RECENTS (les derniers du tableau).
 *    L'ordre du store est chronologique croissant : inverser cet ordre
 *    afficherait les messages anciens en bas et les recents en haut, et le
 *    defilement automatique (`scrollTo(scrollHeight)`) placerait le joueur
 *    sur le PLUS ANCIEN message.
 * 2. La liste d'origine n'est pas mutee.
 * 3. Le nombre de messages masques correspond exactement a ce que le bouton
 *    « Voir les N messages plus anciens » fera apparaitre.
 * 4. Charger plus ancien augmente la fenetre, sans jamais la tronquer.
 */

const messages = (n: number) => Array.from({ length: n }, (_, i) => `MSG-${i}`);

describe('Fenetrage du chat', () => {
  it('rend les DERNIERS messages, pas les premiers', () => {
    const liste = messages(500);
    const visibles = selectVisibleMessages(liste, 80);

    expect(visibles).toHaveLength(80);
    expect(visibles[0], 'le premier rendu est le plus ancien des 80 affiches').toBe('MSG-420');
    expect(visibles[79], 'le dernier rendu est le message le plus recent').toBe('MSG-499');
    expect(visibles).not.toContain('MSG-0');
  });

  it('rend tout quand la liste tient dans la fenetre', () => {
    const liste = messages(12);
    expect(selectVisibleMessages(liste, 80)).toHaveLength(12);
  });

  it('ne mute pas la liste d origine', () => {
    const liste = messages(200);
    const copie = [...liste];
    selectVisibleMessages(liste, 80);
    expect(liste).toEqual(copie);
  });

  it('annonce exactement le nombre de messages masques', () => {
    const liste = messages(500);
    expect(countHiddenMessages(liste, 80)).toBe(420);
    // Le nombre annonce doit correspondre a ce que le bouton fera
    // apparaitre : fenetre elargie de 80 -> 420 - 80 = 340 masques.
    expect(countHiddenMessages(liste, 160)).toBe(340);
    expect(countHiddenMessages(liste, 500)).toBe(0);
  });

  it('elargir la fenetre fait apparaitre les messages anciens', () => {
    const liste = messages(500);
    const premiere = selectVisibleMessages(liste, 80);
    const elargie = selectVisibleMessages(liste, 160);

    expect(elargie).toHaveLength(160);
    expect(elargie[0]).toBe('MSG-340');
    // Les 80 deja affiches sont toujours la fin de la liste : elargir ne
    // doit pas faire disparaitre les messages recents.
    expect(elargie.slice(-80)).toEqual(premiere);
  });

  it('la fenetre par defaut est de 80 messages', () => {
    expect(FENETRE_MESSAGES).toBe(80);
    expect(selectVisibleMessages(messages(500))).toHaveLength(80);
  });

  it('tolerent une liste vide ou invalide', () => {
    expect(selectVisibleMessages([])).toEqual([]);
    expect(countHiddenMessages([])).toBe(0);
    expect(selectVisibleMessages(undefined as unknown as string[])).toEqual([]);
  });
});
