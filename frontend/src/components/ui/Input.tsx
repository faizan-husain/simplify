import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', label, error, leftIcon, rightIcon, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-text-muted">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <div className="absolute left-3 flex items-center pointer-events-none text-text-muted">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            type={type}
            className={twMerge(
              clsx(
                'w-full h-11 px-3.5 rounded-lg border bg-white text-text text-sm transition-colors',
                'min-h-[44px]', // Touch target
                'border-border hover:border-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
                'disabled:bg-surface disabled:text-text-muted disabled:cursor-not-allowed',
                leftIcon && 'pl-10',
                rightIcon && 'pr-10',
                error && 'border-danger focus:border-danger focus:ring-danger',
                className
              )
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 flex items-center text-text-muted">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <span className="text-xs text-danger font-medium">{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
