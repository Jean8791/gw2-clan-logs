import { parseHiddenColumns } from "@gw2logs/shared";

// Colunas que a pessoa escondeu em cada tabela, guardadas só no navegador dela (sem login nem servidor).
const storageKey = (tableKey: string) => `gw2logs.cols.${tableKey}`;

export function loadHiddenColumns(tableKey: string): string[] {
  try {
    return parseHiddenColumns(localStorage.getItem(storageKey(tableKey)));
  } catch {
    return []; // navegador sem armazenamento (modo privado)
  }
}

export function saveHiddenColumns(tableKey: string, hidden: string[]) {
  try {
    if (hidden.length) localStorage.setItem(storageKey(tableKey), JSON.stringify(hidden));
    else localStorage.removeItem(storageKey(tableKey));
  } catch {
    /* sem armazenamento: vale só até recarregar a página */
  }
}
