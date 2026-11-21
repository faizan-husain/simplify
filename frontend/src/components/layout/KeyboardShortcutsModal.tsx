import React, { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Keyboard, X, Search, Sparkles, Navigation, FileText, IndianRupee, Command } from 'lucide-react';
import { Kbd } from '../ui/Kbd';
import { useAuth } from '../../context/AuthContext';
import { SYSTEM_SHORTCUTS, ShortcutItem } from '../../context/KeyboardShortcutContext';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ open, onOpenChange }) => {
  const { member } = useAuth();
  const isStaff = member?.role === 'STAFF';
  const [search, setSearch] = useState('');

  const visibleShortcuts = SYSTEM_SHORTCUTS.filter((s) => {
    if (isStaff && s.ownerOnly) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.description.toLowerCase().includes(q) || s.category.toLowerCase().includes(q) || s.keys.join(' ').toLowerCase().includes(q);
  });

  const categories: ShortcutItem['category'][] = ['Navigation', 'Billing', 'Accounting & Jobs', 'Global & Dialogs'];

  const getCategoryIcon = (cat: ShortcutItem['category']) => {
    switch (cat) {
      case 'Navigation':
        return <Navigation className="w-3.5 h-3.5 text-[#0F766E]" />;
      case 'Billing':
        return <FileText className="w-3.5 h-3.5 text-blue-600" />;
      case 'Accounting & Jobs':
        return <IndianRupee className="w-3.5 h-3.5 text-amber-600" />;
      case 'Global & Dialogs':
        return <Command className="w-3.5 h-3.5 text-slate-600" />;
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#111827]/40 backdrop-blur-[2px] animate-in fade-in duration-200" />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 w-[calc(100%-2rem)] sm:w-full max-w-[620px] max-h-[85vh] flex flex-col translate-x-[-50%] translate-y-[-50%] rounded-[24px] bg-white shadow-pop border border-hair duration-200 animate-in zoom-in-95 overflow-hidden focus:outline-none">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-divider bg-white">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#EAF2F1] text-[#0F766E] flex items-center justify-center flex-shrink-0">
                <Keyboard className="w-5 h-5 stroke-[1.8]" />
              </div>
              <div>
                <h3 className="text-[16px] font-semibold text-text tracking-tight">Keyboard Shortcuts Reference</h3>
                <p className="text-[12px] text-text-muted">Tally-style keyboard workflows to navigate SIMPLIFY at speed</p>
              </div>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Search */}
          <div className="px-6 py-3 border-b border-divider bg-[#F9FAFB] flex items-center gap-2.5">
            <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shortcuts..."
              className="w-full bg-transparent border-0 outline-none text-[13px] text-text placeholder:text-placeholder focus:ring-0"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-[11px] text-text-muted hover:text-text">
                Clear
              </button>
            )}
          </div>

          {/* Shortcuts List */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {categories.map((cat) => {
              const items = visibleShortcuts.filter((s) => s.category === cat);
              if (items.length === 0) return null;

              return (
                <div key={cat} className="space-y-2">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-[#0F766E] uppercase tracking-wider px-1">
                    {getCategoryIcon(cat)}
                    <span>{cat}</span>
                  </div>
                  <div className="rounded-xl border border-divider divide-y divide-divider bg-white overflow-hidden shadow-2xs">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between px-3.5 py-2.5 hover:bg-[#F9FAFB] transition-colors text-[13px]"
                      >
                        <span className="text-[#374151] font-medium">{item.description}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {item.keys.map((k, i) => (
                            <React.Fragment key={i}>
                              <Kbd className="text-[11px] font-semibold px-2 py-0.5 min-w-[24px] text-center bg-white shadow-2xs border border-slate-200">
                                {k}
                              </Kbd>
                              {i < item.keys.length - 1 && <span className="text-slate-400 text-xs">+</span>}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {visibleShortcuts.length === 0 && (
              <div className="py-12 text-center text-[13px] text-text-muted">
                No shortcuts found matching &ldquo;{search}&rdquo;
              </div>
            )}
          </div>

          {/* Footer note */}
          <div className="px-6 py-3 bg-[#F9FAFB] border-t border-divider flex items-center justify-between text-[12px] text-text-muted">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#0F766E]" />
              Tip: Press <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd> anytime to open the Command Palette.
            </span>
            <span className="text-[11px]">Press <Kbd>ESC</Kbd> to close</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
