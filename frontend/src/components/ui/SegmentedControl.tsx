import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';


export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string = string> {
  options: (SegmentedOption<T> | string)[];
  value: T;
  onChange: (val: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: SegmentedControlProps<T>) {
  const normalizedOptions: SegmentedOption<T>[] = options.map((opt) =>
    typeof opt === 'string' ? { value: opt as T, label: opt } : opt
  );

  return (
    <div
      role="tablist"
      className={twMerge(
        clsx(
          'inline-flex items-center p-1 rounded-control bg-surface-3 transition-colors select-none max-w-full overflow-x-auto no-scrollbar',
          className
        )
      )}
    >
      {normalizedOptions.map((opt) => {
        const isSelected = opt.value === value;

        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onChange(opt.value)}
            className={clsx(
              'relative flex items-center justify-center gap-1.5 font-medium transition-all duration-200 outline-none cursor-pointer shrink-0 whitespace-nowrap',
              size === 'sm'
                ? 'h-[30px] px-2.5 text-[12.5px] rounded-[7px]'
                : 'h-[34px] px-3.5 text-[13.5px] rounded-[9px]',
              isSelected
                ? 'bg-white text-text shadow-sm font-semibold'
                : 'text-text-muted hover:text-text'
            )}
          >
            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span
                className={clsx(
                  'text-[11px] px-1.5 py-0.2 rounded-full font-medium tabular-nums',
                  isSelected ? 'bg-surface-2 text-text' : 'bg-surface text-text-muted'
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
