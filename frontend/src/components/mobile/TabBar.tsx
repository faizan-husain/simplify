import { useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

export interface TabBarProps<T extends string = string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (val: T) => void;
  className?: string;
  sticky?: boolean;
}

export function TabBar<T extends string = string>({
  tabs,
  value,
  onChange,
  className,
  sticky = false,
}: TabBarProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll active tab into view with smooth alignment
  useEffect(() => {
    if (activeTabRef.current && containerRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [value]);

  return (
    <div
      className={twMerge(
        clsx(
          'relative w-full border-b border-divider bg-white select-none',
          sticky && 'sticky top-0 z-20',
          className
        )
      )}
    >
      <div
        ref={containerRef}
        role="tablist"
        className="flex items-center gap-1 overflow-x-auto no-scrollbar scroll-smooth px-3 h-[44px] scroll-snap-x"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {tabs.map((tab) => {
          const isActive = tab.value === value;

          return (
            <button
              key={tab.value}
              ref={isActive ? activeTabRef : null}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.value)}
              className={clsx(
                'relative flex items-center justify-center gap-1.5 h-full px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors outline-none cursor-pointer shrink-0 scroll-snap-align-center',
                isActive ? 'text-accent font-semibold' : 'text-text-muted hover:text-text'
              )}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span
                  className={clsx(
                    'text-[11.5px] px-1.5 py-0.2 rounded-full font-medium tabular-nums',
                    isActive ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-text-muted'
                  )}
                >
                  {tab.count}
                </span>
              )}

              {/* 2px Teal Active Underline Indicator */}
              {isActive && (
                <div className="absolute bottom-0 inset-x-2 h-[2px] bg-accent rounded-t-full transition-all" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
