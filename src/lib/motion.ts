/**
 * motion.ts - tokens et variantes partagés pour `motion/react`.
 *
 * Avant ce module, les durées vivaient en dur dans chaque écran
 * (0.2 ici, 0.45 ailleurs, 0.6 ailleurs) : deux éléments côte à côte
 * n'avaient pas la même inertie. Les transitions se sentaient
 * incohérentes — et sans point unique pour les régler.
 *
 * Tous les tokens restent dans `transform + opacity` (compositeur GPU),
 * jamais de `width`/`height`/`top` animés (reflow à chaque frame).
 * `MotionConfig reducedMotion: 'user'` (App.tsx) coupe déjà les
 * transforms ; ces variantes gardent donc les seules valeurs utiles.
 */
import type { Variants, Transition } from 'motion/react';

/** Durées partagées : micro-interaction, entrée d'élément, page. */
export const MOTION_DURATION = {
  fast: 0.18,
  base: 0.28,
  slow: 0.45,
  stagger: 0.06,
} as const;

/** Courbe d'accélération : sortie rapide, atterrissage doux (ease-out expo). */
export const MOTION_EASE = [0.22, 1, 0.36, 1] as const;

/** Spring tactile pour les boutons (survol / appui). */
export const MOTION_SPRING: Transition = { type: 'spring', stiffness: 400, damping: 24 };

/** Entrée d'un élément : fondu + montée de 12 px. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION_DURATION.base, ease: [...MOTION_EASE] },
  },
};

/** Fondu simple. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: MOTION_DURATION.fast, ease: [...MOTION_EASE] } },
};

/** Conteneur en stagger : ses enfants `staggerItem` entrent en cascade. */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: MOTION_DURATION.stagger } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION_DURATION.base, ease: [...MOTION_EASE] },
  },
};

/**
 * Transition de page : montée courte, jamais latérale (le scroll
 * horizontal est interdit dans AppLayout). Montée au-delà de ~16 px
 * sur mobile se lit comme un saut — 12 px reste dans le confort.
 */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: MOTION_DURATION.base, ease: [...MOTION_EASE] } },
  exit: { opacity: 0, y: -6, transition: { duration: MOTION_DURATION.fast, ease: [...MOTION_EASE] } },
};

export const pageTransitionProps = {
  initial: 'hidden' as const,
  animate: 'show' as const,
  exit: 'exit' as const,
  transition: { duration: MOTION_DURATION.base, ease: [...MOTION_EASE] } as Transition,
};
