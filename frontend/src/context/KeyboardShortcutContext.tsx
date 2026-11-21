import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export interface ShortcutItem {
  id: string;
  category: 'Navigation' | 'Billing' | 'Accounting & Jobs' | 'Global & Dialogs';
  keys: string[];
  description: string;
  ownerOnly?: boolean;
  staffAllowed?: boolean;
}

export const SYSTEM_SHORTCUTS: ShortcutItem[] = [
  // Navigation
  { id: 'nav-palette', category: 'Navigation', keys: ['Ctrl', 'K'], description: 'Open Command Palette' },
  { id: 'nav-dashboard', category: 'Navigation', keys: ['Alt', 'D'], description: 'Go to Dashboard' },
  { id: 'nav-new-bill', category: 'Navigation', keys: ['Alt', 'N'], description: 'Create New Bill' },
  { id: 'nav-bills', category: 'Navigation', keys: ['Alt', 'B'], description: 'Go to Invoices & Bills' },
  { id: 'nav-money', category: 'Navigation', keys: ['Alt', 'M'], description: 'Go to Money / Receipts & Dues', ownerOnly: true },
  { id: 'nav-jobs', category: 'Navigation', keys: ['Alt', 'J'], description: 'Go to Job Tracker' },
  { id: 'nav-customers', category: 'Navigation', keys: ['Alt', 'C'], description: 'Go to Customers' },
  { id: 'nav-services', category: 'Navigation', keys: ['Alt', 'S'], description: 'Go to Services' },
  { id: 'nav-reports', category: 'Navigation', keys: ['Alt', 'R'], description: 'Go to Reports', ownerOnly: true },
  { id: 'nav-sidebar', category: 'Navigation', keys: ['Ctrl', 'B'], description: 'Toggle Sidebar Expand/Collapse' },

  // Billing & Forms
  { id: 'form-save', category: 'Billing', keys: ['Ctrl', 'S'], description: 'Save current active Bill / Form' },
  { id: 'form-add-line', category: 'Billing', keys: ['Alt', 'A'], description: 'Add new item row in Bill' },
  { id: 'form-tally-next', category: 'Billing', keys: ['Enter'], description: 'Tally field progression (Service → Qty → Rate → New Line)' },

  // List & Search
  { id: 'list-search', category: 'Global & Dialogs', keys: ['/'], description: 'Focus quick search on page' },
  { id: 'list-nav-arrows', category: 'Global & Dialogs', keys: ['↑', '↓'], description: 'Navigate rows in bills / jobs list' },
  { id: 'list-open-enter', category: 'Global & Dialogs', keys: ['Enter'], description: 'Open selected bill / record' },
  { id: 'dialog-escape', category: 'Global & Dialogs', keys: ['Esc'], description: 'Close active modal, dropdown or palette' },
  { id: 'help-shortcuts', category: 'Global & Dialogs', keys: ['?'], description: 'Open Keyboard Shortcuts Help' },
];

interface KeyboardShortcutContextType {
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  isShortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  registerSaveHandler: (handler: () => void | Promise<void>) => () => void;
  triggerSave: () => void;
  shortcuts: ShortcutItem[];
}

const KeyboardShortcutContext = createContext<KeyboardShortcutContextType | null>(null);

export const KeyboardShortcutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const { member, business } = useAuth();
  const isStaff = member?.role === 'STAFF';

  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isShortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const saveHandlerRef = useRef<(() => void | Promise<void>) | null>(null);

  const registerSaveHandler = useCallback((handler: () => void | Promise<void>) => {
    saveHandlerRef.current = handler;
    return () => {
      if (saveHandlerRef.current === handler) {
        saveHandlerRef.current = null;
      }
    };
  }, []);

  const triggerSave = useCallback(() => {
    if (saveHandlerRef.current) {
      saveHandlerRef.current();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isInputActive =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.isContentEditable);

      // 1. Command Palette: Ctrl+K or Cmd+K (Works anywhere, even inside inputs)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }

      // 2. Save active form: Ctrl+S or Cmd+S (Intercept browser save page)
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (saveHandlerRef.current) {
          saveHandlerRef.current();
        }
        return;
      }

      // 3. Escape key: Close modals / palette
      if (e.key === 'Escape') {
        if (isCommandPaletteOpen) {
          e.preventDefault();
          setCommandPaletteOpen(false);
          return;
        }
        if (isShortcutsHelpOpen) {
          e.preventDefault();
          setShortcutsHelpOpen(false);
          return;
        }
      }

      // 4. Alt-based navigation shortcuts (safe from text input interference)
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        switch (key) {
          case 'n': // New Bill
            e.preventDefault();
            setCommandPaletteOpen(false);
            navigate('/bills/new');
            break;
          case 'd': // Dashboard
            e.preventDefault();
            setCommandPaletteOpen(false);
            navigate('/');
            break;
          case 'b': // Bills
            e.preventDefault();
            setCommandPaletteOpen(false);
            navigate('/bills');
            break;
          case 'm': // Money (Owner only)
            if (!isStaff) {
              e.preventDefault();
              setCommandPaletteOpen(false);
              navigate('/money');
            }
            break;
          case 'j': // Jobs
            if (business?.job_management_enabled) {
              e.preventDefault();
              setCommandPaletteOpen(false);
              navigate('/jobs');
            }
            break;
          case 'c': // Customers
            e.preventDefault();
            setCommandPaletteOpen(false);
            navigate('/customers');
            break;
          case 's': // Services
            e.preventDefault();
            setCommandPaletteOpen(false);
            navigate('/services');
            break;
          case 'r': // Reports (Owner only)
            if (!isStaff) {
              e.preventDefault();
              setCommandPaletteOpen(false);
              navigate('/reports');
            }
            break;
          default:
            break;
        }
        return;
      }

      // 5. Single-key shortcuts (ONLY when NOT typing in an input/textarea)
      if (!isInputActive && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // '?' opens Keyboard Shortcuts Help
        if (e.key === '?') {
          e.preventDefault();
          setShortcutsHelpOpen((prev) => !prev);
          return;
        }

        // '/' focuses page search input
        if (e.key === '/') {
          const searchInput = document.querySelector<HTMLInputElement>(
            'input[type="text"][placeholder*="search" i], input[type="search"]'
          );
          if (searchInput) {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, isStaff, business?.job_management_enabled, isCommandPaletteOpen, isShortcutsHelpOpen]);

  return (
    <KeyboardShortcutContext.Provider
      value={{
        isCommandPaletteOpen,
        setCommandPaletteOpen,
        isShortcutsHelpOpen,
        setShortcutsHelpOpen,
        registerSaveHandler,
        triggerSave,
        shortcuts: SYSTEM_SHORTCUTS,
      }}
    >
      {children}
    </KeyboardShortcutContext.Provider>
  );
};

export const useKeyboardShortcuts = () => {
  const context = useContext(KeyboardShortcutContext);
  if (!context) {
    throw new Error('useKeyboardShortcuts must be used within a KeyboardShortcutProvider');
  }
  return context;
};
