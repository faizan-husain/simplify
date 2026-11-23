import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'chip' | 'ghost' | 'destructive' | 'danger' | 'danger-solid' | 'outline' | 'accent';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium select-none cursor-pointer transition-all duration-fast disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98]';

    const variants = {
      // Primary CTA: ink background, white text 14/500, height 42, radius 12, --sh-btn; hover lifts 1px
      primary:
        'bg-ink text-white shadow-btn hover:-translate-y-[1px] rounded-control border border-transparent',
      
      // Secondary / Chip: white, 1px --border, radius 12, height 40; hover border --border-strong + soft shadow + 1px lift
      secondary:
        'bg-surface text-text border border-border hover:border-border-strong hover:shadow-card hover:-translate-y-[1px] rounded-control',
      chip:
        'bg-surface text-text border border-border hover:border-border-strong hover:shadow-card hover:-translate-y-[1px] rounded-control',
      
      // Outline
      outline:
        'bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-2 rounded-control',
      
      // Ghost small: height 32, radius 10, 1px border, 12.5/500
      ghost:
        'bg-transparent text-text-2 border border-border hover:border-border-strong hover:bg-surface-2 hover:text-text rounded-small',
      
      // Destructive (soft light red matching Logout style)
      destructive:
        'bg-rose-100/80 text-rose-700 hover:bg-rose-200/80 border-0 rounded-control font-semibold transition-colors',
      danger:
        'bg-rose-100/80 text-rose-700 hover:bg-rose-200/80 border-0 rounded-control font-semibold transition-colors',
      
      // Solid Destructive (used inside ConfirmDialog)
      'danger-solid':
        'bg-danger text-white shadow-btn hover:-translate-y-[1px] rounded-control border border-transparent',
      
      // Accent (Teal)
      accent:
        'bg-accent text-white shadow-btn hover:-translate-y-[1px] rounded-control border border-transparent',
    };


    const sizes = {
      sm: 'h-8 px-2.5 text-[12.5px] rounded-small',
      md: 'h-[42px] px-4 text-[14px] rounded-control',
      lg: 'h-[46px] px-6 text-[15px] rounded-control',
      icon: 'h-[42px] w-[42px] p-0 rounded-control',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}
        {...props}
      >
        {loading ? (
          <span className="inline-flex items-center justify-center gap-2 leading-none pointer-events-none">
            <svg
              className="animate-spin h-3.5 w-3.5 shrink-0 !inline-block"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="inline-flex items-center justify-center gap-1.5 leading-none [&>svg:not(.animate-spin)]:hidden">
              {children}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center justify-center gap-1.5 leading-none">
            {children}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
