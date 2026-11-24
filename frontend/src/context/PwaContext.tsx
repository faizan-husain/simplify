import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { registerSW } from 'virtual:pwa-register';

export type PwaInstallStatus =
  | 'INSTALLED'            // Confirmed standalone display-mode or iOS standalone
  | 'AVAILABLE'            // Native browser install prompt captured and ready
  | 'INSTRUCTIONS_NEEDED'  // Needs manual instructions (e.g. iOS Safari, desktop without prompt)
  | 'IN_PROGRESS'          // Installation prompt is active / in progress
  | 'DISMISSED'            // User dismissed native prompt, manual instructions still available
  | 'UNSUPPORTED_IOS';     // Non-Safari browser on iOS (Safari is required by Apple)

export interface PwaContextType {
  isInstalled: boolean;
  canPromptInstall: boolean;
  installStatus: PwaInstallStatus;
  platform: {
    isIOS: boolean;
    isIOSSafari: boolean;
    isIOSOther: boolean;
    isAndroid: boolean;
    isDesktop: boolean;
  };
  promptInstall: () => Promise<boolean>;
  isModalOpen: boolean;
  openInstallModal: () => void;
  closeInstallModal: () => void;
}

const PwaContext = createContext<PwaContextType | null>(null);

export function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  const hasMatchMedia = typeof window.matchMedia === 'function';

  // 1. Standard CSS display-mode standalone, fullscreen, or minimal-ui
  const isDisplayStandalone = hasMatchMedia
    ? window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches
    : false;

  // 2. iOS Safari standalone flag
  const isNavStandalone = Boolean((window.navigator as any).standalone);

  // 3. Android TWA / Home Screen launch referrer
  const isAndroidTWA = typeof document !== 'undefined' && document.referrer.startsWith('android-app://');

  // 4. URL query param (?app=simplify) from manifest start_url
  const isAppUrl = typeof window !== 'undefined' && window.location.search.includes('app=simplify');

  // Never treat a persisted localStorage flag as proof of installation!
  // True installation state must come from real browser standalone display-mode signals.
  return isDisplayStandalone || isNavStandalone || isAndroidTWA || isAppUrl;
}

export const checkIsInstalled = checkIsStandalone;

export const PwaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkIsStandalone());
  const [deferredPrompt, setDeferredPrompt] = useState<any | null>(() => {
    if (typeof window !== 'undefined') {
      return (window as any).__deferredInstallPrompt || null;
    }
    return null;
  });
  const [installStatus, setInstallStatus] = useState<PwaInstallStatus>(() => {
    if (typeof window !== 'undefined' && checkIsStandalone()) return 'INSTALLED';
    if (typeof window !== 'undefined' && (window as any).__deferredInstallPrompt) return 'AVAILABLE';
    return 'INSTRUCTIONS_NEEDED';
  });
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Proactively clear any stale installation flags from previous versions
  useEffect(() => {
    try {
      localStorage.removeItem('simplify_pwa_installed');
    } catch (_) {}
  }, []);

  // Register service worker with auto-update in production
  useEffect(() => {
    // Only register service worker in production builds, NOT on localhost dev server to avoid caching bugs
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      return;
    }

    try {
      registerSW({
        immediate: true,
        onNeedRefresh() {
          console.log('[PWA] Service worker updated, ready to refresh');
        },
        onOfflineReady() {
          console.log('[PWA] Service worker active and offline-ready');
        },
      });
    } catch (err) {
      console.warn('[PWA] Service worker registration error:', err);
    }
  }, []);

  // Platform detection
  const platform = useMemo(() => {
    if (typeof window === 'undefined') {
      return { isIOS: false, isIOSSafari: false, isIOSOther: false, isAndroid: false, isDesktop: true };
    }
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    // Chrome on iOS uses CriOS, Firefox uses FxiOS, Edge uses EdgiOS, Opera uses OPiOS
    const isNonSafariIOS = /CriOS|FxiOS|OPiOS|EdgiOS|mercury/i.test(ua);
    const isIOSSafari = isIOS && !isNonSafariIOS && /WebKit/i.test(ua);
    const isIOSOther = isIOS && isNonSafariIOS;
    const isAndroid = /Android/i.test(ua);
    const isDesktop = !isIOS && !isAndroid;

    return {
      isIOS,
      isIOSSafari,
      isIOSOther,
      isAndroid,
      isDesktop,
    };
  }, []);

  // Re-evaluate installation signals on demand (load, visibilitychange, focus, modal open)
  const reevaluateState = useCallback(() => {
    const isCurrentlyStandalone = checkIsStandalone();
    setIsInstalled(isCurrentlyStandalone);

    if (isCurrentlyStandalone) {
      setInstallStatus('INSTALLED');
      setDeferredPrompt(null);
      if (typeof window !== 'undefined') {
        (window as any).__deferredInstallPrompt = null;
      }
    } else {
      const cachedPrompt = typeof window !== 'undefined' ? (window as any).__deferredInstallPrompt : null;
      if (cachedPrompt) {
        setDeferredPrompt(cachedPrompt);
        setInstallStatus('AVAILABLE');
      } else {
        setInstallStatus((prev) =>
          prev === 'IN_PROGRESS' || prev === 'DISMISSED' ? prev : 'INSTRUCTIONS_NEEDED'
        );
      }
    }
  }, []);

  // Listen for standalone mode changes, visibility changes, and installation events
  useEffect(() => {
    // 1. Initial detection
    reevaluateState();

    // 2. Media query listener for real-time display-mode transitions
    let mediaQuery: MediaQueryList | null = null;
    let handleMediaChange: ((e: MediaQueryListEvent) => void) | null = null;
    if (typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia('(display-mode: standalone)');
      handleMediaChange = (e: MediaQueryListEvent) => {
        setIsInstalled(e.matches);
        if (e.matches) {
          setInstallStatus('INSTALLED');
          setDeferredPrompt(null);
          if (typeof window !== 'undefined') {
            (window as any).__deferredInstallPrompt = null;
          }
        } else {
          reevaluateState();
        }
      };
      mediaQuery.addEventListener?.('change', handleMediaChange);
    }

    // 3. Focus and Visibility Change re-evaluation (e.g. user uninstalls app, returns to Chrome)
    const handleFocus = () => reevaluateState();
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        reevaluateState();
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    // 4. Capture beforeinstallprompt (Android, Chrome, Edge)
    const syncPrompt = (e?: Event) => {
      const prompt = e || (window as any).__deferredInstallPrompt;
      if (prompt) {
        setDeferredPrompt(prompt);
        setInstallStatus('AVAILABLE');
        setIsInstalled(false); // Browser offers install prompt, so it is eligible for install/reinstall!
        console.log('[PWA] beforeinstallprompt captured and ready');
      }
    };

    // Check early capture from index.html script
    if ((window as any).__deferredInstallPrompt) {
      syncPrompt();
    }

    const handlePromptReady = () => syncPrompt();
    window.addEventListener('simplify:pwa_prompt_ready', handlePromptReady);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).__deferredInstallPrompt = e;
      syncPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 5. Capture appinstalled event
    const handleAppInstalled = () => {
      console.log('[PWA] appinstalled event fired by browser');
      setIsInstalled(true);
      setInstallStatus('INSTALLED');
      setDeferredPrompt(null);
      if (typeof window !== 'undefined') {
        (window as any).__deferredInstallPrompt = null;
      }
      setIsModalOpen(false);
    };
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('simplify:pwa_installed', handleAppInstalled);

    return () => {
      if (mediaQuery && handleMediaChange) {
        mediaQuery.removeEventListener?.('change', handleMediaChange);
      }
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('simplify:pwa_prompt_ready', handlePromptReady);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('simplify:pwa_installed', handleAppInstalled);
    };
  }, [reevaluateState]);

  // Computed status considering platform & prompt state
  const computedStatus: PwaInstallStatus = useMemo(() => {
    if (isInstalled || checkIsStandalone()) return 'INSTALLED';
    if (installStatus === 'IN_PROGRESS') return 'IN_PROGRESS';
    if (deferredPrompt || (typeof window !== 'undefined' && (window as any).__deferredInstallPrompt)) return 'AVAILABLE';
    if (platform.isIOSOther) return 'UNSUPPORTED_IOS';
    if (installStatus === 'DISMISSED') return 'DISMISSED';
    return 'INSTRUCTIONS_NEEDED';
  }, [isInstalled, installStatus, deferredPrompt, platform.isIOSOther]);

  // Prompt install handler
  const promptInstall = useCallback(async (): Promise<boolean> => {
    // If already running in standalone mode, do not prompt
    if (checkIsStandalone()) {
      return true;
    }

    const activePrompt = deferredPrompt || (typeof window !== 'undefined' ? (window as any).__deferredInstallPrompt : null);

    // If native prompt is available (Android, Chrome, Edge desktop)
    if (activePrompt) {
      try {
        setInstallStatus('IN_PROGRESS');
        await activePrompt.prompt();
        const choice = await activePrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          console.log('[PWA] User accepted installation prompt');
          setIsInstalled(true);
          setInstallStatus('INSTALLED');
          setDeferredPrompt(null);
          if (typeof window !== 'undefined') {
            (window as any).__deferredInstallPrompt = null;
          }
          setIsModalOpen(false);
          return true;
        } else {
          console.log('[PWA] User dismissed installation prompt');
          setInstallStatus('DISMISSED');
          return false;
        }
      } catch (err) {
        console.error('[PWA] Error launching install prompt:', err);
        setIsModalOpen(true);
        return false;
      }
    }

    // If native prompt is not available, open the install modal with platform guidance
    setIsModalOpen(true);
    return false;
  }, [deferredPrompt]);

  const openInstallModal = useCallback(() => {
    reevaluateState();
    setIsModalOpen(true);
  }, [reevaluateState]);
  const closeInstallModal = useCallback(() => setIsModalOpen(false), []);

  const value = useMemo(
    () => ({
      isInstalled,
      canPromptInstall: !isInstalled && Boolean(deferredPrompt || (typeof window !== 'undefined' && (window as any).__deferredInstallPrompt)),
      installStatus: computedStatus,
      platform,
      promptInstall,
      isModalOpen,
      openInstallModal,
      closeInstallModal,
    }),
    [
      isInstalled,
      deferredPrompt,
      computedStatus,
      platform,
      promptInstall,
      isModalOpen,
      openInstallModal,
      closeInstallModal,
    ]
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
};

export const usePwa = (): PwaContextType => {
  const ctx = useContext(PwaContext);
  if (!ctx) {
    throw new Error('usePwa must be used within a PwaProvider');
  }
  return ctx;
};
