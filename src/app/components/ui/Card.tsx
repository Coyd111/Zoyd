/**
 * Card - conteneur de contenu du design system ZOYD.
 *
 * Famille de sous-composants (Card, CardHeader, CardTitle, CardDescription,
 * CardContent, CardFooter) qui partagent la meme structure et les memes
 * tokens.
 *
 * INVARIANT : les sous-composants se choisissent par convention de nom (CardHeader
 * dans Card), pas par une propriete. Un `CardHeader` hors d'un `Card`
 * n'a pas de sens et perd ses styles.
 * INVARIANT : les classes viennent de cn() (twMerge) : un style passe par
 * className ecrase proprement la variante, sans classe en dur a melanger.
 * PIEGE : une opacite s'ecrit `/50`, pas `-50`. La faute passe le compilateur
 * et le lint : la bordure disparaait silencieusement au survol.
 * PIEGE : ce composant ne doit contenir aucun etat ni appel reseau.
 *
 * Voir aussi : docs/08-frontend.md - section 8 (Le design system)
 */
import React from 'react';
import { cn } from '../../../lib/utils';
import { motion, type MotionProps } from 'motion/react';

type NativeCardProps = React.HTMLAttributes<HTMLDivElement>;
type MotionOverriddenKeys = Extract<keyof NativeCardProps, keyof MotionProps>;

interface CardProps extends Omit<NativeCardProps, MotionOverriddenKeys> {
  children?: React.ReactNode;
  hover?: boolean;
  animate?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, hover = false, animate = false, children, ...props }, ref) => {
    const cardClasses = cn(
      'bg-zoyd-black border border-white/10 p-6 overflow-hidden',
      hover && 'transition-all duration-200 hover:border-zoyd-yellow/50 hover:shadow-lg hover:shadow-zoyd-yellow/10',
      className
    );

    if (animate) {
      return (
        <motion.div
          ref={ref}
          className={cardClasses}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          {...props}
        >
          {children}
        </motion.div>
      );
    }

    return (
      <div ref={ref} className={cardClasses} {...props}>
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 pb-4', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('font-display text-xl font-bold text-white', className)} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-white/60', className)} {...props} />
  )
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('pt-0', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center pt-4', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
