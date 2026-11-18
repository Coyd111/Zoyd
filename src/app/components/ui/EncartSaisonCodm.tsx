import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { SAISON_CODM } from '../../data/codmNews';
import { cn } from '../../../lib/utils';

/**
 * EncartSaisonCodm - le contexte CODM de la saison en cours.
 *
 * Pourquoi un composant unique
 * ---------------------------
 * Le numero de saison, son nom et ses nouveautes etaient repetes a la main
 * dans les ecrans, ou pas affiches du tout. Un seul composant consomme
 * `SAISON_CODM` : le jour ou la saison change, le module change et les
 * ecrans suivent.
 *
 * INVARIANT : aucun numero, nom de saison ou nom de carte n est ecrit ici.
 * Le verrou `src/lib/codm-news.test.ts` refuse un litteral dans ce fichier,
 * parce qu il serait alors affiche sur tous les ecrans a la fois.
 * PIEGE : ce composant peut vivre sur un ecran PUBLIC (`/mode`). Le lien
 * /infos exige une session : `avecLien={false}` sur un ecran public, sinon
 * le visiteur clique « Veille CODM » et atterrit sur la connexion.
 */
export const EncartSaisonCodm = ({
  className = '',
  avecLien = true,
}: {
  className?: string;
  avecLien?: boolean;
}) => (
  <aside
    aria-label="Saison Call of Duty: Mobile en cours"
    className={cn(
      'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-3.5 py-2 sm:px-4',
      className,
    )}
  >
    <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-mono text-[10px] font-black uppercase tracking-[0.3em] text-zoyd-yellow">
        Saison {SAISON_CODM.numero}
      </span>
      <span className="font-display text-sm font-black uppercase italic tracking-wide text-white">
        {SAISON_CODM.nom}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
        {SAISON_CODM.pointsCles.join(' · ')}
      </span>
    </p>
    {avecLien ? (
      <Link
        to="/infos"
        aria-label="Voir la veille CODM vérifiée"
        className="inline-flex min-h-11 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/70 transition-colors hover:text-zoyd-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zoyd-yellow"
      >
        Veille CODM
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    ) : null}
  </aside>
);

export default EncartSaisonCodm;
