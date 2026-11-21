import React, { useState, useEffect, useRef } from 'react';
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
  Search,
  Settings,
  ChevronDown,
  ChevronLeft,
  Users,
  Sparkles,
  Coins,
} from 'lucide-react';
import { clsx } from 'clsx';
import { t } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { Kbd } from '../ui/Kbd';
import { CommandPalette } from './CommandPalette';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { useKeyboardShortcuts } from '../../context/KeyboardShortcutContext';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { MobileProfileSheet } from '../mobile/MobileProfileSheet';

export const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { business, member, user, loading, signOut } = useAuth();

  const isRootScreen = ['/', '/bills', '/jobs', '/money', '/reports', '/more', '/earnings'].includes(location.pathname);
  const isFullscreenFlow = location.pathname === '/bills/new';
  const isFabRoute = (location.pathname === '/' || location.pathname === '/bills') && !isFullscreenFlow;

  const getInnerScreenTitle = (pathname: string): string => {
    if (pathname === '/bills/new') return 'New Bill';
    if (pathname.includes('/bills/') && pathname.includes('/edit')) return 'Edit Bill';
    if (pathname.startsWith('/customers')) return 'Customers';
    if (pathname.startsWith('/services')) return 'Services';
    if (pathname.startsWith('/reports')) return 'Reports';
    if (pathname.startsWith('/staff')) return 'Staff & Commission';
    if (pathname.startsWith('/settings')) return 'Settings';
    if (pathname.startsWith('/profile')) return 'My Profile';
    if (pathname.startsWith('/deleted')) return 'Recently Deleted';
    return 'Back';
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const currentScrollTop = e.currentTarget.scrollTop;
    if (currentScrollTop > lastScrollTop.current + 12 && currentScrollTop > 60) {
      setIsFabVisible(false);
    } else if (currentScrollTop < lastScrollTop.current - 12) {
      setIsFabVisible(true);
    }
    lastScrollTop.current = currentScrollTop;
  };

  // Desktop sidebar collapse state
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('simplify_sidebar_collapsed') === 'true';
  });

  const [isMobileProfileOpen, setIsMobileProfileOpen] = useState(false);

  // Mobile FAB visibility and keyboard detection
  const [isFabVisible, setIsFabVisible] = useState(true);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const lastScrollTop = useRef(0);
  const mainViewportRef = useRef<HTMLDivElement>(null);

  const { isCommandPaletteOpen, setCommandPaletteOpen, isShortcutsHelpOpen, setShortcutsHelpOpen } = useKeyboardShortcuts();

  // Logout confirm dialog state
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem('simplify_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  // Detect virtual keyboard to hide nav
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const handleResize = () => {
      const isKeyboard = viewport.height < window.innerHeight * 0.75;
      setIsKeyboardOpen(isKeyboard);
    };
    viewport.addEventListener('resize', handleResize);
    return () => viewport.removeEventListener('resize', handleResize);
  }, []);

  // Keyboard shortcut ⌘B / Ctrl+B for sidebar toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
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

  if (loading) {
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
    if (to === '/profile') {
      return location.pathname.startsWith('/profile');
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
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/services', label: 'Services', icon: Sparkles },
      { to: '/earnings', label: 'Earnings', icon: Coins },
    ]
    : [
      { to: '/', label: t('nav.home'), icon: LayoutDashboard, exact: true },
      { to: '/bills/new', label: t('nav.new_bill'), icon: PlusCircle, exact: true },
      { to: '/bills', label: t('nav.bills'), icon: FileText },
      { to: '/money', label: t('nav.money'), icon: IndianRupee },
      ...(business?.job_management_enabled
        ? [{ to: '/jobs', label: t('nav.jobs'), icon: Briefcase }]
        : []),
      { to: '/reports', label: t('nav.reports'), icon: BarChart3 },
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
      { to: '/money', label: t('nav.money'), icon: IndianRupee },
      ...(business?.job_management_enabled
        ? [{ to: '/jobs', label: t('nav.jobs'), icon: Briefcase }]
        : []),
      { to: '/reports', label: t('nav.reports'), icon: BarChart3 },
      { to: '/more', label: t('nav.more'), icon: Menu },
    ];

  // Sidebar content (Quiet Luxury: 248px desktop)
  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-white select-none">
      {/* Brand Header */}
      <div className="h-[72px] px-5 flex items-center justify-between bg-white flex-shrink-0">
        <div
          className="flex items-center gap-2.5 cursor-pointer ml-1.5"
          onClick={() => navigate('/')}
        >
          <img
            src="/simplify-logo.png"
            alt="SIMPLIFY"
            className="h-[44px] w-auto object-contain select-none"
          />
        </div>

        {/* Toggle / Close */}
        <button
          onClick={() => setIsCollapsed(true)}
          title="Collapse Sidebar (Ctrl+B)"
          aria-label="Collapse sidebar"
          className="p-1.5 rounded-control text-text-muted hover:text-text hover:bg-surface-2 transition-colors flex-shrink-0"
        >
          <PanelLeftClose className="w-5 h-5 stroke-[1.8]" />
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

        <div
          onClick={() => {
            navigate('/profile');
          }}
          title="My Profile & Security Settings"
          className={clsx(
            'flex items-center justify-between gap-2 p-2 rounded-xl transition-all cursor-pointer group select-none border-0',
            location.pathname === '/profile'
              ? 'bg-[#EAF2F1] text-[#0F766E] font-medium shadow-[0_1px_2px_rgba(15,118,110,0.05)]'
              : 'hover:bg-surface-2 text-text'
          )}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={clsx(
                'w-8 h-8 rounded-full text-[12.5px] font-semibold flex items-center justify-center shrink-0 transition-colors',
                location.pathname === '/profile'
                  ? 'bg-[#0F766E] text-white shadow-2xs'
                  : 'bg-[#EAF2F1] text-[#0F766E] group-hover:bg-[#D5E6E3]'
              )}
            >
              {(member?.name || 'User')
                .split(' ')
                .map((n: string) => n[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[13.5px] font-semibold truncate group-hover:text-[#0F766E] transition-colors">
                {member?.name || (isStaff ? 'Staff' : 'Owner')}
              </div>
              <div className="text-[11.5px] text-text-muted capitalize truncate">
                {member?.role ? member.role.toLowerCase() : 'Owner'} · Profile
              </div>
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSignOut();
            }}
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
    <div className="flex h-screen max-h-[100dvh] w-full max-w-full overflow-x-hidden overflow-y-hidden bg-[#F6F7F9] text-text">
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
              <div
                onClick={() => navigate('/profile')}
                title="My Profile & Security"
                className={clsx(
                  'cursor-pointer rounded-full transition-all p-0.5',
                  location.pathname === '/profile'
                    ? 'ring-2 ring-[#0F766E]'
                    : 'hover:opacity-85'
                )}
              >
                <Avatar name={member?.name || 'User'} size="sm" />
              </div>
            </div>
          </div>
        ) : (
          renderSidebarContent()
        )}
      </aside>

      {/* 2. Main Workspace */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F6F7F9]">
        {/* Top Header Bar */}
        <header className="bg-white md:bg-[#F6F7F9] flex flex-col flex-shrink-0 z-20 border-b border-divider md:border-b-0 print:hidden">
          {/* Mobile Top Bar (h-14, safe-area-top) */}
          <div className="md:hidden h-14 pt-[env(safe-area-inset-top)] px-3.5 flex items-center justify-between w-full">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {isRootScreen ? (
                <div
                  onClick={() => navigate('/')}
                  className="flex items-center cursor-pointer select-none"
                  title="SIMPLIFY"
                >
                  <img
                    src="/simplify-logo.png"
                    alt="SIMPLIFY"
                    className="h-[34px] w-auto object-contain"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    onClick={() => navigate(-1)}
                    aria-label="Go back"
                    className="w-10 h-10 -ml-1 rounded-xl text-text hover:bg-surface-2 transition-colors flex items-center justify-center shrink-0"
                  >
                    <ChevronLeft className="w-5 h-5 stroke-[2.2]" />
                  </button>
                  <span className="text-[17px] font-semibold text-text truncate">
                    {getInnerScreenTitle(location.pathname)}
                  </span>
                </div>
              )}
            </div>

            {/* Mobile Top Right Actions (Search icon + Avatar tile) */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
                aria-label="Search"
                title="Search"
              >
                <Search className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setIsMobileProfileOpen(true)}
                className="w-8 h-8 rounded-xl bg-ink text-white font-bold text-xs flex items-center justify-center shadow-2xs active:scale-95 transition-all ml-1"
                aria-label="Business Profile"
                title={business?.name || 'Business'}
              >
                {(business?.name || 'B')[0].toUpperCase()}
              </button>
            </div>
          </div>

          {/* Desktop Top Bar (h-[72px], unchanged desktop layout) */}
          <div className="hidden md:flex h-[72px] px-6 items-center justify-between gap-3 w-full">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {/* Desktop Global Search Pill (440px, ⌘K hint) */}
              <div
                onClick={() => setCommandPaletteOpen(true)}
                className="flex items-center justify-between w-full max-w-[440px] h-[40px] px-3.5 rounded-xl bg-white border-0 text-[13.5px] text-text-muted hover:bg-[#F8FAFC] transition-all cursor-pointer select-none shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.06)]"
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
              <div
                onClick={() => {
                  if (!isStaff) navigate('/settings');
                }}
                className={clsx(
                  'flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-white border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] select-none',
                  isStaff
                    ? 'cursor-default'
                    : 'hover:bg-[#F8FAFC] hover:shadow-[0_4px_14px_rgba(0,0,0,0.06)] active:scale-[0.98] cursor-pointer transition-all'
                )}
              >
                <div className="w-6 h-6 rounded-lg bg-[#111827] text-white text-[12px] font-bold flex items-center justify-center shrink-0">
                  {(business?.name || 'B')[0].toUpperCase()}
                </div>
                <span className="text-[13.5px] font-medium text-text truncate max-w-[140px]">
                  {business?.name || 'B Services'}
                </span>
                {!isStaff && <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content Viewport */}
        <div
          ref={mainViewportRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 lg:p-8 pb-36 md:pb-8 bg-[#F6F7F9] print:p-0 print:m-0 print:overflow-visible print:bg-white"
        >
          <Outlet />
        </div>

        {/* Floating "+ Bill" button on mobile (56px circle, ink, --sh-btn) - Only on Home and Bills, hides on scroll */}
        {isFabRoute && !isFullscreenFlow && !isKeyboardOpen && (
          <button
            onClick={() => navigate('/bills/new')}
            aria-label={t('nav.new_bill')}
            className={clsx(
              'md:hidden fixed right-4 bottom-20 z-40 w-14 h-14 rounded-full bg-ink text-white shadow-btn flex items-center justify-center active:scale-95 transition-all duration-300 print:hidden',
              isFabVisible ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0 pointer-events-none'
            )}
          >
            <Plus className="w-6 h-6 stroke-[2.2]" />
          </button>
        )}

        {/* Mobile Bottom Navigation (64px, safe area) - max 5 items, hides during typing and full-screen flows */}
        {!isFullscreenFlow && !isKeyboardOpen && (
          <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 pb-[env(safe-area-inset-bottom)] bg-white/95 backdrop-blur-md border-t border-divider flex items-center justify-around px-2 print:hidden">
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
        )}
      </main>

      {/* Mobile Profile & Quick Settings Bottom Sheet */}
      <MobileProfileSheet
        open={isMobileProfileOpen}
        onOpenChange={setIsMobileProfileOpen}
        onLogoutClick={() => setLogoutDialogOpen(true)}
      />

      {/* Global Command Palette */}
      <CommandPalette open={isCommandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

      {/* Global Keyboard Shortcuts Help Modal */}
      <KeyboardShortcutsModal open={isShortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />

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
