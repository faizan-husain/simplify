import React from 'react';
import { Button } from './Button';
import { Inbox } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message?: string; // backwards compatibility
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  message,
  description,
  actionLabel,
  onAction,
  action,
  className,
}) => {
  const displayTitle = title || message || 'No records found';

  return (
    <div
      className={twMerge(
        clsx(
          'flex flex-col items-center justify-center py-12 px-4 text-center select-none',
          className
        )
      )}
    >
      <div className="w-12 h-12 rounded-full bg-accent-soft text-accent flex items-center justify-center mb-3.5">
        {icon ? (
          <div className="w-5 h-5 flex items-center justify-center">{icon}</div>
        ) : (
          <Inbox className="w-5 h-5 text-accent" />
        )}
      </div>
      <h3 className="text-[14px] font-medium text-text mb-1">{displayTitle}</h3>
      {description && (
        <p className="text-[13px] text-text-muted max-w-sm mb-4 leading-relaxed">
          {description}
        </p>
      )}
      {action ? (
        action
      ) : actionLabel && onAction ? (
        <Button variant="primary" size="sm" onClick={onAction} className="mt-2">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
};
