import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'surface' | 'white';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'white', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={twMerge(
          clsx(
            'rounded-card border border-border p-4 shadow-soft transition-all',
            variant === 'white' ? 'bg-white' : 'bg-surface',
            className
          )
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
