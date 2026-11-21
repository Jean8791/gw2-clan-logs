import { useEffect } from "react";
import { LogIn } from "lucide-react";
import { RetentionNotice } from "../components/RetentionNotice";
import { Button, Loading } from "../components/ui";
import { useConfig, useLoginExpired, useViewer } from "../lib/api";
import { t } from "../lib/i18n";

/** Página inicial (fora de qualquer espaço): quem já está logado vai direto para o seu espaço. */
export function LandingPage() {
  const { data: cfg } = useConfig();
  const viewer = useViewer();
  const expired = useLoginExpired();

  useEffect(() => {
    if (viewer.data) window.location.replace(`/u/${viewer.data.publicId}`);
  }, [viewer.data]);

  if (viewer.isLoading || viewer.data) return <Loading />;

  // o login que não deu certo volta para cá com ?erro=: notInGuild (fora dos servidores do clã), notAllowed (fora da lista de usuários),
  // badState (tentativa expirada ou interrompida) ou loginFailed (o Discord falhou)
  const erro = new URLSearchParams(window.location.search).get("erro");
  const loginDenied = erro === "notInGuild" || erro === "notAllowed" || erro === "badState" || erro === "loginFailed" ? erro : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <img src="/favicon.svg" alt="" className="size-14" />
      <h1 className="font-display text-2xl font-bold tracking-wider text-gold">{t("landing.title")}</h1>
      <p className="text-sm text-muted">{t("landing.subtitle")}</p>
      <RetentionNotice />
      {expired && !loginDenied && (
        <p role="alert" className="text-sm text-muted">
          {t("api.loginExpired")}
        </p>
      )}
      {loginDenied && (
        <p role="alert" className="text-sm text-bad">
          {t(`landing.${loginDenied}`)}
        </p>
      )}
      {cfg?.loginAvailable === false ? (
        <p className="text-sm text-faint">{t("landing.loginOff")}</p>
      ) : (
        <a href="/api/auth/login">
          <Button variant="primary">
            <LogIn className="size-4" /> {t("space.signIn")}
          </Button>
        </a>
      )}
    </div>
  );
}
