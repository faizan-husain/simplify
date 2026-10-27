import React from 'react';
import { clsx } from 'clsx';

export type StatusVariant = 'paid' | 'partial' | 'unpaid' | 'overdue' | 'cancelled' | 'yellow' | 'red' | 'success' | 'active' | 'in_progress';

export interface StatusDotProps {
  status: StatusVariant | string;
  label?: string;
  className?: string;
}

export const StatusDot: React.FC<StatusDotProps> = ({ status, label, className }) => {
  const normStatus = status.toLowerCase();

  const colorMap: Record<string, string> = {
    paid: 'bg-success',
    success: 'bg-success',
    completed: 'bg-success',
    active: 'bg-success',
    partial: 'bg-amber-500',
    yellow: 'bg-warning',
    unpaid: 'bg-gray-400',
    overdue: 'bg-danger',
    red: 'bg-danger',
    cancelled: 'bg-gray-400',
    in_progress: 'bg-primary',
  };

  const dotColor = colorMap[normStatus] || 'bg-gray-400';

  const defaultLabelMap: Record<string, string> = {
    paid: 'Paid',
    partial: 'Partial',
    unpaid: 'Unpaid',
    overdue: 'Overdue',
    cancelled: 'Cancelled',
    yellow: 'Yellow',
    red: 'Red',
    completed: 'Completed',
    in_progress: 'In Progress',
  };

  const displayLabel = label || defaultLabelMap[normStatus] || status;

  return (
    <div className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', className)}>
      <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', dotColor)} aria-hidden="true" />
      <span>{displayLabel}</span>
    </div>
  );
};
