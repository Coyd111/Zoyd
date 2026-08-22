import React from 'react';
import { cn } from '../../../lib/utils';

interface ZoydLogoProps {
  className?: string;
  compact?: boolean;
}

export const ZoydLogo: React.FC<ZoydLogoProps> = ({
  className,
  compact = false,
}) => {
  return (
    <div className={cn('inline-flex items-center justify-center leading-none', className)}>
      <img
        src="/logo icone.png"
        alt="ZOYD"
        className={cn(
          'object-contain',
          compact ? 'h-8 w-auto' : 'h-10 w-auto'
        )}
      />
    </div>
  );
};

export default ZoydLogo;
