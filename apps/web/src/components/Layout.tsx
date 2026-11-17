import { BarChart3, CalendarDays, ChevronUp, GitCompareArrows, Home, Link2, LogIn, LogOut, Shield, Swords, Trash2, Upload, UserRound } from "lucide-react";
import { useState } from "react";
import { ROUTES } from "@gw2logs/shared";
import { NavLink, Outlet } from "react-router-dom";
import { deleteAccount, logout, useOwner, useViewer } from "../lib/api";
import { spaceBase, spaceId } from "../lib/space";
import { setLang, useLang, useT } from "../lib/i18n";
import { Button, Empty, Segmented, cx } from "./ui";

const NAV = [
  { to: ROUTES.overview, label: "nav.overview", icon: Home, end: true },
  { to: ROUTES.days, label: "nav.days", icon: CalendarDays },
  { to: ROUTES.fights, label: "nav.fights", icon: Swords },
  { to: ROUTES.ranking, label: "nav.ranking", icon: BarChart3 },
  { to: ROUTES.compare, label: "nav.compare", icon: GitCompareArrows },
  { to: ROUTES.guilds, label: "nav.guilds", icon: Shield },
  { to: ROUTES.me, label: "nav.myProfile", icon: UserRound },
];

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

/** Quem está logado: o nome abre o menu com sair e apagar conta. Sem login, o botão de entrar. */
function AccountMenu() {
  const t = useT();
  const viewer = useViewer();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text";
  if (!viewer.data) {
    return (
      <a href="/api/auth/login" className={item}>
        <LogIn className="size-4" /> {t("space.signIn")}
      </a>
    );
  }
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
          {confirming ? (
            <div className="space-y-2 p-2 text-xs text-bad">
              <p>{t("account.deleteWarn")}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => leave(deleteAccount)} disabled={busy}>
                  {t("account.deleteConfirm")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  {t("account.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <button className={cx(item, "hover:text-bad")} onClick={() => setConfirming(true)}>
              <Trash2 className="size-4" /> {t("account.delete")}
            </button>
          )}
        </div>
      )}
      <button
        className={cx(item, "justify-between font-medium text-text")}
        onClick={() => (setOpen(!open), setConfirming(false))}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <UserRound className="size-4 shrink-0" />
          <span className="truncate">{viewer.data.name}</span>
        </span>
        <ChevronUp className={cx("size-4 shrink-0 transition", !open && "rotate-180")} />
      </button>
    </div>
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

/** Copia o endereço deste espaço, para compartilhar. */
function CopyLink() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}${spaceBase}`).then(() => {
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

export function Layout() {
  const owner = useOwner();
  const viewer = useViewer();
  // só o dono, logado, importa logs no próprio espaço
  const nav = viewer.data && viewer.data.publicId === spaceId ? [...NAV, { to: ROUTES.import, label: "nav.import", icon: Upload, end: false }] : NAV;
  const lang = useLang();
  const t = useT();
  const link = (active: boolean) =>
    cx(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
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
              <Icon className="size-4" /> {t(label)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <AccountMenu />
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
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx(link(isActive), "shrink-0 px-2.5 py-1.5 text-xs")}>
              <Icon className="size-3.5" /> {t(label)}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1400px] min-w-0 px-4 pb-6 pt-6 sm:px-6 md:pt-4 lg:px-10 lg:pb-10 lg:pt-5">
        {/* link e idioma: canto superior direito (no celular ficam no cabeçalho) */}
        <div className="mb-3 hidden items-center justify-end gap-2 md:flex">
          <CopyLink />
          <LangToggle />
        </div>
        {/* key: ao trocar o idioma a tela é refeita, e os textos e números saem no idioma novo */}
        {owner.isError ? <Empty title={t("space.notFound")} /> : <Outlet key={lang} />}
      </main>
    </div>
  );
}
