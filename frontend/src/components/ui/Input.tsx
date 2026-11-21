import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  hint?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', label, error, hint, leftIcon, rightIcon, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined);

    return (
      <div className="w-full flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-[13px] font-medium text-text-muted select-none">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <div className="absolute left-3.5 flex items-center pointer-events-none text-text-muted">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            type={type}
            className={twMerge(
              clsx(
                'w-full h-[42px] min-h-[44px] sm:min-h-[42px] px-3.5 rounded-control border bg-white text-text text-[14px] transition-all',
                'border-border placeholder:text-placeholder hover:border-slate-300',
                'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
                'disabled:bg-surface disabled:text-text-muted disabled:cursor-not-allowed',
                leftIcon && 'pl-10',
                rightIcon && 'pr-10',
                error && 'border-danger focus:border-danger focus:ring-danger/15',
                className
              )
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 inset-y-0 flex items-center text-text-muted z-10">
              {rightIcon}
            </div>
          )}
        </div>
        {error ? (
          <span className="text-[12.5px] text-danger font-normal">{error}</span>
        ) : hint ? (
          <span className="text-[12px] text-text-muted">{hint}</span>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';

