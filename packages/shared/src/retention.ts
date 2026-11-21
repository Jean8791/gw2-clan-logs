// Prazo de guarda das lutas. A regra é uma só, no servidor (a limpeza) e na tela (o aviso): vale a data da LUTA, e só na falta dela a do envio.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Instante (ISO, UTC) abaixo do qual uma luta já passou do prazo: agora menos os dias de retenção. */
export const retentionCutoff = (now: Date, days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString();
