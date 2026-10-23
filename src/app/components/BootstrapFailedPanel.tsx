/**
 * BootstrapFailedPanel - etat "chargement impossible" du bootstrap serveur.
 *
 * Appele par les cinq ecrans qui attendent `bootstrapReady` (F2) : wallet,
 * detail de match, hub MJ, classements, profil public. Avant ce composant,
 * un echec de bootstrap laissait ces ecrans sur un squelette A JAMAIS - le
 * joueur ne voyait jamais son solde et concluait que son argent avait
 * disparu. Desormais l'ecran rend un etat explicite avec un bouton
 * "Reessayer" (relance `bootstrapServerState`), pendant que le job de
 * backoff de `useRealtimeHeartbeat` retente de son cote.
 *
 * INVARIANT : ne PAS utiliser ce composant tant que le backoff est en cours
 * (screens ne lisent `bootstrapFailed` que pour choisir entre squelette et
 * panne - la difference est visible, l'utilisateur comprend ce qui se passe).
 *
 * Voir aussi : docs/08-frontend.md - section 6.2 (Le cycle de synchronisation)
 */
import React from 'react';
import { CloudOff } from 'lucide-react';

interface BootstrapFailedPanelProps {
  onRetry: () => void;
  title?: string;
  message?: string;
}

const BootstrapFailedPanel: React.FC<BootstrapFailedPanelProps> = ({
  onRetry,
  title = 'Synchronisation impossible',
  message = "Le serveur n'a pas repondu au chargement initial. Tu n'as rien perdu : reprends ou reessaie dans un instant.",
}) => (
  <div className="min-h-[50vh] flex items-center justify-center px-4 py-12" role="alert">
    <div className="max-w-md text-center">
      <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center text-red-400">
        <CloudOff className="w-7 h-7" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-display font-black uppercase italic tracking-wider text-white mb-3">{title}</h2>
      <p className="text-sm text-white/60 mb-6 leading-relaxed">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="border border-white/20 px-6 py-3 text-[10px] font-display font-black uppercase tracking-[0.2em] text-white hover:bg-white hover:text-black transition-colors touch-target"
      >
        Réessayer
      </button>
    </div>
  </div>
);

export default BootstrapFailedPanel;
