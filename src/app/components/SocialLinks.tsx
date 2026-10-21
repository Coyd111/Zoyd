/**
 * src/app/components/SocialLinks.tsx - Bloc de liens vers les reseaux.
 *
 * La liste vient de `src/lib/social.ts` : une seule source, donc un lien
 * change une fois et partout.
 *
 * Style : le design system (noir, blanc, jaune, bleu). Les ICONES sont les
 * logos de marque officiels — c'est ce qui rend le reseau identifiable d'un
 * coup d'oeil — mais leur COULEUR suit le site, pas la marque.
 *
 * Accessibilite : chaque lien a un `aria-label` explicite (le logo seul ne
 * dit rien a un lecteur d'ecran), et les icones sont `aria-hidden`.
 */
import React from 'react';
import { SOCIAL_LINKS, type SocialNetwork } from '../../lib/social';
import { SOCIAL_ICONS } from './branding/SocialIcons';

export const SocialLinks: React.FC<{
  /** Taille des icones, en classes Tailwind. */
  className?: string;
  /** Un libelle au-dessus du bloc (pour les lecteurs d'ecran). */
  label?: string;
}> = ({ className = 'h-5 w-5', label = 'Reseaux sociaux' }) => (
  <nav aria-label={label} className="flex items-center gap-3">
    {SOCIAL_LINKS.map((lien) => {
      const Icone = SOCIAL_ICONS[lien.id as SocialNetwork];
      return (
        <a
          key={lien.id}
          href={lien.href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={lien.alt}
          title={lien.label}
          className="inline-flex h-9 w-9 items-center justify-center border border-white/15 text-white/70 transition-colors hover:border-zoyd-yellow hover:text-zoyd-yellow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zoyd-yellow"
        >
          <Icone className={className} />
        </a>
      );
    })}
  </nav>
);
