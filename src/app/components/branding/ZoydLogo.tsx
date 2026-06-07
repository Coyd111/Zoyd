import React, { useId } from 'react';
import { cn } from '../../../lib/utils';

interface ZoydLogoProps {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  showWordmark?: boolean;
  theme?: 'dark' | 'light';
  compact?: boolean;
}


export const ZoydLogo: React.FC<ZoydLogoProps> = ({
  className,
  markClassName,
  wordmarkClassName,
  showWordmark = true,
  theme = 'dark',
  compact = false,
}) => {
  const wordmarkColor = theme === 'dark' ? 'text-white' : 'text-black';
  const accentColor = theme === 'dark' ? 'text-zoyd-yellow' : 'text-zoyd-blue';

  return (
    <div className={cn('inline-flex items-center', compact ? 'gap-2.5' : 'gap-3.5', className)}>

      {showWordmark ? (
        <div className="flex flex-col leading-none">
          <span
            className={cn(
              'font-display font-black uppercase tracking-tight italic',
              compact ? 'text-xl' : 'text-2xl',
              wordmarkColor,
              wordmarkClassName
            )}
          >
            ZOYD
          </span>
          <span
            className={cn(
              'font-mono uppercase tracking-[0.28em]',
              compact ? 'text-[8px]' : 'text-[9px]',
              accentColor
            )}
          >
            PLAY • COMPETE • EARN
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default ZoydLogo;
