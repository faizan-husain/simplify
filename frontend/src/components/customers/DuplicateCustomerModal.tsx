import React from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
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
    >
      <div className="space-y-4">
        <div className="bg-surface p-3.5 rounded-lg border border-border text-sm">
          <div className="font-semibold text-text">{match.name}</div>
          <div className="text-xs text-text-muted mt-0.5">{match.mobile} · {match.type}</div>
          <div className="mt-2 text-xs font-medium text-text">
            Current Outstanding: <span className="font-bold text-danger">{formatINR(match.outstanding)}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button
            type="button"
            variant="primary"
            size="md"
            className="flex-1"
            onClick={() => {
              onUseExisting(match);
              onOpenChange(false);
            }}
          >
            {t('customers.use_existing')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="flex-1"
            onClick={() => {
              onCreateAnyway();
              onOpenChange(false);
            }}
          >
            {t('customers.create_new_anyway')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
