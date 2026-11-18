/**
 * Illustration - le composant unique pour afficher un visuel du site.
 *
 * PIEGE : un nom INCONNU du catalogue n a pas d URL. On rend alors le
 * REPLI graphique — jamais une image cassee : une image cassee, c est
 * une icone de navigation brisee au milieu de l ecran. Un fichier
 * declare mais absent du disque est attrape par le verrou du catalogue,
 * et une image qui echoue au chargement est mesuree par la sonde UI.
 *
 * PIEGE : par defaut, l image est DECORATIVE (`alt=""`). Un visuel
 * decoratif n est pas annonce par le lecteur d ecran ; un visuel qui
 * porte du sens doit passer un `alt` explicite.
 */
import React from 'react';
import { cn } from '../../../lib/utils';
import { urlIllustration } from '../../lib/illustrations';

export interface IllustrationProps {
  /** Le nom du visuel dans le catalogue (`src/app/data/illustrations.json`). */
  nom: string;
  /** Le texte alternatif. Vide par defaut : le visuel est decoratif. */
  alt?: string;
  /** Les classes du conteneur. */
  className?: string;
  /** Le recadrage (`object-position`), pour un visuel qui ne remplit pas la boite. */
  position?: string;
  /** Chargement immediat (au-dessus de la ligne de flottaison). */
  priorite?: boolean;
  /** L opacite du visuel (les fonds de ZOYD sont tres discrets).
   *  PIEGE : laisse a undefined si le visuel n en a pas besoin — un
   *  `style` inline-ecrase la classe d opacite du `className`. */
  opacite?: number;
}

const Illustration = ({
  nom,
  alt = '',
  className,
  position = 'center',
  priorite = false,
  opacite,
}: IllustrationProps) => {
  const url = urlIllustration(nom);

  // Repli graphique : la grille du site. Le visuel manque, l ecran ne
  // se casse pas.
  if (!url) {
    return (
      <div
        aria-hidden="true"
        className={cn('tactical-grid bg-zoyd-surface/30', className)}
      />
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      loading={priorite ? 'eager' : 'lazy'}
      decoding="async"
      style={{
        objectPosition: position,
        ...(opacite === undefined ? {} : { opacity: opacite / 100 }),
      }}
      className={cn('h-full w-full object-cover', className)}
    />
  );
};

export default React.memo(Illustration);
