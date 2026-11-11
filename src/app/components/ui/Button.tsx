/**
 * Button - bouton d'action du design system ZOYD.
 *
 * Enveloppe la primitive button avec des variantes `cva` (primary, secondary,
 * ghost, danger) et des tailles (sm, md, lg, xl). Anime le survol et
 * l'appui via motion.
 *
 * INVARIANT : toutes les tailles gardent `min-h-[44px]` : c'est la cible
 * tactile mobile du design system, pas une decoracion.
 * INVARIANT : `disabled` doit rester lisible et non cliquable ; l'animation
 * motion ne doit jamais donner l'illusion d'un bouton actif.
 * PIEGE : l'animation enveloppe le bouton dans un motion.div. Ajouter un
 * `onClick` sur le motion.div au lieu du Button fait perdre le focus et
 * l'accessibilite clavier.
 * PIEGE : les classes viennent de cva ET de cn(). twMerge resout les
 * conflits Tailwind : ne pas reinventer un ordre de classes a la main.
 * PIEGE : une correction de classe se verifie dans le CSS GENERE, pas dans
 * la source.
 */
import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../../lib/utils';
import { motion } from 'motion/react';
import { MOTION_SPRING } from '../../../lib/motion';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-display font-bold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]',
  {
    variants: {
      variant: {
        primary: 'bg-zoyd-yellow text-zoyd-black hover:bg-zoyd-yellow/90',
        secondary: 'bg-white/5 text-white border border-white/20 hover:bg-white/10 hover:border-zoyd-yellow',
        ghost: 'bg-transparent text-white hover:bg-white/5',
        danger: 'bg-transparent text-white border border-white/20 hover:bg-white/5 hover:border-red-500',
      },
      size: {
        sm: 'px-4 py-2 text-sm min-h-[44px]',
        md: 'px-6 py-3 text-base',
        lg: 'px-8 py-4 text-lg',
        xl: 'px-10 py-5 text-xl',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      fullWidth: false,
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  animate?: boolean;
  // React 19 : ref passee comme une prop ordinaire (forwardRef est
  // deprecie depuis 19.0, cf. react.dev/blog/2024/12/05/react-19).
  ref?: React.Ref<HTMLButtonElement>;
}

const Button = ({
  className,
  variant,
  size,
  fullWidth,
  animate = true,
  children,
  ref,
  asChild = false,
  ...props
}: ButtonProps) => {
  // `asChild` est IMPLEMENTE (et non laisse dans `...props`) : declare mais
  // non extrait, il se retrouvait etale sur le `<button>` DOM — un attribut
  // inconnu que React signale, et un `asChild` sans effet.
  //
  // `Slot` (Radix) fusionne les props du Button sur l enfant provided :
  // le style part sur le lien, et le Button cesse d etre un `<button>`.
  const Comp = asChild ? Slot : 'button';
  const buttonContent = (
    <Comp
      className={cn(buttonVariants({ variant, size, fullWidth, className }))}
      ref={ref}
      {...props}
    >
      {children}
    </Comp>
  );

  if (animate) {
    return (
      <motion.div
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={MOTION_SPRING}
        className={cn(fullWidth ? 'w-full' : 'inline-block', 'will-change-transform')}
      >
        {buttonContent}
      </motion.div>
    );
  }

  return buttonContent;
};

export { Button, buttonVariants };
