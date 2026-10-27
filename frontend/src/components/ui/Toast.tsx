import React, { createContext, useContext, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

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
  showToast: (message: string, type?: 'success' | 'error' | 'info', action?: { label: string; onClick: () => void }) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((
    message: string,
    type: 'success' | 'error' | 'info' = 'info',
    action?: { label: string; onClick: () => void }
  ) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastMessage = { id, type, message, action };

    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-20 sm:bottom-6 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              'pointer-events-auto flex items-center justify-between p-3.5 rounded-card shadow-lg border text-sm animate-in slide-in-from-bottom-2 duration-200 bg-white',
              toast.type === 'success' && 'border-success/30 text-text',
              toast.type === 'error' && 'border-danger/30 text-text',
              toast.type === 'info' && 'border-border text-text'
            )}
          >
            <div className="flex items-center gap-2.5 flex-1 min-w-0 mr-2">
              {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />}
              {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-danger flex-shrink-0" />}
              {toast.type === 'info' && <Info className="w-5 h-5 text-primary flex-shrink-0" />}
              <span className="font-medium text-xs sm:text-sm truncate">{toast.message}</span>
            </div>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action?.onClick();
                  removeToast(toast.id);
                }}
                className="text-xs font-semibold text-primary hover:underline mr-2"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => removeToast(toast.id)}
              className="p-1 rounded text-text-muted hover:text-text focus:outline-none"
            >
              <X className="w-4 h-4" />
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
