import React, { useState } from 'react';
import { usePwa } from '../../context/PwaContext';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import {
  Share,
  PlusSquare,
  CheckCircle2,
  Copy,
  Check,
  Download,
} from 'lucide-react';

export const PwaInstallModal: React.FC = () => {
  const { isModalOpen, closeInstallModal, platform, isInstalled, canPromptInstall, promptInstall } = usePwa();
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const handleCopyLink = () => {
    try {
      navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {}
  };

  const handleInstallClick = async () => {
    setInstalling(true);
    setHint(null);
    try {
      const success = await promptInstall();
      if (success) {
        closeInstallModal();
        return;
      }
      // If browser did not provide a direct prompt, show friendly guidance
      if (platform.isIOSSafari) {
        setHint('Tap Share below, then select "Add to Home Screen"');
      } else if (platform.isAndroid) {
        setHint('Tap browser menu (⋮) at top-right and select "Install app"');
      } else {
        setHint('Click the ⊕ Install icon in your browser address bar at the top-right to finish');
      }
    } catch (err) {
      console.error('[PWA] Error during installation prompt:', err);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Dialog
      open={isModalOpen}
      onOpenChange={(open: boolean) => {
        if (!open) {
          setHint(null);
          closeInstallModal();
        }
      }}
      title="Install Simplify App"
      className="sm:max-w-sm border-0 shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
    >
      <div className="space-y-4 p-5 pt-3">
        {/* App Branding Tile */}
        <div className="bg-[#EEF0F3] p-3.5 rounded-2xl flex items-center gap-3.5">
          <img
            src="/pwa-192x192.png"
            alt="Simplify"
            className="w-12 h-12 rounded-xl object-contain bg-white p-1 shadow-2xs shrink-0"
          />
          <div className="min-w-0 flex-1">
            <h4 className="text-base font-bold text-slate-900 leading-tight">Simplify</h4>
            <p className="text-xs text-slate-500 mt-0.5 font-medium leading-snug">
              Made business simple
            </p>
          </div>
        </div>

        {/* 1. Direct prompt ready banner */}
        {canPromptInstall && !isInstalled && (
          <div className="p-3.5 rounded-xl bg-emerald-50 text-emerald-900 text-xs font-medium space-y-1">
            <p className="font-bold text-emerald-950 text-[13px]">Ready to Install</p>
            <p className="text-emerald-800 text-[12px] leading-relaxed">
              Tap <strong>Install App</strong> below to add Simplify directly to your home screen.
            </p>
          </div>
        )}

        {/* 2. iOS Safari: 3 Clean Steps */}
        {platform.isIOSSafari && !isInstalled && !canPromptInstall && (
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F6F7F9] text-xs text-slate-700 font-medium">
              <span className="w-5 h-5 rounded-md bg-white text-slate-900 font-bold flex items-center justify-center shrink-0 shadow-2xs text-[11px]">
                1
              </span>
              <span className="flex items-center gap-1.5">
                Tap Share <Share className="w-3.5 h-3.5 text-blue-600 inline" />
              </span>
            </div>

            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F6F7F9] text-xs text-slate-700 font-medium">
              <span className="w-5 h-5 rounded-md bg-white text-slate-900 font-bold flex items-center justify-center shrink-0 shadow-2xs text-[11px]">
                2
              </span>
              <span className="flex items-center gap-1.5">
                Tap Add to Home Screen <PlusSquare className="w-3.5 h-3.5 text-slate-900 inline" />
              </span>
            </div>

            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F6F7F9] text-xs text-slate-700 font-medium">
              <span className="w-5 h-5 rounded-md bg-white text-slate-900 font-bold flex items-center justify-center shrink-0 shadow-2xs text-[11px]">
                3
              </span>
              <span>Tap Add</span>
            </div>
          </div>
        )}

        {/* 3. iOS Other Browsers */}
        {platform.isIOSOther && !isInstalled && !canPromptInstall && (
          <div className="p-3 rounded-xl bg-amber-50 text-xs text-amber-900 space-y-2">
            <p className="text-xs text-amber-800 font-medium">
              Please open Simplify in Safari to install on your iPhone.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              className="w-full bg-white text-amber-900 border-amber-300 hover:bg-amber-100 font-semibold text-xs"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                  Link Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                  Copy Link for Safari
                </>
              )}
            </Button>
          </div>
        )}

        {/* 4. Android Chrome: 3 Steps when native prompt is temporarily waiting */}
        {platform.isAndroid && !isInstalled && !canPromptInstall && (
          <div className="space-y-2">
            <p className="text-xs text-slate-600 font-medium">
              To install or reinstall Simplify from Chrome:
            </p>
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F6F7F9] text-xs text-slate-700 font-medium">
              <span className="w-5 h-5 rounded-md bg-white text-slate-900 font-bold flex items-center justify-center shrink-0 shadow-2xs text-[11px]">
                1
              </span>
              <span>Tap browser menu (⋮) at top-right</span>
            </div>

            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F6F7F9] text-xs text-slate-700 font-medium">
              <span className="w-5 h-5 rounded-md bg-white text-slate-900 font-bold flex items-center justify-center shrink-0 shadow-2xs text-[11px]">
                2
              </span>
              <span>Select <strong>Install app</strong> or <strong>Add to Home screen</strong></span>
            </div>

            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F6F7F9] text-xs text-slate-700 font-medium">
              <span className="w-5 h-5 rounded-md bg-white text-slate-900 font-bold flex items-center justify-center shrink-0 shadow-2xs text-[11px]">
                3
              </span>
              <span>Tap <strong>Install</strong> to confirm</span>
            </div>
          </div>
        )}

        {/* 5. Desktop: Steps when native prompt is not available */}
        {platform.isDesktop && !isInstalled && !canPromptInstall && (
          <div className="p-3 rounded-xl bg-[#F6F7F9] text-xs text-slate-700 space-y-1.5">
            <p className="font-semibold text-slate-900">Install via browser:</p>
            <p className="leading-relaxed">
              Click the <strong>⊕ Install</strong> icon in the browser address bar at the top-right, or open menu (⋮) &gt; <strong>Install Simplify</strong>.
            </p>
          </div>
        )}

        {/* 6. Hint message if direct browser trigger is unavailable */}
        {hint && (
          <div className="p-2.5 rounded-xl bg-blue-50 text-blue-900 text-xs font-semibold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
            <span className="leading-snug">{hint}</span>
          </div>
        )}

        {/* 7. If Currently Running in Standalone App Mode */}
        {isInstalled && (
          <div className="p-3.5 rounded-xl bg-emerald-50 text-center flex flex-col items-center justify-center gap-1.5 text-xs text-emerald-800">
            <div className="flex items-center gap-2 font-bold text-[13px]">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Simplify is Installed</span>
            </div>
            <p className="text-emerald-700 text-[11.5px] font-medium">
              Simplify is currently running as an installed standalone app on this device.
            </p>
          </div>
        )}

        {/* Modal Actions */}
        <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
          {isInstalled ? (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={closeInstallModal}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold border-0 rounded-xl"
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={closeInstallModal}
                className="flex-1 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 font-semibold border-0 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={installing}
                onClick={handleInstallClick}
                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold border-0 rounded-xl"
              >
                <Download className="w-4 h-4 mr-1.5" />
                {installing ? 'Installing...' : 'Install App'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
};
