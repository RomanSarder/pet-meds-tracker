import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Defaults to 5000ms. */
  durationMs?: number;
}

export interface ToastHandle {
  /** Dismisses this toast if it is still the one showing; clears its timer. */
  dismiss: () => void;
}

interface ToastContextValue {
  show: (options: ToastOptions) => ToastHandle;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 5_000;

// Approximate height of TabBar's rendered box (12px top pad + 22px icon +
// 5px gap + ~13px label line + 30px bottom pad), plus a little breathing
// room, so the toast floats just above it without measuring the DOM.
const ABOVE_TAB_BAR_OFFSET_PX = 88;

interface ActiveToast extends ToastOptions {
  id: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Belt and braces: clear any pending timer if the provider itself unmounts.
  useEffect(() => clearTimer, [clearTimer]);

  const show = useCallback(
    (options: ToastOptions): ToastHandle => {
      clearTimer();
      const id = ++idRef.current;
      setToast({ id, ...options });

      const duration = options.durationMs ?? DEFAULT_DURATION_MS;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setToast((current) => (current?.id === id ? null : current));
      }, duration);

      return {
        dismiss: () => {
          clearTimer();
          setToast((current) => (current?.id === id ? null : current));
        },
      };
    },
    [clearTimer]
  );

  const reducedMotion =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: `calc(${ABOVE_TAB_BAR_OFFSET_PX}px + env(safe-area-inset-bottom, 0px))`,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            gap: 12,
            maxWidth: "calc(100vw - 48px)",
            padding: "12px 18px",
            borderRadius: "var(--radius-lg)",
            background: "var(--ink-1)",
            color: "var(--ink-inverse)",
            boxShadow: "var(--shadow-float)",
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            transition: reducedMotion
              ? "none"
              : "opacity var(--dur) var(--ease), transform var(--dur) var(--ease)",
          }}
        >
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.actionLabel ? (
            <button
              type="button"
              onClick={() => {
                toast.onAction?.();
                clearTimer();
                setToast((current) => (current?.id === toast.id ? null : current));
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: "var(--ink-inverse)",
                fontWeight: 700,
                fontSize: 14,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
