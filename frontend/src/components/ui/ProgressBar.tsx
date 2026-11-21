import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0 to 100 or current / max
  max?: number;
  fillClassName?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  className,
  fillClassName,
  ...props
}) => {
  const percentage = Math.min(100, Math.max(0, max > 0 ? (value / max) * 100 : 0));

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={twMerge(
        clsx(
          'w-full h-[6px] rounded-pill bg-surface-3 overflow-hidden',
          className
        )
      )}
      {...props}
    >
      <div
        className={twMerge(
          clsx(
            'h-full rounded-pill bg-accent transition-all duration-300 ease-out',
            fillClassName
          )
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};
