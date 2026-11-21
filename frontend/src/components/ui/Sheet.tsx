import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}

export const Sheet: React.FC<SheetProps> = ({
  open,
  onOpenChange,
  title,
  description,
  className,
  children,
}) => {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0F172A]/65 backdrop-blur-sm animate-in fade-in duration-200" />
        <DialogPrimitive.Content
          className={twMerge(
            clsx(
              'fixed z-50 flex flex-col bg-white shadow-pop duration-200 animate-in overflow-hidden',
              // Mobile: bottom sheet
              'max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:rounded-t-[20px] max-sm:border-t max-sm:border-hair slide-in-from-bottom',
              // Desktop: right drawer
              'sm:inset-y-0 sm:right-0 sm:h-full sm:w-full sm:max-w-lg sm:border-l sm:border-hair slide-in-from-right',
              className
            )
          )}
        >
          {/* Mobile drag handle */}
          <div className="pt-3 pb-1 px-4 sm:hidden shrink-0">
            <div className="w-10 h-1 bg-surface-3 rounded-full mx-auto" />
          </div>

          <div className="px-5 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-divider flex items-start justify-between gap-3 shrink-0">
            <div className="min-w-0 pr-2 flex-1">
              <DialogPrimitive.Title className="text-[17px] font-semibold text-text tracking-tight break-words">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-[13px] text-text-muted mt-0.5 leading-relaxed break-words">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="shrink-0 rounded-control p-1.5 text-text-muted hover:text-text hover:bg-surface-2 transition-colors focus:outline-none cursor-pointer">
              <X className="w-4 h-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
            <div className="px-5 sm:px-6 py-5 pb-8 sm:pb-12">
              {children}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
