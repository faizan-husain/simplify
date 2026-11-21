import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Search,
  Plus,
  FileText,
  User,
  Receipt,
  BarChart3,
  Settings,
  Briefcase,
  ArrowRight,
  LayoutDashboard,
  IndianRupee,
  CreditCard,
  Building2,
  Sparkles,
  Keyboard,
  Coins,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { Kbd } from '../ui/Kbd';
import { clsx } from 'clsx';
import { useAuth } from '../../context/AuthContext';
import { useKeyboardShortcuts } from '../../context/KeyboardShortcutContext';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PaletteCommand {
  id: string;
  label: string;
  sublabel?: string;
  category: 'Navigation' | 'Actions' | 'Help & Settings';
  shortcut?: string;
  icon: React.ReactNode;
  action: () => void;
  ownerOnly?: boolean;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onOpenChange }) => {
  const navigate = useNavigate();
  const { member, business } = useAuth();
  const { setShortcutsHelpOpen } = useKeyboardShortcuts();
  const isStaff = member?.role === 'STAFF';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{
    customers: any[];
    invoices: any[];
    receipts: any[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // All application commands with role awareness
  const baseCommands: PaletteCommand[] = useMemo(() => {
    const list: PaletteCommand[] = [
      // --- Navigation Commands ---
      {
        id: 'nav-dashboard',
        label: isStaff ? 'Open My Dashboard' : 'Open Dashboard',
        sublabel: 'View business summary & daily overview',
        category: 'Navigation',
        shortcut: 'Alt + D',
        icon: <LayoutDashboard className="w-4 h-4 text-[#0F766E]" />,
        action: () => {
          onOpenChange(false);
          navigate('/');
        },
      },
      {
        id: 'nav-new-bill',
        label: 'Create New Bill',
        sublabel: 'Fast POS invoice creation',
        category: 'Actions',
        shortcut: 'Alt + N',
        icon: <Plus className="w-4 h-4 text-emerald-600" />,
        action: () => {
          onOpenChange(false);
          navigate('/bills/new');
        },
      },
      {
        id: 'nav-bills',
        label: 'Open Invoices & Bills',
        sublabel: 'Search bills, dues & print invoices',
        category: 'Navigation',
        shortcut: 'Alt + B',
        icon: <FileText className="w-4 h-4 text-slate-600" />,
        action: () => {
          onOpenChange(false);
          navigate('/bills');
        },
      },
      ...(business?.job_management_enabled
        ? [
            {
              id: 'nav-jobs',
              label: 'Open Jobs Tracker',
              sublabel: 'Track service steps, deadlines & applicants',
              category: 'Navigation' as const,
              shortcut: 'Alt + J',
              icon: <Briefcase className="w-4 h-4 text-amber-600" />,
              action: () => {
                onOpenChange(false);
                navigate('/jobs');
              },
            },
          ]
        : []),
      {
        id: 'nav-customers',
        label: 'Open Customers Directory',
        sublabel: 'Customer ledger, dues & transaction history',
        category: 'Navigation',
        shortcut: 'Alt + C',
        icon: <User className="w-4 h-4 text-blue-600" />,
        action: () => {
          onOpenChange(false);
          navigate('/customers');
        },
      },
      {
        id: 'nav-services',
        label: 'Open Services & Rates',
        sublabel: 'Manage billable services & default prices',
        category: 'Navigation',
        shortcut: 'Alt + S',
        icon: <Sparkles className="w-4 h-4 text-purple-600" />,
        action: () => {
          onOpenChange(false);
          navigate('/services');
        },
      },
      // Owner only commands
      ...(!isStaff
        ? [
            {
              id: 'nav-money',
              label: 'Open Money (Receipts & Dues)',
              sublabel: 'Customer receipts, vendor payments & ledger',
              category: 'Navigation' as const,
              shortcut: 'Alt + M',
              icon: <IndianRupee className="w-4 h-4 text-emerald-700" />,
              action: () => {
                onOpenChange(false);
                navigate('/money');
              },
              ownerOnly: true,
            },
            {
              id: 'action-receive-payment',
              label: 'Receive Payment / New Receipt',
              sublabel: 'Record incoming payment against invoices',
              category: 'Actions' as const,
              icon: <Receipt className="w-4 h-4 text-emerald-600" />,
              action: () => {
                onOpenChange(false);
                navigate('/money?tab=receipts&action=new');
              },
              ownerOnly: true,
            },
            {
              id: 'action-new-expense',
              label: 'Record Business Expense',
              sublabel: 'Log rent, electricity, tea, salary or overhead',
              category: 'Actions' as const,
              icon: <CreditCard className="w-4 h-4 text-rose-600" />,
              action: () => {
                onOpenChange(false);
                navigate('/money?tab=expenses&action=new');
              },
              ownerOnly: true,
            },
            {
              id: 'action-vendor-payment',
              label: 'Record Vendor Payment',
              sublabel: 'Log payments made to external suppliers & vendors',
              category: 'Actions' as const,
              icon: <Building2 className="w-4 h-4 text-indigo-600" />,
              action: () => {
                onOpenChange(false);
                navigate('/money?tab=payments&action=new');
              },
              ownerOnly: true,
            },
            {
              id: 'nav-reports',
              label: 'Open Business Reports',
              sublabel: 'P&L, Monthly Cashflow, Tax & Audit reports',
              category: 'Navigation' as const,
              shortcut: 'Alt + R',
              icon: <BarChart3 className="w-4 h-4 text-cyan-600" />,
              action: () => {
                onOpenChange(false);
                navigate('/reports');
              },
              ownerOnly: true,
            },
            {
              id: 'nav-staff',
              label: 'Open Staff & Commission',
              sublabel: 'Manage team logins, salaries and payouts',
              category: 'Navigation' as const,
              icon: <Coins className="w-4 h-4 text-amber-600" />,
              action: () => {
                onOpenChange(false);
                navigate('/staff');
              },
              ownerOnly: true,
            },
            {
              id: 'nav-settings',
              label: 'Open Business Settings',
              sublabel: 'Configure invoice numbering, UPI, theme and team',
              category: 'Help & Settings' as const,
              icon: <Settings className="w-4 h-4 text-slate-600" />,
              action: () => {
                onOpenChange(false);
                navigate('/settings');
              },
              ownerOnly: true,
            },
          ]
        : [
            {
              id: 'nav-earnings',
              label: 'My Earnings & Commission',
              sublabel: 'View your completed jobs, commission and salary payouts',
              category: 'Navigation' as const,
              icon: <Coins className="w-4 h-4 text-amber-600" />,
              action: () => {
                onOpenChange(false);
                navigate('/earnings');
              },
            },
          ]),
      {
        id: 'help-shortcuts-cmd',
        label: 'Keyboard Shortcuts Reference',
        sublabel: 'View all keyboard shortcuts and Tally-style keys',
        category: 'Help & Settings',
        shortcut: '?',
        icon: <Keyboard className="w-4 h-4 text-slate-600" />,
        action: () => {
          onOpenChange(false);
          setShortcutsHelpOpen(true);
        },
      },
    ];

    return list;
  }, [isStaff, business?.job_management_enabled, navigate, onOpenChange, setShortcutsHelpOpen]);

  // Filter commands by text
  const matchingCommands = useMemo(() => {
    if (!query.trim()) return baseCommands;
    const q = query.toLowerCase();
    return baseCommands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.sublabel && c.sublabel.toLowerCase().includes(q)) ||
        (c.shortcut && c.shortcut.toLowerCase().includes(q))
    );
  }, [baseCommands, query]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search for bills, customers, receipts
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('global_search', { q: query.trim() });
        if (!error && data) {
          setResults(data);
        }
      } catch (err) {
        console.error('CommandPalette search error:', err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  // Unified selectable list
  const selectableItems = useMemo(() => {
    const items: {
      id: string;
      label: string;
      sublabel?: string;
      category: string;
      shortcut?: string;
      icon: React.ReactNode;
      action: () => void;
    }[] = [];

    // 1. Add matching commands
    matchingCommands.forEach((c) => {
      items.push({
        id: `cmd-${c.id}`,
        label: c.label,
        sublabel: c.sublabel,
        category: c.category,
        shortcut: c.shortcut,
        icon: c.icon,
        action: c.action,
      });
    });

    // 2. Add search results if present
    if (query.trim().length >= 2 && results) {
      results.invoices?.forEach((inv) => {
        items.push({
          id: `inv-${inv.id}`,
          label: `${inv.number} — ${inv.party_name}`,
          sublabel: `Total: ${formatINR(inv.total)}${inv.balance > 0 ? ` • Due: ${formatINR(inv.balance)}` : ''}`,
          category: 'Bills Found',
          icon: <FileText className="w-4 h-4 text-emerald-600" />,
          action: () => {
            onOpenChange(false);
            navigate('/bills');
          },
        });
      });

      results.customers?.forEach((c) => {
        items.push({
          id: `cust-${c.id}`,
          label: c.name,
          sublabel: c.mobile ? `Mobile: ${c.mobile}` : undefined,
          category: 'Customers Found',
          icon: <User className="w-4 h-4 text-blue-600" />,
          action: () => {
            onOpenChange(false);
            navigate('/customers');
          },
        });
      });

      if (!isStaff && results.receipts) {
        results.receipts.forEach((r) => {
          items.push({
            id: `rec-${r.id}`,
            label: `Receipt ${r.number} — ${formatINR(r.amount)}`,
            sublabel: `${formatDate(r.receipt_date)} • ${r.mode}`,
            category: 'Receipts Found',
            icon: <Receipt className="w-4 h-4 text-purple-600" />,
            action: () => {
              onOpenChange(false);
              navigate('/money');
            },
          });
        });
      }
    }

    return items;
  }, [matchingCommands, query, results, isStaff, onOpenChange, navigate]);

  // Adjust activeIndex if out of bounds
  useEffect(() => {
    if (activeIndex >= selectableItems.length) {
      setActiveIndex(Math.max(0, selectableItems.length - 1));
    }
  }, [selectableItems.length, activeIndex]);

  // Keyboard navigation within palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % Math.max(1, selectableItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? selectableItems.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectableItems[activeIndex]) {
        selectableItems[activeIndex].action();
      }
    } else if (e.key === 'Escape') {
      onOpenChange(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#111827]/40 backdrop-blur-[2px] animate-in fade-in duration-200" />
        <DialogPrimitive.Content
          onKeyDown={handleKeyDown}
          className="fixed left-[50%] top-[12%] sm:top-[16%] z-50 w-[calc(100%-2rem)] sm:w-full max-w-[580px] max-h-[85vh] flex flex-col translate-x-[-50%] rounded-[24px] bg-white shadow-pop border border-hair duration-200 animate-in zoom-in-95 overflow-hidden focus:outline-none"
        >
          {/* Search Header */}
          <div className="flex items-center px-4 h-14 border-b border-divider gap-3 bg-white">
            <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              placeholder="Type a command, bill no, or customer name..."
              className="flex-1 bg-transparent border-0 outline-none text-[14px] text-text placeholder:text-placeholder focus:ring-0 shadow-none"
            />
            {loading && (
              <span className="text-[11px] text-text-muted animate-pulse font-medium">Searching...</span>
            )}
            <Kbd>ESC</Kbd>
          </div>

          {/* List Content */}
          <div className="max-h-[400px] overflow-y-auto p-2 space-y-1">
            {selectableItems.length > 0 ? (
              selectableItems.map((item, index) => {
                const isActive = index === activeIndex;

                return (
                  <div
                    key={item.id}
                    onClick={item.action}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={clsx(
                      'flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer select-none transition-all text-[13.5px]',
                      isActive
                        ? 'bg-[#EAF2F1] text-text font-medium shadow-2xs'
                        : 'text-[#4B5563] hover:text-text hover:bg-surface-2'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex-shrink-0">{item.icon}</div>
                      <div className="flex flex-col min-w-0 flex-1 leading-snug">
                        <div className="flex items-center gap-2">
                          <span className={clsx('truncate', isActive ? 'text-[#0F766E] font-semibold' : 'text-text font-medium')}>
                            {item.label}
                          </span>
                          {item.category.includes('Found') && (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">
                              {item.category.replace(' Found', '')}
                            </span>
                          )}
                        </div>
                        {item.sublabel && (
                          <span className="text-[12px] text-text-muted truncate mt-0.5">
                            {item.sublabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      {item.shortcut && (
                        <Kbd className="text-[10.5px] font-semibold text-slate-600 bg-white border border-slate-200">
                          {item.shortcut}
                        </Kbd>
                      )}
                      {isActive && (
                        <ArrowRight className="w-3.5 h-3.5 text-[#0F766E]" />
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-12 text-center text-[13px] text-text-muted">
                No matching commands or records found for &ldquo;{query}&rdquo;
              </div>
            )}
          </div>

          {/* Footer Shortcuts Bar */}
          <div className="px-4 py-2.5 bg-[#F9FAFB] border-t border-divider flex items-center justify-between text-[11.5px] text-text-muted">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> Navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> Select
              </span>
              <span className="flex items-center gap-1">
                <Kbd>?</Kbd> Shortcuts Help
              </span>
            </div>
            <span className="text-[11px] font-medium text-[#0F766E]">SIMPLIFY Tally Keyboard</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
