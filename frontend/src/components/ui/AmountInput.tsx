import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface AmountInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string;
  error?: string;
  value: string | number;
  onChange: (val: string) => void;
}

export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  ({ className, label, error, value, onChange, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Allow only numbers and at most one decimal point
      let val = e.target.value.replace(/[^0-9.]/g, '');
      const parts = val.split('.');
      if (parts.length > 2) {
        val = parts[0] + '.' + parts.slice(1).join('');
      }
      onChange(val);
    };

    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-text-muted">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          <span className="absolute left-3.5 text-text-muted font-medium select-none text-sm">
            ₹
          </span>
          <input
            id={inputId}
            ref={ref}
            type="text"
            inputMode="decimal"
            value={value ?? ''}
            onChange={handleChange}
            className={twMerge(
              clsx(
                'w-full h-11 pl-8 pr-3.5 rounded-lg border bg-white text-text text-sm font-medium transition-colors',
                'min-h-[44px]',
                'border-border hover:border-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
                error && 'border-danger focus:border-danger focus:ring-danger',
                className
              )
            )}
            {...props}
          />
        </div>
        {error && <span className="text-xs text-danger font-medium">{error}</span>}
      </div>
    );
  }
);

AmountInput.displayName = 'AmountInput';
