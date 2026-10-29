import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Briefcase,
  IndianRupee,
  Menu,
  Plus,
  ChevronRight,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { t } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { HeaderSearch } from './HeaderSearch';

export const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { business, member, user, loading, signOut } = useAuth();

  // Desktop sidebar collapse state (persisted in localStorage like ChatGPT)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('simplify_sidebar_collapsed') === 'true';
  });

  // Mobile drawer slide-over state
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('simplify_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  // Keyboard shortcut Ctrl+B / Cmd+B to toggle sidebar (ChatGPT & Notion style)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        const target = e.target as HTMLElement;
        // Don't trigger if user is actively typing in an input or textarea
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        setIsCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-b from-[#0862EC] via-[#0755D6] to-[#073897] text-white flex items-center justify-center font-bold text-xl shadow-lg shadow-[#0862EC]/25 animate-pulse">
            S
          </div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Loading SIMPLIFY...
          </div>
        </div>
      </div>
    );
  }

  if (!user || !member) {
    return <Navigate to="/login" replace />;
  }

  const handleSignOut = async () => {
    if (window.confirm('Are you sure you want to log out?')) {
      await signOut();
      navigate('/login');
    }
  };

  const isCurrentActive = (to: string, exact?: boolean) => {
    if (exact) return location.pathname === to;
    return location.pathname.startsWith(to);
  };

  // Simple, clean navigation items per §10: Dashboard, Bills, [Jobs], Money, More
  const navItems = [
    { to: '/', label: t('nav.home'), icon: LayoutDashboard, exact: true },
    { to: '/bills', label: t('nav.bills'), icon: FileText },
    ...(business?.job_management_enabled
      ? [{ to: '/jobs', label: t('nav.jobs'), icon: Briefcase }]
      : []),
    { to: '/money', label: t('nav.money'), icon: IndianRupee },
    { to: '/more', label: t('nav.more'), icon: Menu },
  ];

  const getInitials = (name?: string) => {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  const businessInitial = business?.name ? business.name.trim().charAt(0).toUpperCase() : 'G';

  // Reusable Sidebar Content (shared between Desktop & Mobile)
  const renderSidebarContent = (isDrawer = false) => (
    <div className="flex flex-col h-full bg-white select-none">
      {/* Top Header & Branding (Compact & Elegant) */}
      <div className="p-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-b from-[#0B67F6] via-[#0755D6] to-[#073897] text-white flex items-center justify-center font-bold text-lg shadow-sm shadow-[#0B67F6]/20 flex-shrink-0">
            {businessInitial}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-extrabold text-[15px] tracking-tight text-[#101828] leading-tight truncate">
              {business?.name || t('app.name')}
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-[#1CB98C] flex-shrink-0"></span>
              <p className="text-[10px] font-bold text-[#8E9EBC] tracking-wider uppercase truncate">
                {business?.plan || 'PRO'} • {member?.role || 'OWNER'}
              </p>
            </div>
          </div>
        </div>

        {/* Close / Collapse Button (Like ChatGPT / Design screenshot) */}
        <button
          onClick={() => {
            if (isDrawer) setIsMobileOpen(false);
            else setIsCollapsed(true);
          }}
          title={isDrawer ? 'Close Menu' : 'Close Sidebar (Ctrl+B)'}
          aria-label="Collapse sidebar"
          className="p-1.5 rounded-lg text-[#92A1BF] hover:text-[#101828] hover:bg-slate-100 transition-colors flex-shrink-0 active:scale-95"
        >
          {isDrawer ? (
            <X className="w-4 h-4 stroke-[2.2]" />
          ) : (
            <PanelLeftClose className="w-4 h-4 stroke-[2]" />
          )}
        </button>
      </div>

      {/* "+ New Bill" Action Button (Compact) */}
      <div className="px-3 pt-1.5 pb-2">
        <button
          onClick={() => {
            navigate('/bills/new');
            if (isDrawer) setIsMobileOpen(false);
          }}
          className="w-full h-11 rounded-xl bg-gradient-to-r from-[#0B67F6] to-[#0656E6] text-white flex items-center justify-between px-3 shadow-md shadow-[#0B67F6]/25 hover:shadow-lg hover:shadow-[#0B67F6]/30 active:scale-[0.98] transition-all group"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shadow-sm flex-shrink-0">
              <Plus className="w-4 h-4 text-[#0B67F6] stroke-[3]" />
            </div>
            <span className="font-bold text-[14px] text-white tracking-tight truncate">
              {t('nav.new_bill')}
            </span>
          </div>

          <div className="w-6 h-6 rounded-lg bg-white/20 group-hover:bg-white/30 backdrop-blur-sm flex items-center justify-center flex-shrink-0 transition-colors">
            <ChevronRight className="w-3.5 h-3.5 text-white stroke-[2.5]" />
          </div>
        </button>
      </div>

      {/* Clean Navigation Items (Compact) */}
      <div className="flex-1 overflow-y-auto px-2.5 py-1 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isCurrentActive(item.to, item.exact);
          const isHome = item.to === '/';

          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => {
                if (isDrawer) setIsMobileOpen(false);
              }}
              className={clsx(
                'group relative flex items-center justify-between px-2.5 rounded-xl transition-all select-none',
                active
                  ? 'h-[44px] bg-[#E8F2FD] text-[#0B67F6]'
                  : 'h-[42px] text-slate-700 hover:bg-slate-50'
              )}
            >
              {/* Left Accent Indicator Pill on Active Item */}
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[#0B67F6] rounded-r-full" />
              )}

              <div className="flex items-center gap-2.5 min-w-0">
                {/* Icon Container Squircle */}
                <div
                  className={clsx(
                    'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
                    active
                      ? 'bg-[#D6E7FC]'
                      : 'bg-[#EDF1F8] group-hover:bg-[#E2E8F0]'
                  )}
                >
                  <Icon
                    className={clsx(
                      'w-4 h-4 transition-colors',
                      active
                        ? isHome
                          ? 'text-[#0B67F6] fill-[#0B67F6]'
                          : 'text-[#0B67F6] stroke-[2.4]'
                        : 'text-[#415682] group-hover:text-[#1B2E52] stroke-[2]'
                    )}
                  />
                </div>

                <span
                  className={clsx(
                    'text-[14px] font-bold tracking-tight truncate',
                    active
                      ? 'text-[#0B67F6]'
                      : 'text-[#1B2E52] group-hover:text-[#0F172A]'
                  )}
                >
                  {item.label}
                </span>
              </div>

              {/* Right Indicator: Active Dot vs Inactive Chevron */}
              {active ? (
                <span className="w-2 h-2 rounded-full bg-[#0B67F6] flex-shrink-0 mr-1" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#A0B0C8] group-hover:text-slate-600 stroke-[2.2] flex-shrink-0 mr-1 transition-colors" />
              )}
            </NavLink>
          );
        })}
      </div>

      {/* User Profile Card (Compact Bottom Footer) */}
      <div className="p-2.5 border-t border-slate-100 bg-slate-50/50">
        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white border border-slate-200/70 shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-b from-[#0B67F6] to-[#073897] text-white flex items-center justify-center font-bold text-[11px] flex-shrink-0 shadow-sm">
              {getInitials(member?.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold text-[#1B2E52] truncate">
                {member?.name || 'Logged In'}
              </div>
              <div className="text-[9px] font-bold text-[#8E9EBC] uppercase tracking-wider">
                {member?.role || 'Staff'}
              </div>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            title={t('auth.logout')}
            aria-label="Log out"
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 stroke-[2]" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC] text-[#0F172A]">
      {/* 1. DESKTOP SIDEBAR (Slide-In / Out like ChatGPT) */}
      <aside
        className={clsx(
          'hidden md:flex flex-col border-r border-slate-200/90 bg-white flex-shrink-0 shadow-[1px_0_12px_rgba(11,103,246,0.03)] z-30 transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)]',
          isCollapsed ? 'w-0 opacity-0 overflow-hidden border-none' : 'w-[245px] opacity-100'
        )}
      >
        <div className="w-[245px] h-full flex flex-col">
          {renderSidebarContent(false)}
        </div>
      </aside>

      {/* 2. MOBILE DRAWER OVERLAY (Backdrop & Slide-Over Panel) */}
      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop blur */}
          <div
            onClick={() => setIsMobileOpen(false)}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
          />

          {/* Slide-over panel */}
          <div className="relative w-[260px] max-w-[85vw] h-full bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-left duration-300">
            {renderSidebarContent(true)}
          </div>
        </div>
      )}

      {/* 3. MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Header Bar (Clean & Focused) */}
        <header className="h-14 px-3 sm:px-4 border-b border-slate-200/80 bg-white flex items-center justify-between gap-3 flex-shrink-0 z-20 shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Sidebar Expand / Toggle Button on Desktop (visible when collapsed, like ChatGPT) */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              title={isCollapsed ? 'Open sidebar (Ctrl+B)' : 'Close sidebar (Ctrl+B)'}
              aria-label="Toggle sidebar"
              className={clsx(
                'hidden md:inline-flex p-2 rounded-xl text-[#92A1BF] hover:text-[#0B67F6] hover:bg-slate-100/80 transition-all active:scale-95',
                !isCollapsed && 'opacity-0 pointer-events-none w-0 p-0 overflow-hidden'
              )}
            >
              <PanelLeft className="w-5 h-5 stroke-[2]" />
            </button>

            {/* Mobile Menu Hamburger Button */}
            <button
              onClick={() => setIsMobileOpen(true)}
              aria-label="Open navigation menu"
              className="md:hidden p-2 rounded-xl text-slate-600 hover:text-[#0B67F6] hover:bg-slate-100 transition-colors"
            >
              <PanelLeft className="w-5 h-5 stroke-[2]" />
            </button>

            {/* Global Search */}
            <div className="flex-1 max-w-md">
              <HeaderSearch />
            </div>
          </div>
        </header>

        {/* Page Content Viewport */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden pb-20 md:pb-2 lg:pb-2.5">
          <Outlet />
        </div>

        {/* Floating "+ Bill" button on mobile */}
        <button
          onClick={() => navigate('/bills/new')}
          aria-label={t('nav.new_bill')}
          className="md:hidden fixed right-4 bottom-20 z-40 w-14 h-14 rounded-full bg-gradient-to-r from-[#0B67F6] to-[#0656E6] text-white shadow-xl shadow-[#0B67F6]/35 flex items-center justify-center active:scale-95 transition-transform"
        >
          <Plus className="w-7 h-7 stroke-[2.5]" />
        </button>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 bg-white/95 backdrop-blur-md border-t border-slate-200/80 flex items-center justify-around px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isCurrentActive(item.to, item.exact);
            const isHome = item.to === '/';

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={clsx(
                  'flex flex-col items-center justify-center flex-1 h-full py-1 text-[11px] font-medium transition-colors min-h-[44px]',
                  active ? 'text-[#0B67F6] font-bold' : 'text-slate-400'
                )}
              >
                <Icon
                  className={clsx(
                    'w-5 h-5 mb-0.5',
                    active
                      ? isHome
                        ? 'text-[#0B67F6] fill-[#0B67F6]'
                        : 'text-[#0B67F6] stroke-[2.4]'
                      : 'text-slate-400 stroke-[1.8]'
                  )}
                />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </main>
    </div>
  );
};
