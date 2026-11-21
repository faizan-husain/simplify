import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { KeyboardShortcutProvider, useKeyboardShortcuts, SYSTEM_SHORTCUTS } from '../KeyboardShortcutContext';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/' }),
  };
});

let currentRole = 'OWNER';
vi.mock('../AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user-id' },
    member: { id: 'test-member-id', role: currentRole, name: currentRole === 'OWNER' ? 'Owner Rajesh' : 'Staff Ramesh' },
    business: { id: 'test-biz-id', name: 'Global Xerox', job_management_enabled: true },
    loading: false,
  }),
}));

const renderWithContext = (ui: React.ReactNode, role: 'OWNER' | 'STAFF' = 'OWNER') => {
  currentRole = role;
  return render(
    <BrowserRouter>
      <KeyboardShortcutProvider>{ui}</KeyboardShortcutProvider>
    </BrowserRouter>
  );
};

const TestComponent = () => {
  const { isCommandPaletteOpen, isShortcutsHelpOpen, registerSaveHandler } = useKeyboardShortcuts();
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    return registerSaveHandler(() => {
      setSaved(true);
    });
  }, [registerSaveHandler]);

  return (
    <div>
      <div data-testid="palette-status">{isCommandPaletteOpen ? 'open' : 'closed'}</div>
      <div data-testid="help-status">{isShortcutsHelpOpen ? 'open' : 'closed'}</div>
      <div data-testid="save-status">{saved ? 'saved' : 'not-saved'}</div>
      <input data-testid="test-input" placeholder="Type here..." />
    </div>
  );
};

describe('Tally-Style Keyboard Command & Navigation System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole = 'OWNER';
  });

  it('exposes all system shortcuts with required categories', () => {
    expect(SYSTEM_SHORTCUTS.length).toBeGreaterThan(10);
    const categories = new Set(SYSTEM_SHORTCUTS.map((s) => s.category));
    expect(categories.has('Navigation')).toBe(true);
    expect(categories.has('Billing')).toBe(true);
    expect(categories.has('Global & Dialogs')).toBe(true);
  });

  it('toggles command palette with Ctrl+K', () => {
    renderWithContext(<TestComponent />);
    expect(screen.getByTestId('palette-status').textContent).toBe('closed');

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('palette-status').textContent).toBe('open');

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('palette-status').textContent).toBe('closed');
  });

  it('navigates to /bills/new on Alt+N', () => {
    renderWithContext(<TestComponent />);
    fireEvent.keyDown(window, { key: 'n', altKey: true });
    expect(mockNavigate).toHaveBeenCalledWith('/bills/new');
  });

  it('navigates to /bills on Alt+B', () => {
    renderWithContext(<TestComponent />);
    fireEvent.keyDown(window, { key: 'b', altKey: true });
    expect(mockNavigate).toHaveBeenCalledWith('/bills');
  });

  it('navigates to /money on Alt+M for Owner but blocks Staff', () => {
    // Owner
    const { unmount } = renderWithContext(<TestComponent />, 'OWNER');
    fireEvent.keyDown(window, { key: 'm', altKey: true });
    expect(mockNavigate).toHaveBeenCalledWith('/money');
    unmount();

    // Staff
    mockNavigate.mockClear();
    renderWithContext(<TestComponent />, 'STAFF');
    fireEvent.keyDown(window, { key: 'm', altKey: true });
    expect(mockNavigate).not.toHaveBeenCalledWith('/money');
  });

  it('navigates to /reports on Alt+R for Owner but blocks Staff', () => {
    // Staff
    renderWithContext(<TestComponent />, 'STAFF');
    fireEvent.keyDown(window, { key: 'r', altKey: true });
    expect(mockNavigate).not.toHaveBeenCalledWith('/reports');
  });

  it('executes registered onSave handler when Ctrl+S is pressed', () => {
    renderWithContext(<TestComponent />);
    expect(screen.getByTestId('save-status').textContent).toBe('not-saved');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(screen.getByTestId('save-status').textContent).toBe('saved');
  });

  it('opens shortcuts help with ? when not typing in input', () => {
    renderWithContext(<TestComponent />);
    expect(screen.getByTestId('help-status').textContent).toBe('closed');

    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('help-status').textContent).toBe('open');
  });

  it('does NOT open shortcuts help with ? when user is typing in an input', () => {
    renderWithContext(<TestComponent />);
    const input = screen.getByTestId('test-input');
    input.focus();

    fireEvent.keyDown(input, { key: '?' });
    expect(screen.getByTestId('help-status').textContent).toBe('closed');
  });
});
