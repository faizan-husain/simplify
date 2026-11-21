import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  className,
  contentClassName,
  children,
}) => {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0F172A]/65 backdrop-blur-sm animate-in fade-in duration-200 print:hidden" />
        <DialogPrimitive.Content
          className={twMerge(
            clsx(
              'fixed z-50 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.15)] duration-200 animate-in border-0 flex flex-col overflow-hidden isolate',
              // Mobile (<640px): bottom sheet with smooth slide-up
              'max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-t-[20px] max-sm:rounded-b-none max-sm:max-h-[92dvh] slide-in-from-bottom',
              // Desktop (>=640px): centred modal max 520px with safe viewport max-height
              'sm:left-[50%] sm:top-[50%] sm:w-full sm:max-w-[520px] sm:max-h-[90dvh] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-[20px] zoom-in-95',
              className
            )
          )}
        >
          {/* Mobile drag handle */}
          {title && (
            <div className="no-print pt-3 pb-1 px-4 sm:hidden shrink-0">
              <div className="w-10 h-1 bg-[#EEF0F3] rounded-full mx-auto" />
            </div>
          )}

          {title && (
            <div className="no-print flex items-start justify-between px-5 sm:px-6 pt-4 sm:pt-5 pb-3.5 border-b border-slate-100 gap-3 shrink-0">
              <div className="min-w-0 pr-2 flex-1">
                <DialogPrimitive.Title className="text-[17px] font-semibold text-slate-900 tracking-tight break-words">
                  {title}
                </DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="text-[13px] text-slate-500 mt-1 leading-relaxed break-words">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              <DialogPrimitive.Close className="shrink-0 rounded-xl p-1.5 text-slate-400 hover:text-slate-700 bg-transparent hover:bg-[#EEF0F3] transition-colors focus:outline-none cursor-pointer">
                <X className="w-4 h-4" />
              </DialogPrimitive.Close>
            </div>
          )}

          <div
            className={twMerge(
              clsx(
                'min-h-0 flex-1',
                title ? 'overflow-y-auto overscroll-contain p-4 sm:p-6' : 'flex flex-col overflow-hidden'
              ),
              contentClassName
            )}
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
