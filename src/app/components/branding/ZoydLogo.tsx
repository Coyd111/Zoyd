import React from 'react';
import { cn } from '../../../lib/utils';

interface ZoydLogoProps {
  className?: string;
  wordmarkClassName?: string;
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
  const accentColor = theme === 'dark' ? 'text-zoyd-yellow' : 'text-zoyd-blue';

  return (
    <div className={cn('inline-flex flex-col leading-none items-center justify-center', className)}>
      <span
        className={cn(
          'font-display font-black uppercase tracking-tight italic',
          compact ? 'text-2xl' : 'text-3xl',
          wordmarkColor,
          wordmarkClassName
        )}
      >
        ZOYD
      </span>
      <span
        className={cn(
          'font-mono uppercase tracking-[0.28em] mt-1 text-center',
          compact ? 'text-[8px]' : 'text-[10px]',
          accentColor
        )}
      >
        PLAY • COMPETE • EARN
      </span>
    </div>
  );
};

export default ZoydLogo;
