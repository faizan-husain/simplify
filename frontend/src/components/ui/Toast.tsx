import React, { createContext, useContext, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { Check, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type?: 'success' | 'error' | 'info';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextType {
  showToast: (
    message: string,
    type?: 'success' | 'error' | 'info',
    action?: { label: string; onClick: () => void }
  ) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback(
    (
      message: string,
      type: 'success' | 'error' | 'info' = 'info',
      action?: { label: string; onClick: () => void }
    ) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: ToastMessage = { id, type, message, action };

      setToasts((prev) => [...prev, newToast]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    },
    []
  );

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 max-w-md w-full px-4 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              'pointer-events-auto flex items-center justify-between gap-3 px-4 py-2.5 rounded-control shadow-pop text-[13.5px] animate-in slide-in-from-bottom-2 duration-200 bg-ink text-white max-w-full'
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {toast.type === 'success' && (
                <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                  <Check className="w-2.5 h-2.5 text-white" />
                </div>
              )}
              {toast.type === 'error' && (
                <div className="w-4 h-4 rounded-full bg-danger flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-3 h-3 text-white" />
                </div>
              )}
              {toast.type === 'info' && (
                <div className="w-4 h-4 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0">
                  <Info className="w-3 h-3 text-ink" />
                </div>
              )}
              <span className="font-normal truncate">{toast.message}</span>
            </div>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  removeToast(toast.id);
                }}
                className="text-[13px] font-medium text-teal-300 hover:text-white transition-colors ml-2 shrink-0"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="p-1 -mr-1 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors focus:outline-none shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
