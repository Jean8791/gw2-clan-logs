import { BarChart3, GitCompareArrows, Home, Shield, Swords, Upload, UserRound } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useMe } from "../lib/hooks";
import { accountShort } from "../lib/format";
import { cx } from "./ui";

const NAV = [
  { to: "/", label: "Visão geral", icon: Home, end: true },
  { to: "/lutas", label: "Lutas", icon: Swords },
  { to: "/ranking", label: "Ranking", icon: BarChart3 },
  { to: "/comparar", label: "Comparar", icon: GitCompareArrows },
  { to: "/guildas", label: "Guildas", icon: Shield },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8" />
      <div className="leading-tight">
        <div className="font-display text-base font-bold tracking-wider text-gold">Logs do Clã</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-faint">GW2 · WvW</div>
      </div>
    </div>
  );
}

export function Layout() {
  const me = useMe();
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
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          <NavLink to="/eu" className={({ isActive }) => link(isActive)}>
            <UserRound className="size-4" />
            <span className="truncate">{me ? accountShort(me) : "Meu perfil"}</span>
          </NavLink>
          <NavLink to="/enviar" className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-gold px-3 py-2.5 text-sm font-semibold text-[#1a1408] transition hover:brightness-110">
            <Upload className="size-4" /> Enviar logs
          </NavLink>
        </div>
      </aside>

      {/* topo (celular) */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Brand />
          <NavLink to="/enviar" className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-[#1a1408]">
            <Upload className="size-3.5" /> Enviar
          </NavLink>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {[...NAV, { to: "/eu", label: "Eu", icon: UserRound, end: false }].map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx(link(isActive), "shrink-0 px-2.5 py-1.5 text-xs")}>
              <Icon className="size-3.5" /> {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1400px] min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
