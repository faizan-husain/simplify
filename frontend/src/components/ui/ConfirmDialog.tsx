import React from 'react';
import { Dialog } from './Dialog';
import { AlertTriangle, Trash2, Info } from 'lucide-react';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  icon?: React.ReactNode;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  variant = 'danger',
  icon,
  loading = false,
  onConfirm,
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      className="sm:max-w-[440px] border-0 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3.5 p-4 rounded-2xl bg-[#EEF0F3] border-0 shadow-2xs">
          <div
            className={`w-9 h-9 rounded-control flex items-center justify-center shrink-0 ${variant === 'danger'
              ? 'bg-danger-soft text-danger'
              : variant === 'warning'
                ? 'bg-warning-soft text-warning'
                : 'bg-accent-soft text-accent'
              }`}
          >
            {icon ? (
              icon
            ) : variant === 'danger' ? (
              <Trash2 className="w-4 h-4" />
            ) : variant === 'warning' ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <Info className="w-4 h-4" />
            )}
          </div>
          <div className="text-[13.5px] text-text-muted leading-relaxed pt-0.5 break-words min-w-0 flex-1">
            {description}
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="w-full sm:w-auto px-5 h-[38px] border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs sm:text-[13px] shadow-2xs hover:shadow-xs transition-all active:scale-[0.98] cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`w-full sm:w-auto px-5 h-[38px] border-0 rounded-xl text-xs sm:text-[13px] font-semibold shadow-2xs hover:shadow-xs transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 ${variant === 'danger'
              ? 'bg-rose-100/90 hover:bg-rose-200 text-rose-700'
              : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span
                  className={`w-3.5 h-3.5 border-2 rounded-full animate-spin ${variant === 'danger'
                    ? 'border-rose-300 border-t-rose-600'
                    : 'border-white/30 border-t-white'
                    }`}
                />
                <span>Processing...</span>
              </span>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
