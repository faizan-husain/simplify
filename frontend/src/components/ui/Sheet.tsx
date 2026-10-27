import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

export const Sheet: React.FC<SheetProps> = ({
  open,
  onOpenChange,
  title,
  description,
  children,
}) => {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-in fade-in" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] flex flex-col rounded-t-[16px] bg-white p-5 shadow-xl duration-200 animate-in slide-in-from-bottom border-t border-border sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-h-full sm:w-full sm:max-w-lg sm:rounded-none sm:border-l"
        >
          {/* Drag handle pill on mobile */}
          <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-3 sm:hidden" />

          <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-text">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-xs text-text-muted mt-0.5">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="rounded-lg p-1.5 text-text-muted hover:text-text hover:bg-surface focus:outline-none">
              <X className="w-5 h-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
