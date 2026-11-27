import { BarChart3, CalendarDays, ChevronUp, GitCompareArrows, Home, Link2, LogIn, LogOut, Shield, Swords, Trash2, Upload, UserRound } from "lucide-react";
import { useState } from "react";
import { ROUTES } from "@gw2logs/shared";
import { NavLink, Outlet } from "react-router-dom";
import { deleteAccount, logout, useConfig, useMeta, useViewer } from "../lib/api";
import { useMe } from "../lib/hooks";
import { setLang, useLang, useT } from "../lib/i18n";
import { LoginNotice } from "./LoginNotice";
import { RetentionNotice } from "./RetentionNotice";
import { Button, Input, Segmented, cx } from "./ui";

const NAV = [
  { to: ROUTES.overview, label: "nav.overview", icon: Home, end: true },
  { to: ROUTES.days, label: "nav.days", icon: CalendarDays },
  { to: ROUTES.fights, label: "nav.fights", icon: Swords },
  { to: ROUTES.ranking, label: "nav.ranking", icon: BarChart3 },
  { to: ROUTES.compare, label: "nav.compare", icon: GitCompareArrows },
  { to: ROUTES.guilds, label: "nav.guilds", icon: Shield },
];
const ME = { to: ROUTES.me, label: "nav.myProfile", icon: UserRound, end: false };
const IMPORT = { to: ROUTES.import, label: "nav.import", icon: Upload, end: false };

/** Botão PT | EN. A escolha fica salva no navegador, e a tela é refeita no idioma novo. */
function LangToggle() {
  const lang = useLang();
  return (
    <div aria-label={useT()("lang.label")}>
      <Segmented
        size="sm"
        value={lang}
        onChange={setLang}
        options={[
          { value: "pt", label: "PT" },
          { value: "en", label: "EN" },
        ]}
      />
    </div>
  );
}

/** Quem está logado: o nome abre o menu com sair e apagar conta. */
function AccountMenu({ name }: { name: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text";
  const leave = (action: () => Promise<unknown>) => {
    setBusy(true);
    void action().then(() => window.location.assign("/"), () => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-1">
      {open && (
        <div className="rounded-lg border border-line bg-surface-2 p-1">
          <button className={item} onClick={() => leave(logout)} disabled={busy}>
            <LogOut className="size-4" /> {t("space.signOut")}
          </button>
          {deleting ? (
            <div className="space-y-2 p-2 text-xs text-bad">
              <p>{t("account.deleteWarn")}</p>
              <Input label={t("account.deleteType", { name })} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => leave(() => deleteAccount(typed))} disabled={busy || typed !== name}>
                  {t("account.deleteConfirm")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => (setDeleting(false), setTyped(""))} disabled={busy}>
                  {t("account.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <button className={cx(item, "hover:text-bad")} onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" /> {t("account.delete")}
            </button>
          )}
        </div>
      )}
      <button
        className={cx(item, "justify-between font-medium text-text")}
        onClick={() => (setOpen(!open), setDeleting(false), setTyped(""))}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <UserRound className="size-4 shrink-0" />
          <span className="truncate">{name}</span>
        </span>
        <ChevronUp className={cx("size-4 shrink-0 transition", !open && "rotate-180")} />
      </button>
    </div>
  );
}

/** O texto de um item do menu. O "Meu perfil", depois de a pessoa escolher quem ela é, mostra o nome do jogador escolhido. */
function NavLabel({ label }: { label: string }) {
  const t = useT();
  const me = useMe();
  return label === ME.label && me ? <MyName account={me} /> : <>{t(label)}</>;
}

/** Nome do jogador escolhido (o da luta mais recente dele). Enquanto a lista carrega, ou se ele não está aqui, fica "Meu perfil". */
function MyName({ account }: { account: string }) {
  const t = useT();
  const { data } = useMeta();
  const name = data?.players.find((p) => p.account === account)?.name;
  return (
    <span className="truncate" title={t("nav.myProfile")}>
      {name ?? t("nav.myProfile")}
    </span>
  );
}

function Brand() {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8" />
      <div className="leading-tight">
        <div className="font-display text-base font-bold tracking-wider text-gold">{t("brand.name")}</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-faint">GW2 · WvW</div>
      </div>
    </div>
  );
}

/** Copia o endereço da página aberta (com os filtros), para compartilhar. */
function CopyLink() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Button size="sm" variant="ghost" onClick={copy}>
      <Link2 className="size-3.5" /> {copied ? t("common.linkCopied") : t("common.copyLink")}
    </Button>
  );
}

/** Entrar com o Discord, no fim da página, para qualquer visitante: só entra quem tem autorização. */
function SignInFooter() {
  const t = useT();
  const { data: cfg } = useConfig();
  const viewer = useViewer();
  if (viewer.isLoading || viewer.data || cfg?.loginAvailable === false) return null;
  return (
    <footer className="mt-8 flex justify-center">
      <a href="/api/auth/login">
        <Button size="sm" variant="ghost">
          <LogIn className="size-3.5" /> {t("space.signIn")}
        </Button>
      </a>
    </footer>
  );
}

export function Layout() {
  const viewer = useViewer();
  // quem está logado vê o Meu Perfil na lista, o Importar logs e o menu da conta. Quem não está vê só o Meu Perfil, embaixo
  // (no celular não há "embaixo": lá ele entra na lista). O Meu Perfil é do navegador de quem usa, não depende de login.
  const logged = !!viewer.data;
  const nav = logged ? [...NAV, ME, IMPORT] : NAV;
  const mobileNav = logged ? nav : [...NAV, ME];
  const lang = useLang();
  const link = (active: boolean) =>
    cx(
      "flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
      active ? "bg-gold-soft text-gold" : "text-muted hover:bg-surface-2 hover:text-text",
    );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      {/* barra lateral (desktop) */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface/60 px-3 py-5 backdrop-blur md:flex">
        <div className="px-2">
          <Brand />
        </div>
        <nav className="mt-8 flex flex-col gap-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => link(isActive)}>
              <Icon className="size-4" /> <NavLabel label={label} />
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          {viewer.data ? (
            <AccountMenu name={viewer.data.name} />
          ) : (
            // enquanto o login ainda carrega, nada aparece embaixo (evita piscar o Meu Perfil para quem está logado)
            !viewer.isLoading && (
              <NavLink to={ME.to} className={({ isActive }) => link(isActive)}>
                <ME.icon className="size-4" /> <NavLabel label={ME.label} />
              </NavLink>
            )
          )}
        </div>
      </aside>

      {/* topo (celular) */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Brand />
          <div className="flex items-center gap-2">
            <CopyLink />
            <LangToggle />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {mobileNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx(link(isActive), "shrink-0 px-2.5 py-1.5 text-xs")}>
              <Icon className="size-3.5" /> <NavLabel label={label} />
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1400px] min-w-0 px-4 pb-6 pt-6 sm:px-6 md:pt-4 lg:px-10 lg:pb-10 lg:pt-5">
        {/* link e idioma: canto superior direito (no celular ficam no cabeçalho) */}
        <div className="mb-3 hidden shrink-0 items-center justify-end gap-2 md:flex">
          <CopyLink />
          <LangToggle />
        </div>
        {/* key: ao trocar o idioma a tela é refeita, e os textos e números saem no idioma novo */}
        <LoginNotice />
        <Outlet key={lang} />
        {/* toda tela mostra dados que somem depois de um tempo: o aviso fica no fim da página */}
        <div className="mt-8">
          <RetentionNotice />
        </div>
        <SignInFooter />
      </main>
    </div>
  );
}
