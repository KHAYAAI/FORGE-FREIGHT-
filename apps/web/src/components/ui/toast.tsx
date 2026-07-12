"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  title?: string;
  description?: string;
  tone?: ToastTone;
  /** ms before auto-dismiss. 0 disables auto-dismiss. */
  duration?: number;
}

interface ToastEntry extends Required<Pick<ToastOptions, "tone" | "duration">> {
  id: number;
  title?: string;
  description?: string;
}

interface ToastContextValue {
  toast: (opts: ToastOptions | string) => number;
  success: (title: string, description?: string) => number;
  error: (title: string, description?: string) => number;
  info: (title: string, description?: string) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used within <ToastProvider>");
  return ctx;
}

const DEFAULT_DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (opts: ToastOptions | string) => {
      const normalized: ToastOptions = typeof opts === "string" ? { description: opts } : opts;
      const id = nextId.current++;
      const duration = normalized.duration ?? DEFAULT_DURATION;
      const entry: ToastEntry = {
        id,
        title: normalized.title,
        description: normalized.description,
        tone: normalized.tone ?? "info",
        duration,
      };
      setToasts((prev) => [...prev, entry]);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, tone: "success" }),
      error: (title, description) => toast({ title, description, tone: "error" }),
      info: (title, description) => toast({ title, description, tone: "info" }),
      dismiss,
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const TONE_STYLES: Record<ToastTone, { border: string; bg: string; text: string; dot: string }> = {
  success: {
    border: "border-[color-mix(in_srgb,var(--success)_35%,transparent)]",
    bg: "bg-success-wash",
    text: "text-success",
    dot: "bg-success",
  },
  error: {
    border: "border-[color-mix(in_srgb,var(--critical)_35%,transparent)]",
    bg: "bg-critical-wash",
    text: "text-critical",
    dot: "bg-critical",
  },
  warning: {
    border: "border-[color-mix(in_srgb,var(--warning)_35%,transparent)]",
    bg: "bg-warning-wash",
    text: "text-warning",
    dot: "bg-warning",
  },
  info: {
    border: "border-accent-border",
    bg: "bg-accent-wash",
    text: "text-accent-strong",
    dot: "bg-accent",
  },
};

function Toaster({ toasts, onDismiss }: { toasts: ToastEntry[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const tone = TONE_STYLES[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded border bg-surface px-3.5 py-3 shadow-[var(--shadow-panel)]",
              "animate-[toast-in_0.15s_ease-out]",
              tone.border,
              tone.bg,
            )}
          >
            <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              {t.title && <div className={cn("text-[12.5px] font-semibold", tone.text)}>{t.title}</div>}
              {t.description && (
                <div className="mt-0.5 text-[11.5px] text-secondary">{t.description}</div>
              )}
            </div>
            <button
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded-sm px-1 text-[13px] leading-none text-tertiary transition-colors hover:bg-hover hover:text-primary"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
