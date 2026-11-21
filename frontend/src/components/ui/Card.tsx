import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'white' | 'surface' | 'compact';
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'white', interactive = false, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={twMerge(
          clsx(
            'rounded-card border border-border bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] transition-all duration-card',
            variant === 'compact' ? 'p-5' : 'p-[22px]',
            interactive && 'cursor-pointer hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] hover:bg-[#F9FAFB]',
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
