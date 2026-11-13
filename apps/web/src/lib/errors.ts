import { DICT } from "@gw2logs/shared";
import { t } from "./i18n";

/** Erro de uma resposta da API: guarda o código estável (traduzido na hora de mostrar, no idioma da tela). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public params?: Record<string, string | number>,
  ) {
    super(message);
  }
}

/** Corpo de erro da API ({ error, code, max }) como ApiError; sem corpo legível, só o status. */
export const apiErrorFrom = (status: number, body: { error?: string; code?: string; max?: number } | null) =>
  new ApiError(status, body?.error ?? `HTTP ${status}`, body?.code, body?.max != null ? { max: body.max } : undefined);

const known = (key: string) => key in DICT.pt;

/** Texto do erro no idioma atual; código desconhecido mostra a mensagem original. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code && known(`api.${e.code}`)) return t(`api.${e.code}`, e.params);
    return e.message.startsWith("HTTP ") ? t("api.http", { status: e.status }) : e.message;
  }
  return e instanceof Error ? e.message : t("error.generic");
}

/** Erro guardado numa luta ("código" ou "código|detalhe"). Texto antigo, em português, aparece como está. */
export function fightErrorText(raw: string): string {
  const [code = "", ...rest] = raw.split("|");
  const key = `fighterr.${code}`;
  return known(key) ? t(key, { detail: rest.join("|") }) : raw;
}
