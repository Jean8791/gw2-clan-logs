import type { PlayerSkill, PlayerSupportSkill, SupportKind } from "@gw2logs/shared";
import { compact, int } from "../lib/format";
import { t } from "../lib/i18n";
import { DataTable, type Column } from "./DataTable";
import { BuffIcon, SkillIcon } from "./MediaIcon";

/** Quanto da cura (ou do dano) a habilidade representa: barra e %. */
function PctBar({ pct }: { pct: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-16 rounded-full bg-surface-3">
        <span className="block h-1.5 rounded-full bg-gold/70" style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="w-12 text-right">{pct.toFixed(1).replace(".", ",")}%</span>
    </span>
  );
}

const damageColumns: Column<PlayerSkill>[] = [
  {
    id: "skill",
    header: t("skills.col.skill"),
    sort: (k) => k.name ?? "",
    cell: (k) => (
      <span className="inline-flex items-center gap-2">
        <SkillIcon id={k.skillId} />
        {k.name ?? `#${k.skillId}`}
      </span>
    ),
  },
  { id: "damage", header: t("skills.col.damage"), align: "right", sort: (k) => k.damage, cell: (k) => compact(k.damage) },
  { id: "pct", header: t("skills.col.pct"), align: "right", sort: (k) => k.pct, cell: (k) => <PctBar pct={k.pct} /> },
  { id: "hits", header: t("skills.col.hits"), align: "right", sort: (k) => k.connectedHits, cell: (k) => int(k.connectedHits), title: t("skills.col.hitsTitle") },
  { id: "avg", header: t("skills.col.avg"), align: "right", sort: (k) => k.avgHit, cell: (k) => compact(k.avgHit) },
];

/** Dano por habilidade, da que mais causa dano para a que menos (as 25 primeiras). */
export function DamageSkillsTable({ rows }: { rows: PlayerSkill[] }) {
  return <DataTable rows={rows.slice(0, 25)} columns={damageColumns} rowKey={(k) => String(k.skillId)} dense />;
}

/** Cura e barreira: a habilidade indireta (efeito, como Regeneração) tem id de buff, então leva o ícone do buff. */
function supportColumns(kind: SupportKind): Column<PlayerSupportSkill>[] {
  return [
    {
      id: "skill",
      header: t("skills.col.skill"),
      sort: (k) => k.name ?? "",
      cell: (k) => (
        <span className="inline-flex items-center gap-2">
          {k.indirect ? <BuffIcon id={k.skillId} size={20} /> : <SkillIcon id={k.skillId} />}
          {k.name ?? `#${k.skillId}`}
        </span>
      ),
    },
    { id: "amount", header: t(kind === "barrier" ? "skills.col.shielded" : "skills.col.healed"), align: "right", sort: (k) => k.amount, cell: (k) => compact(k.amount) },
    { id: "pct", header: t(kind === "barrier" ? "skills.col.pctBarrier" : "skills.col.pctHeal"), align: "right", sort: (k) => k.pct, cell: (k) => <PctBar pct={k.pct} /> },
    ...(kind === "heal" ? [{ id: "downed", header: t("skills.col.downed"), title: t("skills.col.downedTitle"), align: "right" as const, sort: (k: PlayerSupportSkill) => k.downedAmount, cell: (k: PlayerSupportSkill) => compact(k.downedAmount) }] : []),
    { id: "hits", header: t("skills.col.applications"), title: t("skills.col.applicationsTitle"), align: "right", sort: (k) => k.hits, cell: (k) => int(k.hits) },
    { id: "avg", header: t("skills.col.avgSupport"), align: "right", sort: (k) => k.avgHit, cell: (k) => compact(k.avgHit) },
  ];
}

/** Cura ou barreira por habilidade, da que mais curou (ou protegeu) para a que menos (as 25 primeiras). */
export function SupportSkillsTable({ rows, kind }: { rows: PlayerSupportSkill[]; kind: SupportKind }) {
  return <DataTable key={kind} rows={rows.slice(0, 25)} columns={supportColumns(kind)} rowKey={(k) => `${k.indirect ? "b" : "s"}${k.skillId}`} dense />;
}
