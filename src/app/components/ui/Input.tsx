import React from 'react';
import { cn } from '../../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, helperText, id: idProp, ...props }, ref) => {
    const autoId = React.useId();
    const inputId = idProp || (label ? autoId : undefined);

    return (
      <div className="w-full space-y-2">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-mono font-black uppercase tracking-widest text-white/50 mb-1">
            {label}
          </label>
        )}
        <input
          id={inputId}
          type={type}
          className={cn(
            'flex w-full border-0 border-b border-white/20 bg-transparent py-3 min-h-[44px] text-base text-white rounded-none',
            'placeholder:text-white/20',
            'focus:outline-none focus:ring-0 focus:border-zoyd-yellow',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-all duration-200 font-display font-black italic',
            error && 'border-red-500',
            className
          )}
          ref={ref}
          {...props}
        />
        {helperText && !error && (
          <p className="text-xs text-white/60">{helperText}</p>
        )}
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
