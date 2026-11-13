import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { FILTER_KEYS, parseFilters, type Filters, type Role } from "@gw2logs/shared";

/** Filtros guardados na URL: dá para mandar o link de um ranking filtrado no Discord. */
export function useFilters(defaults: Filters = {}) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo<Filters>(() => {
    const fromUrl = parseFilters(Object.fromEntries(params));
    const touched = FILTER_KEYS.some((k) => params.has(k)) || params.has("_");
    return touched ? fromUrl : { ...defaults, ...fromUrl };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const setFilters = useCallback(
    (next: Filters) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const k of FILTER_KEYS) p.delete(k);
          p.delete("_");
          for (const k of FILTER_KEYS) {
            const v = next[k];
            if (v !== undefined && v !== "") p.set(k, String(v));
          }
          if (![...p.keys()].some((k) => (FILTER_KEYS as readonly string[]).includes(k))) p.set("_", "");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [filters, setFilters] as const;
}

/** Função mais jogada num conjunto de lutas. */
export function mainRole(history: { role: Role }[]): Role {
  const sup = history.filter((h) => h.role === "support").length;
  return sup > history.length / 2 ? "support" : "dps";
}

// ---------- "Minha conta" (só no navegador de quem está vendo) ----------

const ME_KEY = "gw2logs.me";
const listeners = new Set<() => void>();

function readMe(): string | null {
  try {
    return localStorage.getItem(ME_KEY);
  } catch {
    return null;
  }
}

export function setMe(account: string | null) {
  try {
    if (account) localStorage.setItem(ME_KEY, account);
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* modo privado */
  }
  listeners.forEach((l) => l());
}

export function useMe(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readMe,
    () => null,
  );
}

export function useSessionValue(key: string): [string, (v: string) => void] {
  const get = () => {
    try {
      return sessionStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  };
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    get,
    () => "",
  );
  const set = (v: string) => {
    try {
      sessionStorage.setItem(key, v);
    } catch {
      /* ignora */
    }
    listeners.forEach((l) => l());
  };
  return [value, set];
}
