import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ChevronRight } from 'lucide-react';

export interface ListRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  showChevron?: boolean;
  onClick?: () => void;
}

export const ListRow: React.FC<ListRowProps> = ({
  className,
  title,
  subtitle,
  leftContent,
  rightContent,
  showChevron = true,
  onClick,
  ...props
}) => {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={twMerge(
        clsx(
          'flex items-center justify-between min-h-[48px] py-2.5 px-3 rounded-lg transition-colors border-b border-border/50 last:border-b-0',
          onClick && 'cursor-pointer hover:bg-surface active:bg-gray-100',
          className
        )
      )}
      {...props}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {leftContent}
        <div className="flex flex-col min-w-0 flex-1">
          <div className="text-sm font-medium text-text truncate">{title}</div>
          {subtitle && <div className="text-xs text-text-muted truncate">{subtitle}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
        {rightContent}
        {showChevron && onClick && <ChevronRight className="w-4 h-4 text-text-muted" />}
      </div>
    </div>
  );
};
