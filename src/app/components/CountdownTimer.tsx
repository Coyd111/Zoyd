/**
 * CountdownTimer - compte a rebours avant le debut d'un match.
 *
 * Affiche un decompte HH:MM:SS recalcule chaque seconde et signale la fin
 * du delai via `onComplete`.
 *
 * INVARIANT : la source de verite est `targetDate` (Date ou chaine ISO),
 * pas un etat local decremente : le composant doit se resynchroniser si la
 * cible change.
 * PIEGE : `onComplete` n'est appele qu'une fois (l'intervalle est alors
 * nettoye). Un parent qui passe une fonction inline la voit changer a
 * chaque rendu : ne pas remettre le timer a zero sur ce changement.
 * PIEGE : le rendu depend de la locale et du fuseau du navigateur : un
 * decalage d'heure affiche un compte a rebours faux.
 *
 * Voir aussi : docs/08-frontend.md - section 10 (Inventaire des pages)
 */
import React, { useState, useEffect } from 'react';
import { getCountdownDisplay } from '../../lib/utils';
import { cn } from '../../lib/utils';

interface CountdownTimerProps {
  targetDate: Date | string;
  className?: string;
  onComplete?: () => void;
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({ targetDate, className, onComplete }) => {
  const [timeLeft, setTimeLeft] = useState(getCountdownDisplay(targetDate));

  useEffect(() => {
    const interval = setInterval(() => {
      const display = getCountdownDisplay(targetDate);
      setTimeLeft(display);

      if (display === '00:00:00' && onComplete) {
        onComplete();
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [targetDate, onComplete]);

  const isUrgent = () => {
    const now = new Date();
    const target = new Date(targetDate);
    const diffMs = target.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours < 1 && diffHours > 0;
  };

  return (
    <div 
      className={cn(
        'font-display font-bold tabular-nums text-2xl',
        isUrgent() ? 'text-zoyd-yellow' : 'text-white',
        className
      )}
    >
      {timeLeft}
    </div>
  );
};

export { CountdownTimer };
