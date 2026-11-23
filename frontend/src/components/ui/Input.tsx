import React, { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Eye, EyeOff } from 'lucide-react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  hint?: string;
  disablePasswordToggle?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type = 'text',
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      disablePasswordToggle = false,
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined);
    const isPassword = type === 'password';
    const [showPassword, setShowPassword] = useState(false);

    const actualType = isPassword ? (showPassword ? 'text' : 'password') : type;

    const passwordToggle = isPassword && !disablePasswordToggle ? (
      <button
        type="button"
        onClick={() => setShowPassword((prev) => !prev)}
        tabIndex={-1}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        title={showPassword ? 'Hide password' : 'Show password'}
        className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none cursor-pointer flex items-center justify-center select-none"
      >
        {showPassword ? (
          <EyeOff className="w-4 h-4 text-slate-600" />
        ) : (
          <Eye className="w-4 h-4 text-slate-400" />
        )}
      </button>
    ) : null;

    const effectiveRightIcon = rightIcon !== undefined ? rightIcon : passwordToggle;

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
            type={actualType}
            className={twMerge(
              clsx(
                'w-full h-[42px] min-h-[44px] sm:min-h-[42px] px-3.5 rounded-control border bg-white text-text text-[14px] transition-all',
                'border-border placeholder:text-placeholder hover:border-slate-300',
                'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
                'disabled:bg-surface disabled:text-text-muted disabled:cursor-not-allowed',
                leftIcon && 'pl-10',
                effectiveRightIcon && 'pr-10',
                error && 'border-danger focus:border-danger focus:ring-danger/15',
                className
              )
            )}
            {...props}
          />
          {effectiveRightIcon && (
            <div className="absolute right-3 inset-y-0 flex items-center z-10">
              {effectiveRightIcon}
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

