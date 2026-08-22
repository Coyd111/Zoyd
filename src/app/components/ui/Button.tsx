import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../lib/utils';
import { motion } from 'motion/react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-display font-bold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary: 'bg-zoyd-yellow text-zoyd-black hover:bg-zoyd-yellow/90',
        secondary: 'bg-white/5 text-white border border-white/20 hover:bg-white/10 hover:border-zoyd-yellow',
        ghost: 'bg-transparent text-white hover:bg-white/5',
        danger: 'bg-transparent text-white border border-white/20 hover:bg-white/5 hover:border-red-500',
      },
      size: {
        sm: 'px-4 py-2 text-sm',
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
