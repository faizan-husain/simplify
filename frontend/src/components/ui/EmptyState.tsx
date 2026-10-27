import React from 'react';
import { Button } from './Button';

export interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  message,
  actionLabel,
  onAction,
  className,
}) => {
  return (
    <div className={`flex flex-col items-center justify-center py-10 px-4 text-center ${className || ''}`}>
      <p className="text-sm text-text-muted mb-4">{message}</p>
      {actionLabel && onAction && (
        <Button variant="primary" size="md" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
