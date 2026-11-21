import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface StickyActionBarProps {
  children?: React.ReactNode;
  summary?: React.ReactNode;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
  className?: string;
  aboveNav?: boolean;
}

export const StickyActionBar: React.FC<StickyActionBarProps> = ({
  children,
  summary,
  primaryAction,
  secondaryAction,
  className,
  aboveNav = false,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'fixed inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-divider p-3 sm:px-6 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] transition-all',
          aboveNav ? 'bottom-16' : 'bottom-0',
          !aboveNav && 'pb-[max(12px,env(safe-area-inset-bottom))]',
          className
        )
      )}
    >
      <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 w-full">
        {summary && (
          <div className="min-w-0 flex-1">
            {summary}
          </div>
        )}

        {children ? (
          <div className="flex items-center gap-2.5 flex-1 justify-end">
            {children}
          </div>
        ) : (
          <div className="flex items-center gap-2.5 shrink-0 ml-auto">
            {secondaryAction && (
              <button
                type="button"
                disabled={secondaryAction.disabled}
                onClick={secondaryAction.onClick}
                className="h-[48px] px-4 rounded-xl bg-white border border-border text-text font-medium text-[15px] shadow-2xs active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {secondaryAction.label}
              </button>
            )}

            {primaryAction && (
              <button
                type="button"
                disabled={primaryAction.disabled || primaryAction.loading}
                onClick={primaryAction.onClick}
                className="h-[48px] px-6 rounded-xl bg-ink text-white font-medium text-[15px] flex items-center justify-center gap-2 shadow-btn active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {primaryAction.loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Saving...</span>
                  </span>
                ) : (
                  <>
                    {primaryAction.icon}
                    <span>{primaryAction.label}</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
