/** Os boons com volume gerado guardado por alcance. Cada um tem as métricas `<boon>Out` (squad), `<boon>Group` e `<boon>Self`. */
export const BOON_BASES = ["stab", "quick", "alac", "prot", "might", "aegis", "resist", "resol", "fury", "superspeed"] as const;
export type BoonBase = (typeof BOON_BASES)[number];
export type ScopedKey = `${BoonBase}${"Group" | "Self"}`;

/** Os boons com uptime guardado; cada um tem `<boon>Up` (do próprio jogador) e `<boon>GroupUp` (média do grupo dele). */
export const GROUP_UP_BASES = ["stab", "quick", "alac", "prot", "might", "aegis", "resist", "resol", "fury", "swift", "vigor", "regen"] as const;
export type GroupUpKey = `${(typeof GROUP_UP_BASES)[number]}GroupUp`;
