import clsx from "clsx";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export const cx = clsx;

export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-surface/80 shadow-[0_1px_0_#ffffff08_inset] backdrop-blur", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold tracking-wide text-text">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-wide text-text sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline"; size?: "sm" | "md" };
export function Button({ variant = "outline", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-gold text-[#1a1408] hover:brightness-110",
        variant === "outline" && "border border-line bg-surface-2 text-text hover:border-faint hover:bg-surface-3",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-text",
        className,
      )}
    />
  );
}

export function Select({ label, className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1", className)}>
      {label && <span className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>}
      <select
        {...p}
        className="h-9 w-full rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-text outline-none transition hover:border-faint focus:border-gold"
      >
        {children}
      </select>
    </label>
  );
}

export function Input({ label, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1", className)}>
      {label && <span className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>}
      <input
        {...p}
        className="h-9 w-full rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-text outline-none transition placeholder:text-faint hover:border-faint focus:border-gold [color-scheme:dark]"
      />
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md font-medium transition",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            value === o.value ? "bg-surface-3 text-gold shadow" : "text-muted hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "gold" | "good" | "bad" | "info"; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
        tone === "neutral" && "bg-surface-3 text-muted",
        tone === "gold" && "bg-gold-soft text-gold",
        tone === "good" && "bg-good/15 text-good",
        tone === "bad" && "bg-bad/15 text-bad",
        tone === "info" && "bg-info/15 text-info",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kpi({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className={cx("rounded-2xl border border-line bg-surface/80 px-4 py-3.5", accent && "border-gold/40 bg-gradient-to-br from-gold/10 to-transparent")}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold text-text">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
      <AlertTriangle className="size-4 shrink-0" /> {error instanceof Error ? error.message : "Algo deu errado."}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="font-display text-lg text-text">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Variação em relação à média: verde se melhor, vermelho se pior. */
export function Delta({ pct, higherIsBetter = true }: { pct: number | null; higherIsBetter?: boolean }) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const good = higherIsBetter ? pct >= 0 : pct <= 0;
  return (
    <span className={cx("tabular text-xs font-semibold", good ? "text-good" : "text-bad")}>
      {pct >= 0 ? "+" : ""}
      {Math.round(pct)}%
    </span>
  );
}
