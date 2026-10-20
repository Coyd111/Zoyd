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
 * la source (voir docs/06-tests.md).
 *
 * Voir aussi : docs/08-frontend.md - section 8 (Le design system)
 */
import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../lib/utils';
import { motion } from 'motion/react';

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
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, animate = true, children, ...props }, ref) => {
    const buttonContent = (
      <button
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        ref={ref}
        {...props}
      >
        {children}
      </button>
    );

    if (animate) {
      return (
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className={fullWidth ? 'w-full' : 'inline-block'}>
          {buttonContent}
        </motion.div>
      );
    }

    return buttonContent;
  }
);

Button.displayName = 'Button';

export { Button, buttonVariants };
