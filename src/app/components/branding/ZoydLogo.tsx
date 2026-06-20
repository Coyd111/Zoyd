import React from 'react';
import { cn } from '../../../lib/utils';

interface ZoydLogoProps {
  className?: string;
  wordmarkClassName?: string;
  /** Alias kept for backward compat — ignored visually */
  markClassName?: string;
  theme?: 'dark' | 'light';
  compact?: boolean;
}

export const ZoydLogo: React.FC<ZoydLogoProps> = ({
  className,
  wordmarkClassName,
  theme = 'dark',
  compact = false,
}) => {
  const wordmarkColor = theme === 'dark' ? 'text-white' : 'text-black';
  const separatorColor = theme === 'dark' ? 'bg-white/15' : 'bg-black/20';
  const taglineColor = 'text-zoyd-yellow';

  return (
    <div className={cn('inline-flex flex-col items-center justify-center leading-none', className)}>
      {/* Wordmark */}
      <span
        className={cn(
          'font-display font-black uppercase italic tracking-tighter block',
          compact ? 'text-[22px]' : 'text-[28px]',
          wordmarkColor,
          wordmarkClassName
        )}
      >
        ZOYD
      </span>
    </div>
  );
};

export default ZoydLogo;
