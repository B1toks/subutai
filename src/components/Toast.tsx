import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle, Info as InfoIcon, XCircle } from 'lucide-react';
import { Icon } from './Icon';

export type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  text: string;
}

interface ToastContextValue {
  show: (text: string, type?: ToastType, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_ICONS: Record<ToastType, LucideIcon> = {
  success: CheckCircle,
  error: XCircle,
  info: InfoIcon,
};

/**
 * Sprint 3.4 — central toast manager. Wrap the app once in
 * <ToastProvider>; any descendant can call useToast().show(...) to
 * surface a slide-in pill in the top-right. Each toast auto-dismisses
 * after `durationMs` (default 3s). Multiple toasts stack.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  // Timers per id so we can cancel them on unmount.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const show = useCallback<ToastContextValue['show']>(
    (text, type = 'info', durationMs = 3000) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, type, text }]);
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      }, durationMs);
      timersRef.current.set(id, timer);
    },
    [],
  );

  // Sprint 3.4.1: memoise the context value. Without this the provider
  // hands consumers a fresh object literal on every render (every time
  // toasts state changes), which invalidates any consumer useEffect
  // that lists `toast` in deps and re-fires the effect → re-fires the
  // toast → adds another toast → re-renders → infinite spam loop.
  const value = useMemo<ToastContextValue>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role="status">
            <Icon icon={TYPE_ICONS[t.type]} size="md" aria-hidden />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Soft fallback for tests / Storybook so missing provider doesn't crash;
    // logs once so the call-site is still detectable in dev.
    return {
      show: (text, type = 'info') => {
        console.warn('[useToast] no provider mounted; toast:', type, text);
      },
    };
  }
  return ctx;
}
