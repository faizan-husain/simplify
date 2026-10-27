import React from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Home, FileText, Briefcase, IndianRupee, Menu, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { t } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { HeaderSearch } from './HeaderSearch';

export const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { business } = useAuth();

  // Navigation items per §10 (Jobs only if job management enabled)
  const navItems = [
    { to: '/', label: t('nav.home'), icon: Home, exact: true },
    { to: '/bills', label: t('nav.bills'), icon: FileText },
    ...(business?.job_management_enabled ? [{ to: '/jobs', label: t('nav.jobs'), icon: Briefcase }] : []),
    { to: '/money', label: t('nav.money'), icon: IndianRupee },
    { to: '/more', label: t('nav.more'), icon: Menu },
  ];

  const isCurrentActive = (to: string, exact?: boolean) => {
    if (exact) return location.pathname === to;
    return location.pathname.startsWith(to);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-text">
      {/* Desktop / Tablet Left Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-surface p-4 flex-shrink-0">
        <div className="flex items-center gap-2 px-2 py-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-lg">
            S
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight text-text">{t('app.name')}</h1>
            <p className="text-[11px] text-text-muted">{t('app.tagline')}</p>
          </div>
        </div>

        <button
          onClick={() => navigate('/bills/new')}
          className="w-full h-11 mb-6 flex items-center justify-center gap-2 rounded-lg bg-primary text-white font-medium hover:bg-primary-hover shadow-sm transition-colors active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>{t('nav.new_bill')}</span>
        </button>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isCurrentActive(item.to, item.exact);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]',
                  active
                    ? 'bg-white text-primary shadow-soft font-semibold'
                    : 'text-text-muted hover:text-text hover:bg-white/50'
                )}
              >
                <Icon className={clsx('w-5 h-5', active ? 'text-primary' : 'text-text-muted')} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Header Bar with Global Search */}
        <header className="h-14 px-4 border-b border-border bg-white flex items-center justify-between gap-4 flex-shrink-0 z-20">
          <HeaderSearch />
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden pb-20 md:pb-6">
          <Outlet />
        </div>

        {/* Floating "+ Bill" button on mobile */}
        <button
          onClick={() => navigate('/bills/new')}
          aria-label={t('nav.new_bill')}
          className="md:hidden fixed right-4 bottom-20 z-40 w-14 h-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        >
          <Plus className="w-7 h-7" />
        </button>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 bg-white border-t border-border flex items-center justify-around px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isCurrentActive(item.to, item.exact);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={clsx(
                  'flex flex-col items-center justify-center flex-1 h-full py-1 text-[11px] font-medium transition-colors min-h-[44px]',
                  active ? 'text-primary font-semibold' : 'text-text-muted'
                )}
              >
                <Icon className={clsx('w-5 h-5 mb-0.5', active ? 'text-primary' : 'text-text-muted')} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </main>
    </div>
  );
};
