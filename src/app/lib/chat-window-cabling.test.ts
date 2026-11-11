import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Le fenetrage du chat est APPLIQUE (audit front — rendu non borne).
 *
 * Pourquoi ce fichier separe de `chatWindow.test.ts`
 * --------------------------------------------------
 * `chatWindow.test.ts` prouve la LOGIQUE (quels messages sont visibles).
 * Il ne prouve pas que l'ecran l'utilise. Or c'est precisement le piege :
 * la logique etait correcte, mais `ChatPage` rendait encore
 * `currentMessages.map(...)` — les 500 messages. Le helper etait importe,
 * teste, et parfaitement inutile.
 *
 * C'est le meme piege que `asChild` (audit front) : un composant existe, il
 * est correct, et il n'est pas utilise. Aucun test de comportement ne
 * l'aurait vu : il fallait lire le RENDU.
 *
 * Le test lit donc la source et verifie deux choses :
 *   1. le rendu itere sur la fenetre visible, pas sur la liste complete ;
 *   2. le bouton de chargement des messages plus anciens existe ET est
 *      conditionne au nombre de messages masques (sinon il apparaitrait
 *      pour rien, sur un canal vide).
 */

const source = readFileSync(resolve('src/app/pages/ChatPage.tsx'), 'utf8');

describe('Fenetrage du chat — cablage dans l ecran', () => {
  it('le rendu itere sur la fenetre visible, pas sur tous les messages', () => {
    // Le rendu des messages : on cherche l'iteration qui produit les
    // `<motion.div>` de message. Elle doit porter `messagesVisibles`.
    const iteration = source.match(/\{(messagesVisibles|currentMessages)\.map\(/);
    expect(iteration, 'le rendu des messages doit etre lisible').not.toBeNull();
    expect(
      iteration?.[1],
      'le rendu doit iterer sur `messagesVisibles` (fenetre), pas sur `currentMessages` (liste complete)',
    ).toBe('messagesVisibles');

    // Et le calcul de la fenetre ne doit pas reintroduire la liste complete.
    expect(source).not.toMatch(/currentMessages\.slice\(/);
  });

  it('le bouton des messages plus anciens existe et est conditionne', () => {
    expect(source, 'le bouton de chargement des messages plus anciens doit exister')
      .toMatch(/chargerMessagesAnciens/);
    expect(source, 'le bouton doit etre conditionne aux messages masques')
      .toMatch(/messagesMasques\s*>\s*0/);
    // Le libelle annonce le nombre reellement masque : le joueur doit savoir
    // ce qu'il va faire apparaitre.
    expect(source).toMatch(/messagesMasques\}\s*message/);
  });

  it('la fenetre se reinitialise au changement de canal', () => {
    // Sans cette remise a zero, un canal ou l on avait charge 500 messages
    // laissait le suivant avec la meme fenetre elargie : le nouveau canal
    // s'affichait avec un scroll deja positionne au milieu de nulle part.
    expect(source).toMatch(/setMessagesAffiches\(FENETRE_MESSAGES\)[\s\S]{0,120}\[activeChannelId\]/);
  });
});
