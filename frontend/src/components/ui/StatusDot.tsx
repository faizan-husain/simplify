import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type StatusVariant =
  | 'paid'
  | 'partial'
  | 'due'
  | 'unpaid'
  | 'overdue'
  | 'cancelled'
  | 'yellow'
  | 'red'
  | 'success'
  | 'active'
  | 'completed'
  | 'in_progress';

export interface StatusDotProps {
  status: StatusVariant | string;
  label?: string;
  className?: string;
}

export const StatusDot: React.FC<StatusDotProps> = ({ status, label, className }) => {
  const normStatus = (status || '').toLowerCase().trim();

  let dotColor = 'bg-[#9CA3AF]'; // var(--neutral-dot)
  let isCancelled = false;

  switch (normStatus) {
    case 'paid':
    case 'success':
    case 'completed':
    case 'active':
      dotColor = 'bg-success';
      break;
    case 'partial':
    case 'yellow':
      dotColor = 'bg-warning';
      break;
    case 'overdue':
    case 'red':
      dotColor = 'bg-danger';
      break;
    case 'cancelled':
      dotColor = 'bg-[#9CA3AF]';
      isCancelled = true;
      break;
    case 'due':
    case 'unpaid':
    case 'in_progress':
    default:
      dotColor = 'bg-[#9CA3AF]';
      break;
  }

  const defaultLabelMap: Record<string, string> = {
    paid: 'Paid',
    partial: 'Partial',
    due: 'Due',
    unpaid: 'Unpaid',
    overdue: 'Overdue',
    cancelled: 'Cancelled',
    yellow: 'Needs Attention',
    red: 'Critical',
    completed: 'Completed',
    in_progress: 'In Progress',
    active: 'Active',
  };

  const displayLabel = label || defaultLabelMap[normStatus] || status;

  return (
    <div
      className={twMerge(
        clsx(
          'inline-flex items-center gap-2 text-[14px] leading-none select-none',
          isCancelled ? 'line-through text-text-muted' : 'text-text font-normal',
          className
        )
      )}
    >
      <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', dotColor)} aria-hidden="true" />
      <span>{displayLabel}</span>
    </div>
  );
};
