import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { I18nProvider, useI18n } from '../../i18n';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ConfirmOptions {
  title?: string;
  type?: 'danger' | 'warn' | 'info';
}

interface AppContextValue {
  theme: string;
  setThemeMode: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  toasts: Toast[];
  showToast: (message: string, type?: Toast['type']) => void;
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  connectionStatus: 'connecting' | 'connected' | 'error';
  setConnectionStatus: (s: AppContextValue['connectionStatus']) => void;
  currentConvId: string | null;
  setCurrentConvId: (id: string | null) => void;
}

const AppContext = createContext<AppContextValue>(null!);

export function useApp() {
  return useContext(AppContext);
}

function AppProviderInner({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('okit-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('okit-sidebar-collapsed') === 'true',
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<AppContextValue['connectionStatus']>('connecting');
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);

  const confirmState = useRef<{
    resolve: (v: boolean) => void;
    message: string;
    options: ConfirmOptions;
    visible: boolean;
  }>({ resolve: () => {}, message: '', options: {}, visible: false });
  const [, forceUpdate] = useState(0);
  const toastIdRef = useRef(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('okit-theme', next);
      return next;
    });
  }, []);

  const setThemeMode = useCallback((next: 'dark' | 'light') => {
    localStorage.setItem('okit-theme', next);
    setTheme(next);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('okit-sidebar-collapsed', String(next));
      return next;
    });
  }, []);

  const showToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2600);
  }, []);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => {
    return new Promise<boolean>(resolve => {
      confirmState.current = { resolve, message, options, visible: true };
      forceUpdate(n => n + 1);
    });
  }, []);

  const resolveConfirm = useCallback((result: boolean) => {
    confirmState.current.resolve(result);
    confirmState.current.visible = false;
    forceUpdate(n => n + 1);
  }, []);

  return (
    <AppContext.Provider
      value={{
        theme,
        setThemeMode,
        toggleTheme,
        sidebarCollapsed,
        toggleSidebar,
        toasts,
        showToast,
        confirm,
        connectionStatus,
        setConnectionStatus,
        currentConvId,
        setCurrentConvId,
      }}
    >
      {children}
      {/* Toast container */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type} show`}>{t.message}</div>
        ))}
      </div>
      {/* Confirm modal */}
      {confirmState.current.visible && (
        <div className="auth-overlay" style={{ display: '' }}>
          <div className="confirm-panel">
            <div className={`confirm-icon confirm-icon--${confirmState.current.options.type || 'danger'}`}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="2" />
                <path d="M10 18l8-8M18 18l-8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="confirm-body">
              <div className="confirm-title">{confirmState.current.options.title || t('common.confirmAction')}</div>
              <div className="confirm-message" dangerouslySetInnerHTML={{ __html: confirmState.current.message }} />
            </div>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn--cancel" onClick={() => resolveConfirm(false)}>{t('common.cancel')}</button>
              <button
                className={`confirm-btn confirm-btn--ok${confirmState.current.options.type === 'danger' ? ' confirm-btn--danger' : ''}`}
                onClick={() => resolveConfirm(true)}
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <AppProviderInner>{children}</AppProviderInner>
    </I18nProvider>
  );
}
