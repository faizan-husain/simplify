import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

export const Dialog: React.FC<DialogProps> = ({
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
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-card bg-white p-6 shadow-lg duration-200 animate-in fade-in zoom-in-95 border border-border">
          <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
            <DialogPrimitive.Title className="text-base font-semibold text-text">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-lg p-1 text-text-muted hover:text-text hover:bg-surface focus:outline-none">
              <X className="w-5 h-5" />
            </DialogPrimitive.Close>
          </div>
          {description && (
            <DialogPrimitive.Description className="text-sm text-text-muted mb-4">
              {description}
            </DialogPrimitive.Description>
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
