import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { FILTER_KEYS, parseFilters, type Filters } from "@gw2logs/shared";

/**
 * Filtros guardados na URL: dá para mandar o link de um ranking filtrado no Discord. Se o endereço não traz nenhum filtro, valem os
 * `defaults` (que podem mudar depois, por exemplo quando a lista de dias chega); o que a pessoa escolheu sempre ganha.
 */
export function useFilters(defaults: Filters = {}) {
  const [params, setParams] = useSearchParams();
  const defaultsKey = JSON.stringify(defaults);
  const filters = useMemo<Filters>(() => {
    const fromUrl = parseFilters(Object.fromEntries(params));
    const touched = FILTER_KEYS.some((k) => params.has(k)) || params.has("_");
    return touched ? fromUrl : { ...(JSON.parse(defaultsKey) as Filters), ...fromUrl };
  }, [params, defaultsKey]);

  const setFilters = useCallback(
    (next: Filters) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const k of FILTER_KEYS) p.delete(k);
          p.delete("_");
          // outro filtro, outro conjunto de lutas: volta para a primeira página
          p.delete("page");
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
