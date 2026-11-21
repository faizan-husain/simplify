import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Share2, ArrowRight } from 'lucide-react';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { StatusDot } from '../ui/StatusDot';

export interface MobileCardProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

/** Base MobileCard Container with §2 tokens: padding 16, radius 20, hairline border, shadow-2xs */
export const MobileCard: React.FC<MobileCardProps> = ({ children, onClick, className }) => {
  return (
    <div
      onClick={onClick}
      className={twMerge(
        clsx(
          'w-full bg-white rounded-[20px] p-4 border border-border/70 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] transition-all select-none',
          onClick && 'cursor-pointer active:scale-[0.99] hover:border-border',
          className
        )
      )}
    >
      {children}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 1. DuesCard (§5.2 Reference Fix)                                          */
/* -------------------------------------------------------------------------- */

export interface DuesCardProps {
  customerName: string;
  totalDue: number;
  mobile?: string | null;
  customerType?: string | null;
  billCount: number;
  oldestDate?: string | Date | null;
  maxDaysOverdue?: number;
  onRemindWhatsApp?: () => void;
  onReceivePayment?: () => void;
  onOpenLedger?: () => void;
}

export const DuesCard: React.FC<DuesCardProps> = ({
  customerName,
  totalDue,
  mobile,
  customerType = 'Regular',
  billCount,
  oldestDate,
  maxDaysOverdue = 0,
  onRemindWhatsApp,
  onReceivePayment,
  onOpenLedger,
}) => {
  const isOverdue = maxDaysOverdue > 0;
  const formattedType =
    customerType?.toLowerCase() === 'walk_in'
      ? 'Walk-in'
      : customerType?.toLowerCase() === 'regular'
      ? 'Regular'
      : customerType || 'Customer';

  return (
    <MobileCard onClick={onOpenLedger} className="space-y-2.5">
      {/* Row 1: Title & Primary Value */}
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-[16px] font-semibold text-text truncate flex-1 min-w-0">
          {customerName}
        </h4>
        <div
          className={clsx(
            'text-[18px] font-semibold tabular-nums shrink-0 whitespace-nowrap',
            isOverdue ? 'text-danger' : 'text-text'
          )}
        >
          {formatINR(totalDue)}
        </div>
      </div>

      {/* Row 2: Meta (Mobile & Type) */}
      <div className="text-[13px] text-text-muted truncate">
        {mobile ? mobile : 'No mobile'} · {formattedType}
      </div>

      {/* Row 3: Meta & Status Chip (chip never truncates, meta text ellipsizes) */}
      <div className="flex items-center justify-between gap-2 min-h-[24px]">
        <span className="text-[13px] text-text-muted truncate min-w-0 flex-1">
          {billCount} unpaid bill{billCount > 1 ? 's' : ''}
          {oldestDate ? ` · Oldest ${formatDate(oldestDate)}` : ''}
        </span>
        {isOverdue ? (
          <span className="text-[12.5px] font-medium text-danger bg-danger-soft px-2.5 py-0.5 rounded-full shrink-0 whitespace-nowrap">
            {maxDaysOverdue} days late
          </span>
        ) : (
          <span className="text-[12.5px] font-medium text-accent bg-accent-soft px-2.5 py-0.5 rounded-full shrink-0 whitespace-nowrap">
            Due pending
          </span>
        )}
      </div>

      {/* Row 4: Actions Row (Equal width 44px buttons, secondary left, primary right) */}
      {(onRemindWhatsApp || onReceivePayment) && (
        <div className="pt-3 border-t border-divider grid grid-cols-2 gap-2.5">
          {onRemindWhatsApp ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemindWhatsApp();
              }}
              className="h-[44px] px-3 rounded-xl bg-white border border-border text-text font-medium text-[15px] flex items-center justify-center gap-1.5 shadow-2xs active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
            >
              <Share2 className="w-4 h-4 text-emerald-600" />
              <span>Remind</span>
            </button>
          ) : (
            <div />
          )}

          {onReceivePayment ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReceivePayment();
              }}
              className="h-[44px] px-3 rounded-xl bg-ink text-white font-medium text-[15px] flex items-center justify-center gap-1.5 shadow-btn active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
            >
              <span>Receive</span>
            </button>
          ) : (
            <div />
          )}
        </div>
      )}
    </MobileCard>
  );
};

/* -------------------------------------------------------------------------- */
/* 2. BillRow (§5.2)                                                          */
/* -------------------------------------------------------------------------- */

export interface BillRowProps {
  partyName: string;
  amount: number;
  invoiceNumber: string;
  invoiceDate: string | Date;
  status: 'paid' | 'partial' | 'unpaid' | 'cancelled';
  isOverdue?: boolean;
  onClick?: () => void;
}

export const BillRow: React.FC<BillRowProps> = ({
  partyName,
  amount,
  invoiceNumber,
  invoiceDate,
  status,
  isOverdue = false,
  onClick,
}) => {
  const statusLabel =
    status === 'cancelled'
      ? 'Cancelled'
      : isOverdue
      ? 'Overdue'
      : status === 'paid'
      ? 'Paid'
      : status === 'partial'
      ? 'Partial'
      : 'Unpaid';

  return (
    <MobileCard onClick={onClick} className="space-y-1.5 py-3.5">
      {/* Row 1: Party · Amount */}
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[16px] font-semibold text-text truncate flex-1 min-w-0">
          {partyName || 'Walk-in'}
        </h4>
        <div className="text-[18px] font-semibold text-text tabular-nums shrink-0 whitespace-nowrap">
          {formatINR(amount)}
        </div>
      </div>

      {/* Row 2: INV-No · Date */}
      <div className="text-[13px] text-text-muted truncate">
        {invoiceNumber} · {formatDate(invoiceDate)}
      </div>

      {/* Row 3: StatusDot + Word */}
      <div className="flex items-center gap-2 pt-0.5">
        <StatusDot status={isOverdue ? 'unpaid' : status} />
        <span
          className={clsx(
            'text-[12.5px] font-medium capitalize',
            isOverdue ? 'text-danger font-semibold' : 'text-text-muted'
          )}
        >
          {statusLabel}
        </span>
      </div>
    </MobileCard>
  );
};

/* -------------------------------------------------------------------------- */
/* 3. MoneyRow (§5.2)                                                         */
/* -------------------------------------------------------------------------- */

export interface MoneyRowProps {
  title: string;
  amount: number;
  isMoneyIn?: boolean;
  mode: string;
  reference?: string | null;
  date: string | Date;
  onClick?: () => void;
}

export const MoneyRow: React.FC<MoneyRowProps> = ({
  title,
  amount,
  isMoneyIn = false,
  mode,
  reference,
  date,
  onClick,
}) => {
  return (
    <MobileCard onClick={onClick} className="space-y-1.5 py-3.5">
      {/* Row 1: Party or Category · Amount */}
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[16px] font-semibold text-text truncate flex-1 min-w-0">
          {title}
        </h4>
        <div
          className={clsx(
            'text-[18px] font-semibold tabular-nums shrink-0 whitespace-nowrap',
            isMoneyIn ? 'text-success' : 'text-text'
          )}
        >
          {isMoneyIn ? '+' : ''}{formatINR(amount)}
        </div>
      </div>

      {/* Row 2: Mode · Reference */}
      <div className="text-[13px] text-text-muted truncate">
        {mode} {reference ? `· ${reference}` : ''}
      </div>

      {/* Row 3: Date */}
      <div className="text-[12.5px] text-text-muted">
        {formatDate(date)}
      </div>
    </MobileCard>
  );
};

/* -------------------------------------------------------------------------- */
/* 4. CustomerRow (§5.2)                                                      */
/* -------------------------------------------------------------------------- */

export interface CustomerRowProps {
  name: string;
  mobile?: string | null;
  dueAmount?: number;
  onClick?: () => void;
}

export const CustomerRow: React.FC<CustomerRowProps> = ({
  name,
  mobile,
  dueAmount = 0,
  onClick,
}) => {
  const initials = (name || 'C')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <MobileCard onClick={onClick} className="py-3 px-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-10 h-10 rounded-full bg-surface-3 text-text font-bold text-xs flex items-center justify-center shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold text-text truncate">{name}</p>
          <p className="text-[13px] text-text-muted truncate mt-0.5">
            {mobile ? mobile : 'No mobile'}
          </p>
        </div>
      </div>

      {dueAmount > 0 ? (
        <div className="text-right shrink-0">
          <div className="text-[16px] font-semibold text-danger tabular-nums whitespace-nowrap">
            {formatINR(dueAmount)}
          </div>
          <span className="text-[12px] text-danger/80 font-medium">Due</span>
        </div>
      ) : (
        <ArrowRight className="w-4 h-4 text-text-muted shrink-0" />
      )}
    </MobileCard>
  );
};

/* -------------------------------------------------------------------------- */
/* 5. StaffCard (§5.2)                                                        */
/* -------------------------------------------------------------------------- */

export interface StaffCardProps {
  name: string;
  payLabel: string;
  balance: number;
  dueAmount: number;
  paidAmount: number;
  jobsDone: number;
  onPay?: () => void;
  onClick?: () => void;
}

export const StaffCard: React.FC<StaffCardProps> = ({
  name,
  payLabel,
  balance,
  dueAmount,
  paidAmount,
  jobsDone,
  onPay,
  onClick,
}) => {
  return (
    <MobileCard onClick={onClick} className="space-y-2.5">
      {/* Row 1: Name + Pay Label · Balance */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-[16px] font-semibold text-text truncate">{name}</h4>
          <span className="text-[13px] text-text-muted">{payLabel}</span>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[18px] font-bold text-text tabular-nums whitespace-nowrap">
            {formatINR(balance)}
          </div>
          <span className="text-[12px] text-text-muted font-medium">Balance</span>
        </div>
      </div>

      {/* Row 2: Due · Paid · Jobs Done */}
      <div className="text-[13px] text-text-muted truncate">
        Due: <strong className="text-text font-semibold">{formatINR(dueAmount)}</strong> · Paid: {formatINR(paidAmount)} · {jobsDone} jobs
      </div>

      {/* Row 3: Action Row (Pay button) */}
      {onPay && (
        <div className="pt-3 border-t border-divider">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPay();
            }}
            className="w-full h-[44px] rounded-xl bg-ink text-white font-medium text-[15px] flex items-center justify-center gap-1.5 shadow-btn active:scale-[0.98] transition-all cursor-pointer"
          >
            <span>Pay Staff</span>
          </button>
        </div>
      )}
    </MobileCard>
  );
};
