import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string; // Strictly mandatory per §4 accessibility requirements
  size?: 'sm' | 'md';
  variant?: 'surface' | 'ghost' | 'accent' | 'ink';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = 'md', variant = 'surface', disabled, children, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center shrink-0 select-none cursor-pointer transition-all duration-fast disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98]';

    const sizes = {
      sm: 'w-8 h-8 rounded-small text-xs',
      md: 'w-[42px] h-[42px] rounded-control text-sm',
    };

    const variants = {
      surface:
        'bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-2 hover:shadow-card',
      ghost:
        'bg-transparent text-muted hover:text-text hover:bg-surface-2 border border-transparent',
      accent:
        'bg-accent-soft text-accent hover:bg-accent hover:text-white border border-transparent',
      ink:
        'bg-ink text-white shadow-btn hover:-translate-y-[1px] border border-transparent',
    };

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={twMerge(clsx(base, sizes[size], variants[variant], className))}
        {...props}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
