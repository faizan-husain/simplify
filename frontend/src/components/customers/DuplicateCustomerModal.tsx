import React from 'react';
import { Dialog } from '../ui/Dialog';
import { formatINR } from '../../lib/money';
import { t } from '../../i18n';

export interface MatchingCustomer {
  id: string;
  name: string;
  mobile: string;
  type: string;
  outstanding: number;
}

export interface DuplicateCustomerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: MatchingCustomer[];
  onUseExisting: (customer: MatchingCustomer) => void;
  onCreateAnyway: () => void;
}

export const DuplicateCustomerModal: React.FC<DuplicateCustomerModalProps> = ({
  open,
  onOpenChange,
  matches,
  onUseExisting,
  onCreateAnyway,
}) => {
  if (matches.length === 0) return null;
  const match = matches[0];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('customers.possible_duplicate')}
      className="sm:max-w-[440px] border-0 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
    >
      <div className="space-y-4">
        <div className="bg-[#EEF0F3] p-4 rounded-2xl border-0 shadow-2xs text-sm">
          <div className="font-semibold text-slate-900 break-words">{match.name}</div>
          <div className="text-xs text-slate-500 mt-0.5 break-words">{match.mobile} · {match.type}</div>
          <div className="mt-2 text-xs font-medium text-slate-700">
            Current Outstanding: <span className="font-semibold text-rose-600 tabular-nums">{formatINR(match.outstanding)}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <button
            type="button"
            className="flex-1 h-10 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs sm:text-sm shadow-xs transition-all cursor-pointer"
            onClick={() => {
              onUseExisting(match);
              onOpenChange(false);
            }}
          >
            {t('customers.use_existing')}
          </button>
          <button
            type="button"
            className="flex-1 h-10 rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs sm:text-sm shadow-2xs transition-all cursor-pointer"
            onClick={() => {
              onCreateAnyway();
              onOpenChange(false);
            }}
          >
            {t('customers.create_new_anyway')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
