/** Os boons com volume gerado guardado por alcance. Cada um tem as métricas `<boon>Out` (squad), `<boon>Group` e `<boon>Self`. */
export const BOON_BASES = ["stab", "quick", "alac", "prot", "might", "aegis", "resist", "resol", "fury", "superspeed"] as const;
export type BoonBase = (typeof BOON_BASES)[number];
export type ScopedKey = `${BoonBase}${"Group" | "Self"}`;
