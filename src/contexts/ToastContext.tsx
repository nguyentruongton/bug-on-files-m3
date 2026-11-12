import React, { createContext, useCallback, useContext } from 'react';
import { SnackbarContext, SnackbarProvider, useSnackbar } from '@bug-on/m3-expressive';

export type ToastType = 'info' | 'success' | 'error';

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const ToastBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showSnackbar } = useSnackbar();

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      void showSnackbar({
        message,
        duration: type === 'error' ? 'long' : 'short',
        withDismissAction: type === 'error',
      });
    },
    [showSnackbar]
  );

  return <ToastContext.Provider value={{ showToast }}>{children}</ToastContext.Provider>;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const existingSnackbar = useContext(SnackbarContext);

  if (existingSnackbar) {
    return <ToastBridge>{children}</ToastBridge>;
  }

  return (
    <SnackbarProvider>
      <ToastBridge>{children}</ToastBridge>
    </SnackbarProvider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
