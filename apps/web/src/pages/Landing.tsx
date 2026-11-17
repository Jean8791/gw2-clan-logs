import { useEffect } from "react";
import { LogIn } from "lucide-react";
import { Button, Loading } from "../components/ui";
import { useConfig, useViewer } from "../lib/api";
import { t } from "../lib/i18n";

/** Página inicial (fora de qualquer espaço): quem já está logado vai direto para o seu espaço. */
export function LandingPage() {
  const { data: cfg } = useConfig();
  const viewer = useViewer();

  useEffect(() => {
    if (viewer.data) window.location.replace(`/u/${viewer.data.publicId}`);
  }, [viewer.data]);

  if (viewer.isLoading || viewer.data) return <Loading />;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <img src="/favicon.svg" alt="" className="size-14" />
      <h1 className="font-display text-2xl font-bold tracking-wider text-gold">{t("landing.title")}</h1>
      <p className="text-sm text-muted">{t("landing.subtitle")}</p>
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
