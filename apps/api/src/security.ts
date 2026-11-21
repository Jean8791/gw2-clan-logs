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

/**
 * Relatório HTML do Elite Insights: tem scripts próprios (a CSP do site os quebraria) e é gerado a partir de um arquivo enviado por terceiros.
 * `sandbox` sem `allow-same-origin` o põe numa origem opaca: roda scripts, mas não alcança o cookie da sessão nem a API do site.
 */
const REPORT_CSP = "sandbox allow-scripts";

/**
 * O relatório do Elite Insights lê `window.localStorage` (tema) sem tratar erro, e na origem opaca do sandbox esse acesso lança SecurityError:
 * sem isto o relatório trava em "Loading data...". Anulado, ele segue sem guardar o tema (o código dele já trata a falta de storage).
 */
const NO_STORAGE_SHIM = '<script>try{window.localStorage}catch(e){Object.defineProperty(window,"localStorage",{value:null,configurable:true})}</script>';

/**
 * Põe o script acima logo depois do `<head>` do relatório, antes de qualquer script dele. Sem `<head>` (`<header>` não conta), entra depois do
 * doctype, que tem de continuar na primeira linha para o navegador não cair em quirks mode, ou no começo se não houver doctype.
 */
export const reportForSandbox = (html: string): string => {
  const inHead = html.replace(/<head(\s[^>]*)?>/i, (head) => head + NO_STORAGE_SHIM);
  if (inHead !== html) return inHead;
  const at = /^\s*<!doctype[^>]*>/i.exec(html)?.[0].length ?? 0;
  return html.slice(0, at) + NO_STORAGE_SHIM + html.slice(at);
};

/** 180 dias, sem subdomínios e sem preload: o navegador que já viu o site em https não volta para http. */
const HSTS = "max-age=15552000";

/** Cabeçalhos de toda resposta. A CSP do site só vai nas páginas HTML do site; o relatório do Elite Insights (`report`) leva só o sandbox. */
export function securityHeaders(o: { https: boolean; html: boolean; report: boolean }): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer", // o endereço do espaço de um usuário tem um ID que não deve vazar
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    ...(o.https ? { "strict-transport-security": HSTS } : {}),
    ...(o.html ? { "content-security-policy": o.report ? REPORT_CSP : CSP } : {}),
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
