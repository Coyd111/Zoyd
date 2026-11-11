/**
 * chatWindow - fenetrage de l'affichage des messages d'un canal.
 *
 * Le store conserve jusqu'a 500 messages par canal (`chatStore.ts`). Les
 * rendre tous d'un coup produisait un scroll saccade sur telephone d'entree
 * de gamme (le public vise), et chaque message animee (motion) multiplie le
 * cout de rendu.
 *
 * On rend donc les DERNIERS messages, et on laisse un bouton pour remonter
 * dans l'historique.
 *
 * INVARIANT : la fenetre rend les messages les PLUS RECENTS (fin du tableau),
 *   pas les plus anciens. L'ordre du tableau est chronologique croissant
 *   (`sortMessages`), donc la fin = le plus recent.
 * INVARIANT : `selectVisibleMessages` ne mute jamais l'entree : le tableau
 *   d'origine reste intact (le store le partage avec d'autres ecrans).
 * PIEGE : le store borne a 500, mais la fenetre par defaut est plus petite
 *   (80). Les deux plafonds sont DIFFERENTS et complementaires : le store
 *   borne la MEMOIRE, la fenetre borne le RENDU.
 */

export const FENETRE_MESSAGES = 80;

/**
 * Nombre de messages a RENDRE, a partir de la fin du tableau.
 *
 * @param {unknown[]} messages messages du canal, du plus ancien au plus recent
 * @param {number} [limite] taille de la fenetre
 * @returns {unknown[]} sous-tableau des derniers messages (la meme reference
 *   si rien n'est masque, pour ne pas casser les comparaisons de reference)
 */
export const selectVisibleMessages = <T,>(messages: T[], limite: number = FENETRE_MESSAGES): T[] => {
  if (!Array.isArray(messages)) return [];
  const taille = Number.isFinite(limite) && limite > 0 ? Math.floor(limite) : FENETRE_MESSAGES;
  if (messages.length <= taille) return messages;
  return messages.slice(messages.length - taille);
};

/**
 * Nombre de messages MASKES par la fenetre.
 *
 * C'est ce nombre qui est annonce au joueur (« Voir les N messages plus
 * anciens ») : il doit correspondre exactement a ce que le bouton fera
 * apparaitre.
 */
export const countHiddenMessages = <T,>(
  messages: T[],
  limite: number = FENETRE_MESSAGES,
): number => {
  if (!Array.isArray(messages)) return 0;
  const taille = Number.isFinite(limite) && limite > 0 ? Math.floor(limite) : FENETRE_MESSAGES;
  return Math.max(0, messages.length - taille);
};
