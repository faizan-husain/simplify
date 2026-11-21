import { SlidersHorizontal } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

export interface FilterChipsProps<T extends string = string> {
  options: FilterOption<T>[];
  value: T;
  onChange: (val: T) => void;
  className?: string;
  onOpenFilterSheet?: () => void;
  activeFilterCount?: number;
}

export function FilterChips<T extends string = string>({
  options,
  value,
  onChange,
  className,
  onOpenFilterSheet,
  activeFilterCount = 0,
}: FilterChipsProps<T>) {
  return (
    <div
      className={twMerge(
        clsx(
          'flex items-center gap-2 overflow-x-auto no-scrollbar py-1 select-none',
          className
        )
      )}
    >
      {/* Horizontally scrollable chip pills */}
      <div className="flex items-center gap-1.5 shrink-0">
        {options.map((opt) => {
          const isActive = opt.value === value;

          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={clsx(
                'inline-flex items-center gap-1.5 h-[36px] px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all duration-150 outline-none cursor-pointer shrink-0 active:scale-[0.97]',
                isActive
                  ? 'bg-ink text-white shadow-2xs font-semibold'
                  : 'bg-surface-2 text-text hover:bg-surface-3'
              )}
            >
              <span>{opt.label}</span>
              {typeof opt.count === 'number' && (
                <span
                  className={clsx(
                    'text-[11px] px-1.5 py-0.2 rounded-full font-medium tabular-nums',
                    isActive ? 'bg-white/20 text-white' : 'bg-surface-3 text-text-muted'
                  )}
                >
                  {opt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Trailing Filters modal button if provided */}
      {onOpenFilterSheet && (
        <button
          type="button"
          onClick={onOpenFilterSheet}
          className={clsx(
            'inline-flex items-center justify-center gap-1.5 h-[36px] px-3 rounded-full text-[13px] font-medium transition-all duration-150 outline-none cursor-pointer shrink-0 active:scale-[0.97]',
            activeFilterCount > 0
              ? 'bg-ink text-white font-semibold'
              : 'bg-surface-2 text-text hover:bg-surface-3'
          )}
          aria-label="Open filter settings"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-accent" />
          )}
        </button>
      )}
    </div>
  );
}
