import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'neutral' | 'accent';
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  className,
  children,
  ...props
}) => {
  return (
    <span
      className={twMerge(
        clsx(
          'inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11.5px] font-medium tabular-nums transition-colors',
          variant === 'neutral'
            ? 'bg-surface-2 text-text-muted border border-border/50'
            : 'bg-accent-soft text-accent border border-accent/20',
          className
        )
      )}
      {...props}
    >
      {children}
    </span>
  );
};
