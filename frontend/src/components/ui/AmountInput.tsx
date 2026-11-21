import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface AmountInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string;
  error?: string;
  value: string | number;
  onChange: (val: string) => void;
  hint?: string;
}

export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  ({ className, label, error, hint, value, onChange, onFocus, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Allow only numbers and at most one decimal point
      let val = e.target.value.replace(/[^0-9.]/g, '');
      const parts = val.split('.');
      if (parts.length > 2) {
        val = parts[0] + '.' + parts.slice(1).join('');
      }
      onChange(val);
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      e.target.select();
      if (onFocus) {
        onFocus(e);
      }
    };

    return (
      <div className="w-full flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-[13px] font-medium text-text-muted select-none">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          <span className="absolute left-3.5 text-text-muted font-medium select-none text-[14px] pointer-events-none">
            ₹
          </span>
          <input
            id={inputId}
            ref={ref}
            type="text"
            inputMode="decimal"
            value={value ?? ''}
            onChange={handleChange}
            onFocus={handleFocus}
            className={twMerge(
              clsx(
                'w-full h-[42px] min-h-[44px] sm:min-h-[42px] pl-8 pr-3.5 rounded-control border bg-white text-text text-right text-[14px] font-medium tabular-nums transition-all',
                'border-border placeholder:text-placeholder hover:border-slate-300',
                'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
                'disabled:bg-surface disabled:text-text-muted disabled:cursor-not-allowed',
                error && 'border-danger focus:border-danger focus:ring-danger/15',
                className
              )
            )}
            {...props}
          />
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

AmountInput.displayName = 'AmountInput';

