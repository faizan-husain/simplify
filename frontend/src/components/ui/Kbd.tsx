import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

export const Kbd: React.FC<KbdProps> = ({ children, className, ...props }) => {
  return (
    <kbd
      className={twMerge(
        clsx(
          'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-medium font-mono text-text-muted bg-surface rounded-[6px] border border-border select-none shadow-[0_1px_1px_rgba(0,0,0,0.04)]',
          className
        )
      )}
      {...props}
    >
      {children}
    </kbd>
  );
};
