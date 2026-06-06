import React, { useRef, useEffect } from 'react';

interface ProgressBarProps {
  value: number; // 0-100
  className?: string;
  barClassName?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, className = '', barClassName = '' }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.width = `${Math.max(0, Math.min(100, value))}%`;
    }
  }, [value]);

  return (
    <div className={`w-full bg-white/5 h-2 overflow-hidden ${className}`}>
      <div
        ref={ref}
        className={`h-full transition-all duration-1000 ${barClassName}`}
      />
    </div>
  );
};
