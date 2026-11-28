import { useSearchParams } from "react-router-dom";
import { useLoginExpired } from "../lib/api";
import { t } from "../lib/i18n";

const DENIED = ["notInGuild", "notAllowed", "badState", "loginFailed"] as const;

/**
 * Aviso no topo quando o login não deu certo. O servidor volta para a página inicial com ?erro=: notInGuild (fora dos servidores
 * do clã), notAllowed (fora da lista de usuários), badState (tentativa expirada ou interrompida) ou loginFailed (o Discord falhou).
 * Sessão vencida (a conferência dos servidores do Discord) também avisa, sem redirecionar sozinha.
 */
export function LoginNotice() {
  const [params] = useSearchParams();
  const expired = useLoginExpired();
  const erro = params.get("erro");
  const denied = DENIED.find((d) => d === erro);
  if (denied)
    return (
      <p role="alert" className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-bad">
        {t(`landing.${denied}`)}
      </p>
    );
  if (expired)
    return (
      <p role="alert" className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
        {t("api.loginExpired")}
      </p>
    );
  return null;
}
