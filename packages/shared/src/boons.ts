/** Os boons com volume gerado guardado por alcance. Cada um tem as métricas `<boon>Out` (squad), `<boon>Group` e `<boon>Self`. */
export const BOON_BASES = ["stab", "quick", "alac", "prot", "might", "aegis", "resist", "resol", "fury", "superspeed"] as const;
export type BoonBase = (typeof BOON_BASES)[number];
export type ScopedKey = `${BoonBase}${"Group" | "Self"}`;
/** A geração efetiva (`generation` do Elite Insights, sem a perda registrada) de cada boon: `<boon>Eff`, no alcance "effective". */
export type EffKey = `${BoonBase}Eff`;
/** A perda registrada (`wasted` do Elite Insights) de cada boon: `<boon>Waste`, no alcance "loss". */
export type WasteKey = `${BoonBase}Waste`;
/** A rejeição explícita (`overstack − generation`) de cada boon: `<boon>Rej`, no alcance "loss". */
export type RejKey = `${BoonBase}Rej`;

/** Os boons com uptime guardado; cada um tem `<boon>Up` (do próprio jogador) e `<boon>GroupUp` (média do grupo dele). */
export const GROUP_UP_BASES = ["stab", "quick", "alac", "prot", "might", "aegis", "resist", "resol", "fury", "swift", "vigor", "regen"] as const;
export type GroupUpKey = `${(typeof GROUP_UP_BASES)[number]}GroupUp`;

/**
 * Os boons de intensidade (pilhas): o volume é em pilhas médias (menor que 1 em geral), e os outros são em % do tempo. Confere com o `stacking`
 * do `buffMap` do Elite Insights nos 20 logs da Etapa 0 (docs/research); o log de cada luta traz essa informação, mas o site só a usa para o uptime.
 */
export const STACKING_BOONS: readonly BoonBase[] = ["stab", "might"];

/**
 * Versão da fórmula dos boons com que cada luta foi lida (guardada em `fights.boon_formula`), para comparar o histórico quando ela mudar.
 * 1 = só o volume (`outgoing`); 2 = volume e geração efetiva; 3 = volume, geração efetiva, perda registrada e rejeição explícita.
 */
export const BOON_FORMULA_VERSION = 3;
