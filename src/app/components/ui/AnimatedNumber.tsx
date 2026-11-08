/**
 * AnimatedNumber - compteur animé par spring (soldes, cagnotte, stats).
 *
 * Un changement de solde qui saute d'une frame à l'autre se lit comme
 * un bug pour un joueur qui suit son argent. Ce composant fait glisser
 * la valeur vers sa cible par ressort (120/20 : rapide, sans rebond).
 * La valeur affichée reste une chaîne formatée par le parent
 * (`formatZC`, seuil « 1k »...) : le spring ne connaît que des nombres.
 *
 * Le texte est publié via `useMotionValueEvent` (état React) plutôt
 * qu'en enfant MotionValue direct : selon la version de motion, un
 * MotionValue n'est pas un `ReactNode` — passer par l'état reste
 * lisible et version-proof.
 *
 * `MotionConfig reducedMotion="user"` (App.tsx) désactive déjà les
 * transforms ; le spring reste, mais la transition doit rester
 * perceptible — ne pas forcer le snap ici.
 */
import React, { useEffect, useState } from 'react';
import { useMotionValue, useSpring, useMotionValueEvent } from 'motion/react';

interface AnimatedNumberProps {
  value: number;
  format?: (v: number) => string;
  className?: string;
}

const AnimatedNumber: React.FC<AnimatedNumberProps> = ({ value, format, className }) => {
  const motionValue = useMotionValue(value);
  const spring = useSpring(motionValue, { stiffness: 120, damping: 20 });
  const [text, setText] = useState(() => (format ? format(value) : String(Math.round(value))));

  useMotionValueEvent(spring, 'change', (v) => {
    setText(format ? format(v) : String(Math.round(v)));
  });

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  return <span className={className}>{text}</span>;
};

export { AnimatedNumber };
export default AnimatedNumber;
