import { useMediaQuery } from "../lib/media-query";
import { SHORT_SCREEN } from "../lib/screen";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { Filters, PlayerOptions, Role } from "@gw2logs/shared";
import { useDays, useGuilds, useMeta } from "../lib/api";
import { dayLabel, instantToLocal, localToInstant } from "../lib/format";
import { useT } from "../lib/i18n";
import { Button, Input, Select, cx } from "./ui";

type Field = "period" | "day" | "map" | "size" | "duration" | "guild" | "role" | "profession";

const SIZES = [
  { id: "", label: "filter.size.any", min: undefined, max: undefined },
  { id: "roam", label: "filter.size.roam", min: undefined, max: 10 },
  { id: "group", label: "filter.size.group", min: 10, max: 25 },
  { id: "zerg", label: "filter.size.zerg", min: 25, max: undefined },
] as const;

const sizeId = (f: Filters) => SIZES.find((s) => s.min === f.minSquad && s.max === f.maxSquad)?.id ?? "custom";

/** A lista com o valor escolhido (da URL) no fim, se ele não estiver nela: o seletor nunca fica em branco. */
const withCurrent = <T extends string>(list: T[], current: T | undefined): T[] => (current && !list.includes(current) ? [...list, current] : list);

/**
 * `options` (página do jogador): troca as listas fixas de função e de classe e a lista de dias do espaço pelas que o jogador jogou.
 */
export function FilterBar({ value, onChange, fields, options }: { value: Filters; onChange: (f: Filters) => void; fields: Field[]; options?: PlayerOptions }) {
  const t = useT();
  const { data: meta } = useMeta();
  const { data: guilds } = useGuilds();
  const { data: spaceDays } = useDays({ ...value, day: undefined }, fields.includes("day") && !options);
  const days = options?.days ?? spaceDays;
  const roles = withCurrent<Role>(options?.roles ?? ["dps", "support"], value.role);
  const professions = withCurrent(options?.professions ?? meta?.professions ?? [], value.profession);
  const [open, setOpen] = useState(false);
  // em tela baixa os filtros começam recolhidos (como no celular), para a tabela ficar com o espaço
  const short = useMediaQuery(SHORT_SCREEN);
  const has = (f: Field) => fields.includes(f);
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const custom = !!(value.from || value.to);
  const active = Object.keys(value).length;
  const alliance = (guilds ?? []).filter((g) => g.inAlliance);
  const others = (guilds ?? []).filter((g) => !g.inAlliance && g.name);

  return (
    <div className="mb-5 rounded-2xl border border-line bg-surface/60 p-3">
      <div className={cx("flex items-center justify-between gap-2", !short && "md:hidden")}>
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
          <SlidersHorizontal className="size-4" /> {t("filter.title")} {active > 0 && <span className="text-gold">({active})</span>}
        </Button>
        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange({})}>
            <RotateCcw className="size-3.5" /> {t("filter.clear")}
          </Button>
        )}
      </div>
      <div className={cx("grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-[repeat(auto-fit,minmax(190px,1fr))] md:items-end", open ? "mt-3 grid" : short ? "hidden" : "hidden md:grid")}>
        {has("period") && (
          <Select
            label={t("filter.period")}
            value={custom ? "custom" : String(value.days ?? "")}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") set({ days: undefined, from: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10) });
              else set({ days: v ? Number(v) : undefined, from: undefined, to: undefined });
            }}
          >
            <option value="">{t("filter.period.all")}</option>
            <option value="1">{t("filter.period.24h")}</option>
            <option value="7">{t("filter.period.7d")}</option>
            <option value="30">{t("filter.period.30d")}</option>
            <option value="90">{t("filter.period.90d")}</option>
            <option value="custom">{t("filter.period.custom")}</option>
          </Select>
        )}
        {has("day") && (
          <Select
            label={t("filter.day")}
            value={value.day?.length === 1 ? value.day[0] : value.day?.length ? "varios" : ""}
            onChange={(e) => set({ day: e.target.value && e.target.value !== "varios" ? [e.target.value] : undefined })}
          >
            <option value="">{t("filter.day.all")}</option>
            {(value.day?.length ?? 0) > 1 && <option value="varios">{t("filter.day.many", { n: value.day!.length })}</option>}
            {value.day?.length === 1 && !(days ?? []).some((d) => d.day === value.day![0]) && <option value={value.day[0]}>{dayLabel(value.day[0]!)}</option>}
            {(days ?? []).map((d) => (
              <option key={d.day} value={d.day}>
                {dayLabel(d.day)} · {t("filter.day.fights", { n: d.fights })}
              </option>
            ))}
          </Select>
        )}
        {has("period") && custom && (
          <>
            <Input label={t("filter.from")} type="datetime-local" value={instantToLocal(value.from)} onChange={(e) => set({ from: localToInstant(e.target.value) })} />
            <Input label={t("filter.to")} type="datetime-local" value={instantToLocal(value.to, true)} onChange={(e) => set({ to: localToInstant(e.target.value) })} />
          </>
        )}
        {has("guild") && (
          <Select label={t("filter.guild")} value={value.guild ?? ""} onChange={(e) => set({ guild: e.target.value || undefined })}>
            <option value="">{t("filter.guild.all")}</option>
            <option value="alliance">{t("filter.guild.alliance")}</option>
            {alliance.length > 0 && (
              <optgroup label={t("filter.guild.allianceGroup")}>
                {alliance.map((g) => (
                  <option key={g.id} value={g.id}>
                    [{g.tag}] {g.name}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={t("filter.guild.othersGroup")}>
                {others.map((g) => (
                  <option key={g.id} value={g.id}>
                    [{g.tag}] {g.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        )}
        {has("role") && (
          <Select label={t("filter.role")} value={value.role ?? ""} onChange={(e) => set({ role: (e.target.value || undefined) as Role | undefined })}>
            <option value="">{t("filter.role.all")}</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`filter.role.${r}`)}
              </option>
            ))}
          </Select>
        )}
        {has("profession") && (
          <Select label={t("filter.class")} value={value.profession ?? ""} onChange={(e) => set({ profession: e.target.value || undefined })}>
            <option value="">{t("filter.class.all")}</option>
            {professions.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        )}
        {has("size") && (
          <Select
            label={t("filter.size")}
            value={sizeId(value)}
            onChange={(e) => {
              const s = SIZES.find((x) => x.id === e.target.value);
              if (s) set({ minSquad: s.min, maxSquad: s.max });
            }}
          >
            {SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.label)}
              </option>
            ))}
            {sizeId(value) === "custom" && <option value="custom">{t("filter.size.custom")}</option>}
          </Select>
        )}
        {has("duration") && (
          <Select label={t("filter.duration")} value={String(value.minDurationSec ?? "")} onChange={(e) => set({ minDurationSec: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">{t("filter.duration.any")}</option>
            <option value="30">30 s</option>
            <option value="60">1 min</option>
            <option value="120">2 min</option>
            <option value="300">5 min</option>
          </Select>
        )}
        {has("map") && (
          <Select label={t("filter.map")} value={String(value.map ?? "")} onChange={(e) => set({ map: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">{t("filter.map.all")}</option>
            {meta?.maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? t("filter.map.unnamed", { id: m.id })}
              </option>
            ))}
          </Select>
        )}
        {active > 0 && (
          <Button variant="ghost" size="sm" className="hidden h-9 md:inline-flex" onClick={() => onChange({})}>
            <RotateCcw className="size-3.5" /> {t("filter.clearAll")}
          </Button>
        )}
      </div>
    </div>
  );
}
