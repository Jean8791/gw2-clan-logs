import { BarChart3, CalendarDays, GitCompareArrows, Home, Shield, Swords, Upload, UserRound } from "lucide-react";
import { ROUTES } from "@gw2logs/shared";
import { NavLink, Outlet } from "react-router-dom";
import { useMe } from "../lib/hooks";
import { accountShort } from "../lib/format";
import { setLang, useLang, useT } from "../lib/i18n";
import { Segmented, cx } from "./ui";

const NAV = [
  { to: ROUTES.overview, label: "nav.overview", icon: Home, end: true },
  { to: ROUTES.days, label: "nav.days", icon: CalendarDays },
  { to: ROUTES.fights, label: "nav.fights", icon: Swords },
  { to: ROUTES.ranking, label: "nav.ranking", icon: BarChart3 },
  { to: ROUTES.compare, label: "nav.compare", icon: GitCompareArrows },
  { to: ROUTES.guilds, label: "nav.guilds", icon: Shield },
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

export function Layout() {
  const me = useMe();
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
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => link(isActive)}>
              <Icon className="size-4" /> {t(label)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          <NavLink to={ROUTES.me} className={({ isActive }) => link(isActive)}>
            <UserRound className="size-4" />
            <span className="truncate">{me ? accountShort(me) : t("nav.myProfile")}</span>
          </NavLink>
          <NavLink to={ROUTES.upload} className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-gold px-3 py-2.5 text-sm font-semibold text-[#1a1408] transition hover:brightness-110">
            <Upload className="size-4" /> {t("nav.upload")}
          </NavLink>
        </div>
      </aside>

      {/* topo (celular) */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Brand />
          <div className="flex items-center gap-2">
            <LangToggle />
            <NavLink to={ROUTES.upload} className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-[#1a1408]">
              <Upload className="size-3.5" /> {t("nav.uploadShort")}
            </NavLink>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {[...NAV, { to: ROUTES.me, label: "nav.me", icon: UserRound, end: false }].map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx(link(isActive), "shrink-0 px-2.5 py-1.5 text-xs")}>
              <Icon className="size-3.5" /> {t(label)}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1400px] min-w-0 px-4 pb-6 pt-6 sm:px-6 md:pt-4 lg:px-10 lg:pb-10 lg:pt-5">
        {/* idioma: canto superior direito (no celular o botão fica no cabeçalho) */}
        <div className="mb-3 hidden justify-end md:flex">
          <LangToggle />
        </div>
        {/* key: ao trocar o idioma a tela é refeita, e os textos e números saem no idioma novo */}
        <Outlet key={lang} />
      </main>
    </div>
  );
}
