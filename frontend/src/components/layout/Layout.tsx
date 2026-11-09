import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  PlusCircle,
  FileText,
  Briefcase,
  IndianRupee,
  BarChart3,
  Menu,
  Plus,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  Search,
  Settings,
  X,
  ChevronDown,
  Coins,
} from 'lucide-react';
import { clsx } from 'clsx';
import { t } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { Kbd } from '../ui/Kbd';
import { CommandPalette } from './CommandPalette';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { business, member, user, loading, signOut } = useAuth();

  // Desktop sidebar collapse state
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('simplify_sidebar_collapsed') === 'true';
  });

  // Mobile drawer state
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Command palette state
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Logout confirm dialog state
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem('simplify_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  // Keyboard shortcut ⌘K / Ctrl+K for search, ⌘B / Ctrl+B for sidebar toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        const target = e.target as HTMLElement;
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

  if (loading || (user && !member)) {
    return (
      <div className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-[#F6F7F9] select-none transition-all duration-300">
        <div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="relative flex items-center justify-center">
            <img
              src="/simplify-logo.png"
              alt="SIMPLIFY"
              className="h-11 sm:h-12 w-auto object-contain select-none"
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-2.5 h-2.5 rounded-full bg-[#0F766E] animate-bounce [animation-delay:-0.3s]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#0F766E] animate-bounce [animation-delay:-0.15s]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#0F766E] animate-bounce" />
          </div>
        </div>
      </div>
    );
  }

  if (!user || !member) {
    return <Navigate to="/login" replace />;
  }

  const isStaff = member?.role === 'STAFF';

  // Route access guard for staff
  if (isStaff) {
    const forbiddenPaths = ['/money', '/reports', '/settings', '/recently-deleted'];
    if (forbiddenPaths.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))) {
      return <Navigate to="/" replace />;
    }
  }

  const handleSignOut = () => {
    setLogoutDialogOpen(true);
  };

  const confirmSignOut = async () => {
    setLogoutLoading(true);
    try {
      await signOut();
      setLogoutDialogOpen(false);
      navigate('/login');
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setLogoutLoading(false);
    }
  };

  const isCurrentActive = (to: string, exact?: boolean) => {
    if (to === '/' && (location.pathname === '/' || location.pathname === '/dashboard')) {
      return true;
    }
    if (to === '/bills') {
      return location.pathname.startsWith('/bills') && location.pathname !== '/bills/new';
    }
    if (to === '/earnings' || to === '/staff') {
      return location.pathname.startsWith('/earnings') || location.pathname.startsWith('/staff');
    }
    if (exact) return location.pathname === to;
    return location.pathname.startsWith(to);
  };

  // Vertical navigation items (Tailored per role: Staff has dedicated "My Dashboard" experience)
  const navItems = isStaff
    ? [
        { to: '/', label: t('nav.my_dashboard'), icon: LayoutDashboard, exact: true },
        { to: '/bills/new', label: t('nav.new_bill'), icon: PlusCircle, exact: true },
        { to: '/bills', label: t('nav.bills'), icon: FileText },
        ...(business?.job_management_enabled
          ? [{ to: '/jobs', label: t('nav.jobs'), icon: Briefcase }]
          : []),
        { to: '/earnings', label: 'Earnings', icon: Coins },
        { to: '/more', label: t('nav.more'), icon: Menu },
      ]
    : [
        { to: '/', label: t('nav.home'), icon: LayoutDashboard, exact: true },
        { to: '/bills/new', label: t('nav.new_bill'), icon: PlusCircle, exact: true },
        { to: '/bills', label: t('nav.bills'), icon: FileText },
        ...(business?.job_management_enabled && member?.role !== 'ACCOUNTANT'
          ? [{ to: '/jobs', label: t('nav.jobs'), icon: Briefcase }]
          : []),
        { to: '/money', label: t('nav.money'), icon: IndianRupee },
        ...(member?.role !== 'STAFF'
          ? [{ to: '/reports', label: t('nav.reports'), icon: BarChart3 }]
          : []),
        { to: '/more', label: t('nav.more'), icon: Menu },
      ];

  // Mobile bottom bar items
  const bottomNavItems = isStaff
    ? [
        { to: '/', label: t('nav.my_dashboard'), icon: LayoutDashboard, exact: true },
        { to: '/bills', label: t('nav.bills'), icon: FileText },
        ...(business?.job_management_enabled
          ? [{ to: '/jobs', label: t('nav.jobs'), icon: Briefcase }]
          : []),
        { to: '/earnings', label: 'Earnings', icon: Coins },
        { to: '/more', label: t('nav.more'), icon: Menu },
      ]
    : [
        { to: '/', label: t('nav.home'), icon: LayoutDashboard, exact: true },
        { to: '/bills', label: t('nav.bills'), icon: FileText },
        ...(business?.job_management_enabled && member?.role !== 'ACCOUNTANT'
          ? [{ to: '/jobs', label: t('nav.jobs'), icon: Briefcase }]
          : []),
        { to: '/money', label: t('nav.money'), icon: IndianRupee },
        ...(member?.role !== 'STAFF'
          ? [{ to: '/reports', label: t('nav.reports'), icon: BarChart3 }]
          : []),
        { to: '/more', label: t('nav.more'), icon: Menu },
      ];

  // Sidebar content (Quiet Luxury: 248px desktop / drawer mobile)
  const renderSidebarContent = (isDrawer = false) => (
    <div className="flex flex-col h-full bg-white select-none">
      {/* Brand Header */}
      <div className="h-[72px] px-5 flex items-center justify-between bg-white flex-shrink-0">
        <div
          className="flex items-center gap-2.5 cursor-pointer ml-1.5"
          onClick={() => {
            navigate('/');
            if (isDrawer) setIsMobileOpen(false);
          }}
        >
          <img
            src="/simplify-logo.png"
            alt="SIMPLIFY"
            className="h-[42px] w-auto object-contain select-none"
          />
        </div>

        {/* Toggle / Close */}
        <button
          onClick={() => {
            if (isDrawer) setIsMobileOpen(false);
            else setIsCollapsed(true);
          }}
          title={isDrawer ? 'Close Menu' : 'Collapse Sidebar (Ctrl+B)'}
          aria-label="Collapse sidebar"
          className="p-1.5 rounded-control text-text-muted hover:text-text hover:bg-surface-2 transition-colors flex-shrink-0"
        >
          {isDrawer ? (
            <X className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isCurrentActive(item.to, item.exact);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => {
                if (isDrawer) setIsMobileOpen(false);
              }}
              className={clsx(
                'group flex items-center gap-3 px-3 h-[42px] rounded-xl text-[14px] transition-all duration-150 select-none',
                active
                  ? 'bg-[#EAF2F1] text-[#0F766E] font-medium shadow-[0_1px_2px_rgba(15,118,110,0.05)]'
                  : 'text-[#4B5563] hover:text-text hover:bg-[#F3F4F6] font-normal'
              )}
            >
              <Icon
                className={clsx(
                  'w-4 h-4 flex-shrink-0 transition-colors',
                  active ? 'text-[#0F766E]' : 'text-[#6B7280] group-hover:text-text'
                )}
              />
              <span className="truncate flex-1">{item.label}</span>
            </NavLink>
          );
        })}
      </div>

      {/* Footer: Settings + Divider + User Chip */}
      <div className="p-3 bg-white flex-shrink-0 space-y-1">
        {/* Settings button - Hidden for staff */}
        {!isStaff && (
          <NavLink
            to="/settings"
            onClick={() => {
              if (isDrawer) setIsMobileOpen(false);
            }}
            className={clsx(
              'group flex items-center gap-3 px-3 h-[40px] rounded-xl text-[13.5px] transition-all select-none',
              location.pathname.startsWith('/settings')
                ? 'bg-[#EAF2F1] text-[#0F766E] font-medium'
                : 'text-[#4B5563] hover:text-text hover:bg-[#F3F4F6] font-normal'
            )}
          >
            <Settings className="w-4 h-4 text-[#6B7280] group-hover:text-text flex-shrink-0" />
            <span className="truncate flex-1">Settings</span>
          </NavLink>
        )}

        {/* Horizontal line only after Settings if owner */}
        {!isStaff && <div className="h-[1px] bg-divider mx-1 my-1" />}

        <div className="flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-surface-2 transition-colors">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#EAF2F1] text-[#0F766E] text-[12.5px] font-semibold flex items-center justify-center shrink-0">
              {(member?.name || 'Owner')
                .split(' ')
                .map((n: string) => n[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[13.5px] font-semibold text-text truncate">
                {member?.name || 'Owner B'}
              </div>
              <div className="text-[11.5px] text-text-muted capitalize truncate">
                {member?.role ? member.role.toLowerCase() : 'Owner'}
              </div>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            title={t('auth.logout')}
            aria-label="Log out"
            className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger-soft transition-colors flex-shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F6F7F9] text-text">
      {/* 1. Desktop Sidebar (248px or collapsed 72px) */}
      <aside
        className={clsx(
          'hidden md:flex flex-col border-r border-divider bg-white flex-shrink-0 z-30 transition-all duration-200 print:hidden',
          isCollapsed ? 'w-[72px]' : 'w-[248px]'
        )}
      >
        {isCollapsed ? (
          <div className="flex flex-col h-full items-center justify-between py-4 bg-white">
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={() => setIsCollapsed(false)}
                className="p-1 rounded-control text-text-muted hover:text-text hover:bg-surface-2 transition-colors flex items-center justify-center group"
                title="Expand Sidebar (Ctrl+B)"
                aria-label="Expand sidebar"
              >
                <img
                  src="/simplify-icon.png"
                  alt="SIMPLIFY"
                  className="w-7 h-7 object-contain select-none transition-transform group-hover:scale-105"
                />
              </button>
              <div className="flex flex-col items-center gap-2">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = isCurrentActive(item.to, item.exact);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      title={item.label}
                      className={clsx(
                        'w-10 h-10 rounded-control flex items-center justify-center transition-colors',
                        active
                          ? 'bg-accent-soft text-accent'
                          : 'text-text-muted hover:text-text hover:bg-surface-2'
                      )}
                    >
                      <Icon className="w-5 h-5" />
                    </NavLink>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col items-center gap-2">
              {!isStaff && (
                <>
                  <NavLink
                    to="/settings"
                    title="Settings"
                    className="w-10 h-10 rounded-control flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
                  >
                    <Settings className="w-5 h-5" />
                  </NavLink>
                  <div className="w-8 h-[1px] bg-divider my-1" />
                </>
              )}
              <Avatar name={member?.name || 'User'} size="sm" />
            </div>
          </div>
        ) : (
          renderSidebarContent(false)
        )}
      </aside>

      {/* 2. Mobile Drawer */}
      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            onClick={() => setIsMobileOpen(false)}
            className="fixed inset-0 bg-[#111827]/40 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-200"
          />
          <div className="relative w-[260px] max-w-[85vw] h-full bg-white shadow-pop z-50 flex flex-col animate-in slide-in-from-left duration-200">
            {renderSidebarContent(true)}
          </div>
        </div>
      )}

      {/* 3. Main Workspace */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F6F7F9]">
        {/* Top Header Bar: 72px Quiet Luxury Header (Border line removed, seamless with #F6F7F9 canvas) */}
        <header className="h-[72px] px-4 sm:px-6 bg-[#F6F7F9] flex items-center justify-between gap-4 flex-shrink-0 z-20 print:hidden">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Mobile menu trigger */}
            <button
              onClick={() => setIsMobileOpen(true)}
              aria-label="Open navigation menu"
              className="md:hidden p-2 rounded-control text-text-muted hover:text-text hover:bg-surface-2 transition-colors flex-shrink-0"
            >
              <PanelLeft className="w-5 h-5" />
            </button>

            {/* Global Search Pill (440px, ⌘K hint) */}
            <div
              onClick={() => setCommandPaletteOpen(true)}
              className="flex items-center justify-between w-full max-w-[440px] h-[40px] px-3.5 rounded-xl bg-white border border-border text-[13.5px] text-text-muted hover:border-border-strong hover:bg-surface-2 transition-all cursor-pointer select-none shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
            >
              <div className="flex items-center gap-2.5">
                <Search className="w-4 h-4 text-[#9CA3AF]" />
                <span className="text-[#9CA3AF]">Search bills, customers, receipts</span>
              </div>
              <div className="flex items-center gap-1">
                <Kbd>⌘K</Kbd>
              </div>
            </div>
          </div>

          {/* Right Header Area: Business Pill */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {/* Business Pill - Switcher/settings for Owner/Accountant, View-only for Staff */}
            <div
              onClick={() => {
                if (!isStaff) navigate('/settings');
              }}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white border border-border shadow-[0_1px_2px_rgba(0,0,0,0.03)] select-none',
                isStaff
                  ? 'cursor-default'
                  : 'hover:bg-surface-2 hover:border-border-strong cursor-pointer transition-all'
              )}
            >
              <div className="w-6 h-6 rounded-lg bg-[#111827] text-white text-[12px] font-bold flex items-center justify-center">
                {(business?.name || 'B')[0].toUpperCase()}
              </div>
              <span className="text-[13.5px] font-medium text-text truncate max-w-[140px]">
                {business?.name || 'B Services'}
              </span>
              {!isStaff && <ChevronDown className="w-3.5 h-3.5 text-text-muted" />}
            </div>
          </div>
        </header>

        {/* Page Content Viewport */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 pb-24 md:pb-8 bg-[#F6F7F9] print:p-0 print:m-0 print:overflow-visible print:bg-white">
          <Outlet />
        </div>

        {/* Floating "+ Bill" button on mobile (56px circle, ink, --sh-btn) */}
        <button
          onClick={() => navigate('/bills/new')}
          aria-label={t('nav.new_bill')}
          className="md:hidden fixed right-4 bottom-20 z-40 w-14 h-14 rounded-full bg-ink text-white shadow-btn flex items-center justify-center active:scale-95 transition-transform print:hidden"
        >
          <Plus className="w-6 h-6 stroke-[2.2]" />
        </button>

        {/* Mobile Bottom Navigation (64px, safe area) */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 bg-white/95 backdrop-blur-md border-t border-divider flex items-center justify-around px-2 print:hidden">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const active = isCurrentActive(item.to, item.exact);

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={clsx(
                  'flex flex-col items-center justify-center flex-1 h-full py-1 text-[11px] font-medium transition-colors min-h-[44px]',
                  active ? 'text-accent font-semibold' : 'text-text-muted hover:text-text'
                )}
              >
                <Icon
                  className={clsx(
                    'w-5 h-5 mb-0.5 transition-colors',
                    active ? 'text-accent' : 'text-text-muted'
                  )}
                />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </main>

      {/* Global Command Palette */}
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

      {/* Logout Confirmation Dialog (matches delete confirmation modal style) */}
      <ConfirmDialog
        open={logoutDialogOpen}
        onOpenChange={setLogoutDialogOpen}
        title="Log Out of SIMPLIFY?"
        description="Are you sure you want to log out of your session? You will need your login credentials to sign back in."
        confirmLabel="Log Out"
        cancelLabel="Cancel"
        variant="danger"
        icon={<LogOut className="w-4 h-4" />}
        loading={logoutLoading}
        onConfirm={confirmSignOut}
      />
    </div>
  );
};
