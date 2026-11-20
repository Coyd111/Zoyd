/**
 * Destination apres connexion (ZD-06, audit production 2026-11-19).
 *
 * INVARIANT : seuls les CHEMINS INTERNES sont acceptes. Un `from` externe
 * (« https://… », « //… », « /\… ») est ignore : sans ce filtre, la page de
 * connexion deviendrait une redirection ouverte utilisable en phishing.
 * PIEGE : renvoyer vers /auth/login apres une connexion reussie boucle sur
 * l'ecran de connexion. Le repli est l'accueil.
 */
export const getPostLoginPath = (from: unknown, fallback = '/'): string => {
  if (typeof from !== 'string' || from.length === 0) return fallback;
  if (!from.startsWith('/') || from.startsWith('//')) return fallback;
  if (from.includes('\\')) return fallback;
  if (from === '/auth/login' || from.startsWith('/auth/login?') || from.startsWith('/auth/login#')) {
    return fallback;
  }
  return from;
};
