// Cabeçalhos de segurança e conferência de origem dos pedidos que mudam estado.
import type { IncomingHttpHeaders } from "node:http";

/**
 * Política de conteúdo das páginas HTML: só o próprio site, mais as fontes do Google (o index.html as carrega), estilos inline (os gráficos
 * usam) e nada de enquadrar o site em outro (clickjacking). Scripts só do próprio site, sem `unsafe-inline`.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** 180 dias, sem subdomínios e sem preload: o navegador que já viu o site em https não volta para http. */
const HSTS = "max-age=15552000";

/** Cabeçalhos de toda resposta. A CSP só vai nas páginas HTML do site (o relatório do Elite Insights tem scripts próprios e fica de fora). */
export function securityHeaders(o: { https: boolean; html: boolean }): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer", // o endereço do espaço de um usuário tem um ID que não deve vazar
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    ...(o.https ? { "strict-transport-security": HSTS } : {}),
    ...(o.html ? { "content-security-policy": CSP } : {}),
  };
}

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * O pedido que muda estado veio de outro site? Navegador sempre manda Sec-Fetch-Site e/ou Origin nesses pedidos; o script de envio
 * (token no cabeçalho) e o curl não mandam nenhum dos dois, e cookie só vai por navegador, então sem eles o pedido passa.
 * O Origin vale se for o do próprio site: o endereço configurado ou o Host que o navegador usou (vários domínios, proxy, porta de teste).
 */
export function isCrossSite(headers: IncomingHttpHeaders, publicHost: string): boolean {
  const fetchSite = headers["sec-fetch-site"];
  if (typeof fetchSite === "string" && fetchSite !== "same-origin" && fetchSite !== "none") return true;
  const origin = headers.origin;
  if (typeof origin !== "string") return false;
  try {
    const host = new URL(origin).host.toLowerCase();
    return host !== publicHost.toLowerCase() && host !== String(headers.host ?? "").toLowerCase();
  } catch {
    return true; // "null" (página isolada) ou texto que não é endereço
  }
}
