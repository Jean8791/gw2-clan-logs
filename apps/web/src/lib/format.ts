import { STAT_META, type StatKey } from "@gw2logs/shared";

const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export const int = (n: number | null | undefined) => (n == null ? "—" : nf0.format(n));
export const dec = (n: number | null | undefined, d = 1) => (n == null ? "—" : (d === 2 ? nf2 : nf1).format(n));

/** 1.234.567 → 1,23 mi; 12.345 → 12,3 mil */
export function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf2.format(n / 1e6)} mi`;
  if (a >= 1e4) return `${nf1.format(n / 1e3)} mil`;
  return a < 10 && n % 1 !== 0 ? nf2.format(n) : nf0.format(n);
}

export function stat(key: StatKey, v: number, perMin = false): string {
  if (STAT_META[key].format === "volume") return dec(v, 2);
  if (perMin) return v >= 1e4 ? compact(v) : v >= 100 ? int(v) : v < 10 ? dec(v, 2) : dec(v, 1);
  return compact(v);
}

/** Rótulo curto para eixos de gráfico: 850k, 1,2M. */
export function axis(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${dec(n / 1e6, 1)}M`;
  if (a >= 1e3) return `${dec(n / 1e3, 0)}k`;
  return dec(n, 1);
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(ss).padStart(2, "0")}s`;
}

const dtf = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const df = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
export const dateTime = (iso: string | null | undefined) => (iso ? dtf.format(new Date(iso)) : "—");
export const date = (iso: string | null | undefined) => (iso ? df.format(new Date(iso)) : "—");

/** Diferença percentual de a sobre b (“+12%”). */
export function diffPct(a: number, b: number): number | null {
  if (!b) return null;
  return ((a - b) / b) * 100;
}

export const accountShort = (account: string) => account.replace(/\.\d{4}$/, "");
