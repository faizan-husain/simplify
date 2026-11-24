import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { PwaProvider, usePwa } from '../PwaContext';

// Test consumer component
const TestConsumer: React.FC = () => {
  const { isInstalled, installStatus, canPromptInstall, platform, promptInstall, isModalOpen } = usePwa();
  return (
    <div>
      <div data-testid="installed">{String(isInstalled)}</div>
      <div data-testid="status">{installStatus}</div>
      <div data-testid="canPrompt">{String(canPromptInstall)}</div>
      <div data-testid="isIOS">{String(platform.isIOS)}</div>
      <div data-testid="isIOSSafari">{String(platform.isIOSSafari)}</div>
      <div data-testid="modalOpen">{String(isModalOpen)}</div>
      <button onClick={() => promptInstall()}>Trigger Install</button>
    </div>
  );
};

describe('PwaContext Installation & Detection', () => {
  let listeners: Record<string, EventListenerOrEventListenerObject[]> = {};

  beforeEach(() => {
    localStorage.clear();
    delete (window as any).__isSimplifyInstalled;
    delete (window as any).__deferredInstallPrompt;
    listeners = {};
    vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((event, handler) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    });

    // Default: not standalone
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects uninstalled state by default', () => {
    render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    expect(screen.getByTestId('installed').textContent).toBe('false');
    expect(screen.getByTestId('canPrompt').textContent).toBe('false');
  });

  it('detects standalone mode when window.matchMedia matches standalone', () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    expect(screen.getByTestId('installed').textContent).toBe('true');
    expect(screen.getByTestId('status').textContent).toBe('INSTALLED');
  });

  it('captures beforeinstallprompt event and enables prompt flow', async () => {
    render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    const mockPrompt = vi.fn().mockResolvedValue(undefined);
    const mockChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    const mockEvent = new Event('beforeinstallprompt') as any;
    mockEvent.prompt = mockPrompt;
    mockEvent.userChoice = mockChoice;
    mockEvent.preventDefault = vi.fn();

    // Trigger event
    act(() => {
      listeners['beforeinstallprompt']?.forEach((fn) => {
        if (typeof fn === 'function') fn(mockEvent);
      });
    });

    expect(screen.getByTestId('canPrompt').textContent).toBe('true');
    expect(screen.getByTestId('status').textContent).toBe('AVAILABLE');

    // Trigger installation
    await act(async () => {
      screen.getByText('Trigger Install').click();
    });

    expect(mockPrompt).toHaveBeenCalled();
    expect(screen.getByTestId('installed').textContent).toBe('true');
    expect(screen.getByTestId('status').textContent).toBe('INSTALLED');
  });

  it('updates state to INSTALLED when appinstalled event fires', () => {
    render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    expect(screen.getByTestId('installed').textContent).toBe('false');

    act(() => {
      listeners['appinstalled']?.forEach((fn) => {
        if (typeof fn === 'function') fn(new Event('appinstalled'));
      });
    });

    expect(screen.getByTestId('installed').textContent).toBe('true');
    expect(screen.getByTestId('status').textContent).toBe('INSTALLED');
  });

  it('opens instructions modal when prompt is unavailable (e.g. on iOS Safari)', async () => {
    render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    expect(screen.getByTestId('modalOpen').textContent).toBe('false');

    await act(async () => {
      screen.getByText('Trigger Install').click();
    });

    expect(screen.getByTestId('modalOpen').textContent).toBe('true');
  });

  it('ignores stale localStorage flag and keeps isInstalled false in browser mode', () => {
    localStorage.setItem('simplify_pwa_installed', 'true');

    render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    // Stale localStorage flag MUST NOT mark the app as permanently installed
    expect(screen.getByTestId('installed').textContent).toBe('false');
    expect(screen.getByTestId('status').textContent).not.toBe('INSTALLED');
  });

  it('supports uninstall and reinstall lifecycle without blocking the user', async () => {
    // 1. Initial browser visit: not installed
    const { unmount } = render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    expect(screen.getByTestId('installed').textContent).toBe('false');

    // 2. First install prompt arrives and user installs
    const mockPrompt1 = vi.fn().mockResolvedValue(undefined);
    const mockEvent1 = new Event('beforeinstallprompt') as any;
    mockEvent1.prompt = mockPrompt1;
    mockEvent1.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    mockEvent1.preventDefault = vi.fn();

    act(() => {
      listeners['beforeinstallprompt']?.forEach((fn) => {
        if (typeof fn === 'function') fn(mockEvent1);
      });
    });

    expect(screen.getByTestId('canPrompt').textContent).toBe('true');

    await act(async () => {
      screen.getByText('Trigger Install').click();
    });

    expect(mockPrompt1).toHaveBeenCalled();
    expect(screen.getByTestId('installed').textContent).toBe('true');

    // 3. Simulate user uninstalled from Android home screen and reopened website in Chrome
    unmount();
    listeners = {};

    render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    // User is in browser mode, app is NOT marked installed!
    expect(screen.getByTestId('installed').textContent).toBe('false');

    // 4. Chrome makes beforeinstallprompt available again for reinstall
    const mockPrompt2 = vi.fn().mockResolvedValue(undefined);
    const mockEvent2 = new Event('beforeinstallprompt') as any;
    mockEvent2.prompt = mockPrompt2;
    mockEvent2.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    mockEvent2.preventDefault = vi.fn();

    act(() => {
      listeners['beforeinstallprompt']?.forEach((fn) => {
        if (typeof fn === 'function') fn(mockEvent2);
      });
    });

    // Reinstall prompt is ready and enabled!
    expect(screen.getByTestId('canPrompt').textContent).toBe('true');
    expect(screen.getByTestId('status').textContent).toBe('AVAILABLE');

    // 5. User reinstalls successfully
    await act(async () => {
      screen.getByText('Trigger Install').click();
    });

    expect(mockPrompt2).toHaveBeenCalled();
    expect(screen.getByTestId('installed').textContent).toBe('true');
    expect(screen.getByTestId('status').textContent).toBe('INSTALLED');
  });

  it('handles beforeinstallprompt unavailable initially and becoming available later', () => {
    render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    // Initially prompt is not ready
    expect(screen.getByTestId('canPrompt').textContent).toBe('false');
    expect(screen.getByTestId('status').textContent).toBe('INSTRUCTIONS_NEEDED');

    // Later, Chrome fires beforeinstallprompt
    const mockEvent = new Event('beforeinstallprompt') as any;
    mockEvent.prompt = vi.fn().mockResolvedValue(undefined);
    mockEvent.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
    mockEvent.preventDefault = vi.fn();

    act(() => {
      listeners['beforeinstallprompt']?.forEach((fn) => {
        if (typeof fn === 'function') fn(mockEvent);
      });
    });

    // Prompt is now captured and ready
    expect(screen.getByTestId('canPrompt').textContent).toBe('true');
    expect(screen.getByTestId('status').textContent).toBe('AVAILABLE');
  });

  it('re-evaluates installation state when window gains focus or visibility changes', () => {
    render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    expect(screen.getByTestId('installed').textContent).toBe('false');

    // Simulate transition to standalone mode while app was running
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    // Trigger focus event
    act(() => {
      listeners['focus']?.forEach((fn) => {
        if (typeof fn === 'function') fn(new Event('focus'));
      });
    });

    expect(screen.getByTestId('installed').textContent).toBe('true');
    expect(screen.getByTestId('status').textContent).toBe('INSTALLED');
  });
});
