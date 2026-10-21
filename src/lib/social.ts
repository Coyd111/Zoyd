/**
 * src/lib/social.ts - Les reseaux sociaux de ZOYD. Source unique.
 *
 * Les liens sont ici, et nulle part ailleurs : le pied de page public, le
 * JSON-LD de `index.html` (via une constante injectee a la construction) et
 * les tests lisent la meme source. Un lien change une fois, partout.
 *
 * Deux liens WhatsApp coexistent, et c'est volontaire :
 * - celui-ci est le lien de la COMMUNAUTE (une conversation de groupe) ;
 * - l'assistance 1:1 est dans `src/app/pages/legal/LegalLayout.tsx` (le
 *   numero `wa.me`), pour un joueur qui a un probleme precis.
 *
 * Confondre les deux serait une erreur : l un est un lieu de vie, l autre un
 * service.
 *
 * INVARIANT : aucune URL de suivi. Les liens TikTok et Discord arrives
 * souvent accompagnes de `?is_from_webapp=1&sender_device=pc` ou de
 * `?utm_source=...` : ce sont des parametres de session, pas l adresse du
 * profil. On ne les garde pas — ils se périment, et ils exposent la
 * navigation de l visiteur.
 */

/** Identifiant d'un reseau social de ZOYD. */
export type SocialNetwork = 'discord' | 'tiktok' | 'whatsapp';

export interface SocialLink {
  /** Identifiant du reseau. */
  id: SocialNetwork;
  /** Nom affiche. */
  label: string;
  /** URL de la page publique. */
  href: string;
  /** Texte alternatif de l icone (accessibilite). */
  alt: string;
}

/**
 * Les liens, dans l ordre d affichage.
 *
 * Le TikTok est nettoye des parametres de suivi : l URL du profil est
 * `https://www.tiktok.com/@z.o.y.d`. Le reste de l URL (`is_from_webapp`,
 * `sender_device`) identifie la session qui a produit le clic, pas le profil.
 */
export const SOCIAL_LINKS: readonly SocialLink[] = [
  {
    id: 'discord',
    label: 'Discord',
    href: 'https://discord.gg/wfQCFTsEJk',
    alt: 'Rejoindre la communaute Discord de ZOYD',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    href: 'https://www.tiktok.com/@z.o.y.d',
    alt: 'Suivre ZOYD sur TikTok',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    href: 'https://chat.whatsapp.com/FJ65ueT6BheIG4jlsc4lq0',
    alt: 'Rejoindre le groupe WhatsApp de ZOYD',
  },
] as const;

/**
 * Mots-cles `sameAs` du JSON-LD : c'est ce qui relie le site aux profils
 * pour les moteurs. Utile, gratuit, et invisible pour le visiteur.
 */
export const SOCIAL_SAME_AS: readonly string[] = SOCIAL_LINKS.map((l) => l.href);
