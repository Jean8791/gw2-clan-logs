import { BarChart3, CalendarDays, CalendarRange, ChevronUp, GitCompareArrows, Home, Link2, LogIn, LogOut, Shield, Swords, Trash2, Upload, UserRound, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ROUTES } from "@gw2logs/shared";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { deleteAccount, logout, useConfig, useMeta, useViewer } from "../lib/api";
import { useMe } from "../lib/hooks";
import { setLang, useLang, useT } from "../lib/i18n";
import { LoginNotice } from "./LoginNotice";
import { Button, Input, Segmented, cx } from "./ui";

/** O menu em grupos: o panorama do clã, as lutas, os jogadores e, para quem está logado, a conta. Cada grupo tem um título na barra lateral. */
type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "nav.group.overview",
    items: [
      { to: ROUTES.overview, label: "nav.overview", icon: Home, end: true },
      { to: ROUTES.months, label: "nav.months", icon: CalendarRange },
    ],
  },
  {
    title: "nav.group.fights",
    items: [
      { to: ROUTES.days, label: "nav.days", icon: CalendarDays },
      { to: ROUTES.fights, label: "nav.fights", icon: Swords },
    ],
  },
  {
    title: "nav.group.players",
    items: [
      { to: ROUTES.ranking, label: "nav.ranking", icon: BarChart3 },
      { to: ROUTES.compare, label: "nav.compare", icon: GitCompareArrows },
      { to: ROUTES.guilds, label: "nav.guilds", icon: Shield },
    ],
  },
];
const ME = { to: ROUTES.me, label: "nav.myProfile", icon: UserRound, end: false };
const IMPORT = { to: ROUTES.import, label: "nav.import", icon: Upload, end: false };
/** Quem está logado ganha o grupo da conta: o Meu perfil e o Importar logs. */
const ACCOUNT_GROUP: { title: string; items: NavItem[] } = { title: "nav.group.account", items: [ME, IMPORT] };

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

/**
 * "Meu perfil" para quem não está logado: em vez de abrir a tela, oferece duas opções. Meu perfil leva à escolha do jogador (que fica
 * guardada no navegador); Entrar leva ao login do Discord e, depois dele, volta para esta mesma tela. Só entra quem tem autorização.
 * O painel sai num portal: o cabeçalho e a barra lateral têm filtro de fundo e rolagem, que prenderiam um painel posicionado dentro deles.
 */
function ProfileMenu({ className }: { className: string }) {
  const t = useT();
  const { data: cfg } = useConfig();
  const { pathname, search } = useLocation();
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setPos(null);
  const toggle = () => {
    if (pos) return close();
    const r = button.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 232));
    // embaixo da tela (a barra lateral) o painel abre para cima; no topo (celular), para baixo
    setPos(r.top > window.innerHeight / 2 ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  };

  useEffect(() => {
    if (!pos) return;
    const outside = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", close);
    };
  }, [pos]);
  // trocar de tela fecha o painel
  useEffect(close, [pathname]);

  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text";
  const signIn = `/api/auth/login?next=${encodeURIComponent(pathname + search)}`;
  return (
    <>
      <button ref={button} type="button" className={className} onClick={toggle} aria-haspopup="menu" aria-expanded={pos !== null}>
        <ME.icon className="size-4" /> <NavLabel label={ME.label} />
      </button>
      {pos &&
        createPortal(
          <div ref={panel} role="menu" style={pos} className="fixed z-50 w-56 rounded-lg border border-line bg-surface-2 p-1 shadow-lg">
            <NavLink to={ME.to} role="menuitem" className={item} onClick={close}>
              <ME.icon className="size-4" /> {t("nav.myProfile")}
            </NavLink>
            {cfg?.loginAvailable !== false && (
              <a href={signIn} role="menuitem" className={item}>
                <LogIn className="size-4" /> {t("space.signIn")}
              </a>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export function Layout() {
  const viewer = useViewer();
  // quem está logado vê o Meu Perfil na lista, o Importar logs e o menu da conta. Quem não está vê o menu Meu perfil / Entrar, embaixo
  // (no celular, no fim da lista). O Meu Perfil é do navegador de quem usa, não depende de login.
  const logged = !!viewer.data;
  const groups = logged ? [...GROUPS, ACCOUNT_GROUP] : GROUPS;
  const t = useT();
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
        <nav className="mt-7 flex flex-col gap-5 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.title} className="flex flex-col gap-1">
              <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">{t(g.title)}</div>
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) => link(isActive)}>
                  <Icon className="size-4" /> <NavLabel label={label} />
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-auto">
          {viewer.data ? (
            <AccountMenu name={viewer.data.name} />
          ) : (
            // enquanto o login ainda carrega, nada aparece embaixo (evita piscar o Meu Perfil para quem está logado)
            !viewer.isLoading && <ProfileMenu className={cx(link(false), "w-full")} />
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
        <nav className="flex items-center gap-1 overflow-x-auto px-3 pb-2">
          {groups.map((g, i) => (
            <div key={g.title} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span aria-hidden className="mx-1 h-4 w-px bg-line" />}
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) => cx(link(isActive), "shrink-0 px-2.5 py-1.5 text-xs")}>
                  <Icon className="size-3.5" /> <NavLabel label={label} />
                </NavLink>
              ))}
            </div>
          ))}
          {!logged && !viewer.isLoading && <ProfileMenu className={cx(link(false), "shrink-0 px-2.5 py-1.5 text-xs")} />}
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
      </main>
    </div>
  );
}
