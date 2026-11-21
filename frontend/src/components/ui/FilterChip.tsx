import React from 'react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface FilterChipProps {
  label: string;
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}

export const FilterChip: React.FC<FilterChipProps> = ({
  label,
  onRemove,
  onClick,
  active = false,
  className,
}) => {
  return (
    <div
      onClick={onClick}
      className={twMerge(
        clsx(
          'inline-flex items-center gap-1.5 h-[32px] px-3 rounded-pill text-[13px] font-medium transition-all select-none',
          active
            ? 'bg-accent-soft text-accent border border-accent/20'
            : 'bg-surface-2 text-text hover:bg-surface-3',
          onClick && 'cursor-pointer',
          className
        )
      )}
    >
      <span>{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-0.5 -mr-1 rounded-full text-text-muted hover:text-text hover:bg-black/5 transition-colors focus:outline-none"
          aria-label={`Remove filter ${label}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
