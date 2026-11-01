/**
 * ZoydLogo - le logo ZOYD selon son role.
 *
 * Deux visuels coexistent (separation etablie par la pass logo du
 * 2026-10-26, docs/audit-ux/01-RELECTURE.md - section 4) :
 *  - `logo.png` (940x264) : le wordmark complet - branding a grande
 *    taille (elements heroiques, footer de la landing). ATTENTION : les
 *    lettres OYD sont un contour a fond transparent, lisible seulement
 *    assez grand - jamais sous ~2 rem de haut.
 *  - `logo-192.png` (192x192, le Z seul) : la tuile carree, legible a
 *    TOUTE taille (5,9 ko). Variante `icon`.
 *
 * Arbitrage utilisateur du 2026-11-01 : dans les headers, l'icone EST le
 * logo a utiliser - le wordmark comprime (h-8) rendait des lettres
 * fantomes sur fond noir (Navbar, LandingNav). Le wordmark reste le
 * rendu par defaut du composant (metrical: LoginPage, RegisterPage,
 * ModeSelectionPage, footer landing, rien de ces usages ne bouge).
 *
 * PIEGE : `logo-icon.png` (la tuile en 1024) pese 63 ko - en header,
 * servir `logo-192.png` (meme visuel, 5,9 ko) : le navigateur downscale.
 */
import React from 'react';
import { cn } from '../../../lib/utils';

interface ZoydLogoProps {
  className?: string;
  /** Wordmark reduit (h-8). Sans objet si `icon` est pose. */
  compact?: boolean;
  /** La tuile Z carree (headers). */
  icon?: boolean;
}

export const ZoydLogo: React.FC<ZoydLogoProps> = ({
  className,
  compact = false,
  icon = false,
}) => {
  return (
    <div className={cn('inline-flex items-center justify-center leading-none', className)}>
      {icon ? (
        <img
          src="/logo-192.png"
          alt="ZOYD"
          width={192}
          height={192}
          loading="eager"
          className="h-9 w-9 object-contain"
        />
      ) : (
        <img
          src="/logo.png"
          alt="ZOYD"
          className={cn(
            'object-contain',
            compact ? 'h-8 w-auto' : 'h-10 w-auto'
          )}
        />
      )}
    </div>
  );
};

export default ZoydLogo;
