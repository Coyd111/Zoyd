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

const sparkPath = 'M0 0h7M3.5-3.5v7M1 1l5-5M1-1l5 5';

export const ZoydLogo: React.FC<ZoydLogoProps> = ({
  className,
  markClassName,
  wordmarkClassName,
  showWordmark = true,
  theme = 'dark',
  compact = false,
}) => {
  const gradientId = useId();
  const glowId = useId();
  const wordmarkColor = theme === 'dark' ? 'text-white' : 'text-black';
  const accentColor = theme === 'dark' ? 'text-zoyd-yellow' : 'text-zoyd-blue';

  return (
    <div className={cn('inline-flex items-center', compact ? 'gap-2.5' : 'gap-3.5', className)}>
      <svg
        viewBox="0 0 96 96"
        aria-hidden="true"
        className={cn(compact ? 'h-8 w-8' : 'h-10 w-10', markClassName)}
      >
        <defs>
          <linearGradient id={gradientId} x1="10%" y1="5%" x2="90%" y2="95%">
            <stop offset="0%" stopColor="#FFE351" />
            <stop offset="55%" stopColor="#FFA420" />
            <stop offset="100%" stopColor="#FFFFFF" />
          </linearGradient>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M18 20H70L28 76H78"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="8.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${glowId})`}
        />

        <g stroke="#FFF7CC" strokeWidth="2" strokeLinecap="round" opacity="0.9">
          <path d={sparkPath} transform="translate(70 20)" />
          <path d={sparkPath} transform="translate(28 76)" />
        </g>

        <g transform="translate(78 76) rotate(-12)">
          <rect x="-10" y="-3.8" width="14" height="7.6" rx="3.8" fill="#FFF8D7" />
          <path d="M4 -3.8L14 0 4 3.8Z" fill="#FFB21F" />
        </g>
      </svg>

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
