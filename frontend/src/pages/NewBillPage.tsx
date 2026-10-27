import React from 'react';
import { t } from '../i18n';

export const NewBillPage: React.FC = () => {
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold tracking-tight mb-4">{t('billing.new_bill')}</h1>
    </div>
  );
};
