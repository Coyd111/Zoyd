import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-display font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-zoyd-white-10 text-zoyd-white border border-zoyd-white-20',
        yellow: 'bg-zoyd-yellow/10 text-zoyd-yellow border border-zoyd-yellow',
        success: 'bg-zoyd-yellow/10 text-zoyd-yellow border border-zoyd-yellow',
        live: 'bg-zoyd-yellow text-zoyd-black animate-pulse-yellow',
        disabled: 'bg-zoyd-white-5 text-zoyd-white-30 border border-zoyd-white-10',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
