import React, { useState, useEffect } from 'react';
import { getCountdownDisplay } from '../../lib/utils';
import { cn } from '../../lib/utils';

interface CountdownTimerProps {
  targetDate: Date | string;
  className?: string;
  onComplete?: () => void;
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({ targetDate, className, onComplete }) => {
  const [timeLeft, setTimeLeft] = useState(getCountdownDisplay(targetDate));

  useEffect(() => {
    const interval = setInterval(() => {
      const display = getCountdownDisplay(targetDate);
      setTimeLeft(display);

      if (display === '00:00:00' && onComplete) {
        onComplete();
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [targetDate, onComplete]);

  const isUrgent = () => {
    const now = new Date();
    const target = new Date(targetDate);
    const diffMs = target.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours < 1 && diffHours > 0;
  };

  return (
    <div 
      className={cn(
        'font-display font-bold tabular-nums text-2xl',
        isUrgent() ? 'text-zoyd-yellow' : 'text-white',
        className
      )}
    >
      {timeLeft}
    </div>
  );
};

export { CountdownTimer };
