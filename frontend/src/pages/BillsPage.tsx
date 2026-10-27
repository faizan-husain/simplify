import React from 'react';
import { t } from '../i18n';

export const BillsPage: React.FC = () => {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold tracking-tight mb-4">{t('nav.bills')}</h1>
    </div>
  );
};
