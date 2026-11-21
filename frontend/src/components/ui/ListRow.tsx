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
  titleClassName?: string;
  onClick?: () => void;
}

export const ListRow: React.FC<ListRowProps> = ({
  className,
  title,
  subtitle,
  leftContent,
  rightContent,
  showChevron = false,
  titleClassName,
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
          'flex items-center justify-between h-[52px] min-h-[52px] px-3.5 rounded-control transition-colors select-none',
          onClick ? 'cursor-pointer hover:bg-surface-2 active:bg-surface-3' : '',
          className
        )
      )}
      {...props}
    >
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        {leftContent}
        <div className="flex flex-col min-w-0 flex-1 leading-tight">
          <div className={clsx('text-[14px] font-medium truncate', titleClassName || 'text-text')}>{title}</div>
          {subtitle && <div className="text-[12.5px] text-text-muted truncate mt-0.5">{subtitle}</div>}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
        {rightContent}
        {showChevron && onClick && <ChevronRight className="w-4 h-4 text-text-muted opacity-60" />}
      </div>
    </div>
  );
};
