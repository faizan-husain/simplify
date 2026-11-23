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

  it('detects installed state from persistent localStorage flag', () => {
    localStorage.setItem('simplify_pwa_installed', 'true');

    render(
      <PwaProvider>
        <TestConsumer />
      </PwaProvider>
    );

    expect(screen.getByTestId('installed').textContent).toBe('true');
    expect(screen.getByTestId('status').textContent).toBe('INSTALLED');
  });
});
