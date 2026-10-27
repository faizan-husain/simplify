import React from 'react';
import { t } from '../i18n';

export const RegisterPage: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface">
      <div className="w-full max-w-sm bg-white p-6 rounded-card border border-border shadow-soft">
        <h1 className="text-xl font-bold tracking-tight mb-2">{t('auth.register')}</h1>
      </div>
    </div>
  );
};
