import { useSyncExternalStore } from "react";
import { DICT, parseLang, translate, type Lang } from "@gw2logs/shared";

// Idioma do site, guardado só no navegador. O padrão é sempre o português; só vira inglês se a pessoa escolher no botão.
const KEY = "gw2logs.lang";
const listeners = new Set<() => void>();

function read(): Lang {
  try {
    return parseLang(localStorage.getItem(KEY));
  } catch {
    return "pt"; // navegador sem armazenamento
  }
}

let current: Lang = read();
const htmlLang = (l: Lang) => (l === "en" ? "en" : "pt-BR");
if (typeof document !== "undefined") document.documentElement.lang = htmlLang(current);

export const getLang = (): Lang => current;

export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* vale só até recarregar */
  }
  document.documentElement.lang = htmlLang(lang);
  listeners.forEach((l) => l());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getLang,
    () => "pt",
  );
}

/** Texto no idioma atual. Fora de componentes use `t`; dentro, `useT()` também refaz a tela quando o idioma muda. */
export const t = (key: string, vars?: Record<string, string | number>) => translate(DICT, current, key, vars);

export function useT() {
  useLang();
  return t;
}
