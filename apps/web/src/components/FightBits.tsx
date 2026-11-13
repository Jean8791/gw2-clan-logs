import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { Fight } from "@gw2logs/shared";
import { fightErrorText } from "../lib/errors";
import { t } from "../lib/i18n";
import { Badge } from "./ui";

export function FightStatus({ fight }: { fight: Fight }) {
  if (fight.status === "done") return null;
  if (fight.status === "error")
    return (
      <Badge tone="bad" className="max-w-xs truncate">
        <XCircle className="size-3" /> {fight.error ? fightErrorText(fight.error) : t("fight.status.error")}
      </Badge>
    );
  return (
    <Badge tone="info">
      {fight.status === "parsing" ? <Loader2 className="size-3 animate-spin" /> : <Clock className="size-3" />}
      {fight.status === "parsing" ? t("fight.status.parsing") : t("fight.status.queued")}
    </Badge>
  );
}

/** Kills × mortes do squad, com cor pelo saldo. */
export function KillDeath({ kills, deaths }: { kills: number | null; deaths: number | null }) {
  const k = kills ?? 0;
  const d = deaths ?? 0;
  return (
    <span className="tabular inline-flex items-center gap-1 font-medium">
      <span className="text-good">{k}</span>
      <span className="text-faint">/</span>
      <span className="text-bad">{d}</span>
    </span>
  );
}

export function SquadVsEnemy({ fight }: { fight: Fight }) {
  return (
    <span className="tabular text-sm">
      <span className="text-text">{fight.squadCount ?? "?"}</span>
      {fight.allyCount ? <span className="text-faint"> +{fight.allyCount}</span> : null}
      <span className="mx-1.5 text-faint">vs</span>
      <span className="text-bad/90">{fight.enemyCount ?? "?"}</span>
    </span>
  );
}

export function Won({ fight }: { fight: Fight }) {
  const k = fight.squadKills ?? 0;
  const d = fight.squadDeaths ?? 0;
  if (fight.mode !== "wvw") return fight.success ? <CheckCircle2 className="size-4 text-good" /> : <XCircle className="size-4 text-bad" />;
  if (k === 0 && d === 0) return <span className="inline-block size-2 rounded-full bg-faint" title={t("fight.won.none")} />;
  return <span className={`inline-block size-2 rounded-full ${k >= d ? "bg-good" : "bg-bad"}`} title={k >= d ? t("fight.won.positive") : t("fight.won.negative")} />;
}
