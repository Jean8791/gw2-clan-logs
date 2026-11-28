import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { FILTER_KEYS, parseCards, parseFilters, resolveCards, serializeCards, type CardMetric, type Cards, type Filters, type StatGroup } from "@gw2logs/shared";

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

// ---------- Cards da Visão geral ----------

// A escolha de cada card vai no link (`cards=`), para mandar no Discord, e fica também no navegador de quem escolheu: o link sempre vence.
const CARDS_KEY = "gw2logs.cards";

function readStoredCards(): string | null {
  try {
    return localStorage.getItem(CARDS_KEY);
  } catch {
    return null; // modo privado
  }
}

function storeCards(text: string) {
  try {
    if (text) localStorage.setItem(CARDS_KEY, text);
    else localStorage.removeItem(CARDS_KEY);
  } catch {
    /* sem armazenamento: vale só até recarregar a página */
  }
}

/** A métrica de cada card (do link, senão a última escolha deste navegador, senão o padrão) e a troca de um deles. Não mexe nos filtros. */
export function useCards() {
  const [params, setParams] = useSearchParams();
  const inUrl = params.get("cards");
  const cards = useMemo<Cards>(() => resolveCards(parseCards(inUrl ?? readStoredCards())), [inUrl]);
  // sem `cards` no endereço, a escolha guardada no navegador passa para ele: assim o "Copiar link" leva o que a pessoa está vendo
  const stored = inUrl === null ? serializeCards(cards) : "";
  useEffect(() => {
    if (!stored) return;
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("cards", stored);
        return p;
      },
      { replace: true },
    );
  }, [stored, setParams]);

  const setCard = useCallback(
    (group: StatGroup, metric: CardMetric) => {
      const text = serializeCards({ ...cards, [group]: metric });
      storeCards(text);
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (text) p.set("cards", text);
          else p.delete("cards");
          return p;
        },
        { replace: true },
      );
    },
    [cards, setParams],
  );
  return [cards, setCard] as const;
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
