import { STAT_META, type StatKey } from "@gw2logs/shared";
import { getLang } from "./i18n";

/** "pt-BR" (26,5 mil; 12/11) ou "en-US" (26.5k; 11/12), conforme o idioma escolhido. */
const locale = () => (getLang() === "en" ? "en-US" : "pt-BR");
const nfCache = new Map<string, Intl.NumberFormat>();
const numberFormat = (max: number, n: number) => {
  const k = `${locale()}:${max}`;
  let f = nfCache.get(k);
  if (!f) nfCache.set(k, (f = new Intl.NumberFormat(locale(), { maximumFractionDigits: max })));
  return f.format(n);
};
const nf0 = { format: (n: number) => numberFormat(0, n) };
const nf1 = { format: (n: number) => numberFormat(1, n) };
const nf2 = { format: (n: number) => numberFormat(2, n) };
const nf3 = { format: (n: number) => numberFormat(3, n) };

export const int = (n: number | null | undefined) => (n == null ? "—" : nf0.format(n));
export const dec = (n: number | null | undefined, d = 1) => (n == null ? "—" : (d === 2 ? nf2 : nf1).format(n));

/** 1.234.567 → 1,23 mi; 12.345 → 12,3 mil (em inglês: 1.23M; 12.3k) */
export function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  const en = getLang() === "en";
  if (a >= 1e6) return `${nf2.format(n / 1e6)}${en ? "M" : " mi"}`;
  if (a >= 1e4) return `${nf1.format(n / 1e3)}${en ? "k" : " mil"}`;
  return a < 10 && n % 1 !== 0 ? nf2.format(n) : nf0.format(n);
}

/** Por segundo os números são pequenos (3 abates em 4 min = 0,0125/s): menos de 1 mostra 3 casas, senão sumiria na casa 0,01. */
const perSecondText = (v: number) => (v >= 1e4 ? compact(v) : v >= 100 ? int(v) : v >= 10 ? dec(v, 1) : v >= 1 ? dec(v, 2) : nf3.format(v));

export function stat(key: StatKey, v: number, perMin = false, perSec = false): string {
  const format = STAT_META[key].format;
  if (format === "pct") return `${dec(v, 1)}%`;
  if (format === "avg") return dec(v, 1);
  if (format === "volume") return dec(v, 2);
  if (perSec) return perSecondText(v);
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

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
export const date = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";

/** Diferença percentual de a sobre b (“+12%”). */
export function diffPct(a: number, b: number): number | null {
  if (!b) return null;
  return ((a - b) / b) * 100;
}

/** Valor de um campo datetime-local (horário do navegador, "AAAA-MM-DDTHH:MM") → instante em UTC para a URL. */
export const localToInstant = (local: string): string | undefined => {
  const t = local ? Date.parse(local) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

/** Filtro De/Até da URL → valor do campo datetime-local. Só o dia ("AAAA-MM-DD") vale o dia UTC inteiro: "Até" é o fim dele. */
export function instantToLocal(value: string | undefined, isEnd = false): string {
  if (!value) return "";
  const t = value.includes("T") ? Date.parse(value) : Date.parse(`${value}T00:00:00.000Z`) + (isEnd ? 86_400_000 : 0);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const accountShort = (account: string) => account.replace(/\.\d{4}$/, "");

/** "2026-11-12" → "qui, 12/11" (o dia de batalha, ver battleDay em shared). */
export const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).replace(".", "");
