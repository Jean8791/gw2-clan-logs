// Paginação das listas longas: só fatia a exibição. O filtro decide quais registros existem e a ordenação vale sobre todos eles.

/** Linhas por página. */
export const PAGE_SIZE = 20;

/** Colunas pelas quais a lista de lutas pode ser ordenada no servidor (são os ids das colunas da tela). */
export const FIGHT_SORT_KEYS = ["time", "rec", "name", "dur", "size", "kd", "dmg", "up"] as const;
export type FightSortKey = (typeof FIGHT_SORT_KEYS)[number];

/** Quantas páginas tem um total de registros (sempre pelo menos 1). */
export const pageCount = (total: number, size = PAGE_SIZE): number => Math.max(1, Math.ceil(total / size));

/** As linhas de uma página (a primeira é a 1). Página fora do intervalo cai na primeira ou na última. */
export function pageSlice<T>(rows: T[], page: number, size = PAGE_SIZE): T[] {
  const p = Math.min(Math.max(page, 1), pageCount(rows.length, size));
  return rows.slice((p - 1) * size, p * size);
}
