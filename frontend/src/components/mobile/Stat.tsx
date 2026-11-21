import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface StatProps {
  label: string;
  value: string | number;
  delta?: string | React.ReactNode;
  variant?: 'default' | 'danger' | 'success' | 'accent';
  className?: string;
  onClick?: () => void;
}

export const Stat: React.FC<StatProps> = ({
  label,
  value,
  delta,
  variant = 'default',
  className,
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={twMerge(
        clsx(
          'w-full bg-white rounded-[20px] p-4 border border-border/70 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] flex flex-col justify-between min-h-[96px] transition-all select-none',
          onClick && 'cursor-pointer active:scale-[0.98]',
          className
        )
      )}
    >
      <span className="text-[13px] font-medium text-text-muted leading-tight truncate">
        {label}
      </span>

      <div
        className={clsx(
          'text-[22px] font-semibold tabular-nums tracking-tight leading-none mt-2 truncate',
          variant === 'danger' && 'text-danger',
          variant === 'success' && 'text-success',
          variant === 'accent' && 'text-accent',
          variant === 'default' && 'text-text'
        )}
      >
        {value}
      </div>

      {delta && (
        <div className="text-[12px] text-text-muted truncate mt-1.5 font-normal">
          {delta}
        </div>
      )}
    </div>
  );
};

export interface StatGridProps {
  children: React.ReactNode;
  className?: string;
}

export const StatGrid: React.FC<StatGridProps> = ({ children, className }) => {
  return (
    <div
      className={twMerge(
        clsx(
          'grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 w-full',
          className
        )
      )}
    >
      {children}
    </div>
  );
};
