import React from 'react';
import { t } from '../i18n';

export const DashboardPage: React.FC = () => {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold tracking-tight mb-4">{t('nav.home')}</h1>
      <div className="bg-surface p-6 rounded-card border border-border">
        <p className="text-sm text-text-muted">Welcome to SIMPLIFY Billing SaaS.</p>
      </div>
    </div>
  );
};
