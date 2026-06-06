import React from 'react';
import { cn } from '../../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, helperText, ...props }, ref) => {
    return (
      <div className="w-full space-y-2">
        {label && (
          <label className="block text-sm font-medium text-zoyd-white">
            {label}
          </label>
        )}
        <input
          type={type}
          className={cn(
            'flex w-full rounded-lg border bg-zoyd-white-5 px-4 py-3 text-base text-zoyd-white',
            'border-zoyd-white-20 placeholder:text-zoyd-white-30',
            'focus:outline-none focus:ring-2 focus:ring-zoyd-yellow focus:border-transparent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-all duration-200',
            error && 'border-red-500 focus:ring-red-500',
            className
          )}
          ref={ref}
          {...props}
        />
        {helperText && !error && (
          <p className="text-xs text-zoyd-white-60">{helperText}</p>
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
