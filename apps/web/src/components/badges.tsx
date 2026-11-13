import { useState } from "react";
import { Link } from "react-router-dom";
import { professionColor, PROFESSIONS } from "@gw2logs/shared";
import { useGuilds } from "../lib/api";
import { useMe } from "../lib/hooks";
import { accountShort } from "../lib/format";
import { cx } from "./ui";

/**
 * Emblema da classe (guardado no nosso servidor). A API do jogo entrega o emblema branco, então ele serve de máscara
 * e é pintado com a cor da classe. Enquanto carrega, ou se a imagem não existir, aparece o ponto colorido.
 */
export function ProfessionDot({ profession, className }: { profession: string | null; className?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const color = professionColor(profession);
  const url = profession && /^\w+$/.test(profession) ? `/api/media/prof:${profession}` : null;
  return (
    <>
      {url && state === "loading" && <img src={url} alt="" className="hidden" onLoad={() => setState("ok")} onError={() => setState("failed")} />}
      {url && state === "ok" ? (
        <span
          role="img"
          aria-label={profession ?? undefined}
          title={profession ?? undefined}
          className={cx("inline-block size-4 shrink-0", className)}
          style={{ backgroundColor: color, WebkitMaskImage: `url(${url})`, maskImage: `url(${url})`, WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center" }}
        />
      ) : (
        <span className={cx("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} title={profession ?? undefined} />
      )}
    </>
  );
}

export function Profession({ profession }: { profession: string | null }) {
  const base = profession ? PROFESSIONS[profession]?.base : null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" title={base && base !== profession ? base : undefined}>
      <ProfessionDot profession={profession} />
      <span style={{ color: professionColor(profession) }}>{profession ?? "?"}</span>
    </span>
  );
}

export function useGuildIndex() {
  const { data } = useGuilds();
  return new Map((data ?? []).map((g) => [g.id, g]));
}

export function GuildTag({ id, withName = false }: { id: string | null; withName?: boolean }) {
  const guilds = useGuildIndex();
  if (!id) return <span className="text-faint">—</span>;
  const g = guilds.get(id);
  const label = g?.tag ? `[${g.tag}]` : "[?]";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={g?.name ?? id}>
      <span className={cx("rounded px-1 py-px text-[11px] font-bold", g?.inAlliance ? "bg-gold-soft text-gold" : "bg-surface-3 text-muted")}>{label}</span>
      {withName && <span className="truncate text-sm text-muted">{g?.name ?? "Guilda desconhecida"}</span>}
    </span>
  );
}

export function PlayerLink({ account, name }: { account: string; name?: string | null }) {
  const me = useMe();
  return (
    <Link to={`/jogadores/${encodeURIComponent(account)}`} className="group flex min-w-0 flex-col leading-tight">
      <span className={cx("truncate font-medium group-hover:text-gold", me === account ? "text-gold" : "text-text")}>
        {name ?? accountShort(account)}
        {me === account && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider">você</span>}
      </span>
      <span className="truncate text-xs text-faint">{account}</span>
    </Link>
  );
}
