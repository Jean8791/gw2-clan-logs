import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { Filters, Role } from "@gw2logs/shared";
import { useGuilds, useMeta } from "../lib/api";
import { Button, Input, Select, cx } from "./ui";

type Field = "period" | "map" | "size" | "duration" | "guild" | "role" | "profession";

const SIZES = [
  { id: "", label: "Qualquer tamanho", min: undefined, max: undefined },
  { id: "roam", label: "Roaming (até 10)", min: undefined, max: 10 },
  { id: "group", label: "Grupo (10–25)", min: 10, max: 25 },
  { id: "zerg", label: "Zerg (25+)", min: 25, max: undefined },
] as const;

const sizeId = (f: Filters) => SIZES.find((s) => s.min === f.minSquad && s.max === f.maxSquad)?.id ?? "custom";

export function FilterBar({ value, onChange, fields }: { value: Filters; onChange: (f: Filters) => void; fields: Field[] }) {
  const { data: meta } = useMeta();
  const { data: guilds } = useGuilds();
  const [open, setOpen] = useState(false);
  const has = (f: Field) => fields.includes(f);
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const custom = !!(value.from || value.to);
  const active = Object.keys(value).length;
  const alliance = (guilds ?? []).filter((g) => g.inAlliance);
  const others = (guilds ?? []).filter((g) => !g.inAlliance && g.name);

  return (
    <div className="mb-5 rounded-2xl border border-line bg-surface/60 p-3">
      <div className="flex items-center justify-between gap-2 md:hidden">
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
          <SlidersHorizontal className="size-4" /> Filtros {active > 0 && <span className="text-gold">({active})</span>}
        </Button>
        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange({})}>
            <RotateCcw className="size-3.5" /> Limpar
          </Button>
        )}
      </div>
      <div className={cx("grid-cols-2 gap-3 md:grid md:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] md:items-end", open ? "mt-3 grid" : "hidden")}>
        {has("period") && (
          <Select
            label="Período"
            value={custom ? "custom" : String(value.days ?? "")}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") set({ days: undefined, from: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10) });
              else set({ days: v ? Number(v) : undefined, from: undefined, to: undefined });
            }}
          >
            <option value="">Todo o histórico</option>
            <option value="1">Últimas 24 h</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="custom">Escolher datas…</option>
          </Select>
        )}
        {has("period") && custom && (
          <>
            <Input label="De" type="date" value={value.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
            <Input label="Até" type="date" value={value.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
          </>
        )}
        {has("guild") && (
          <Select label="Guilda" value={value.guild ?? ""} onChange={(e) => set({ guild: e.target.value || undefined })}>
            <option value="">Todas</option>
            <option value="alliance">★ Só a aliança</option>
            {alliance.length > 0 && (
              <optgroup label="Aliança">
                {alliance.map((g) => (
                  <option key={g.id} value={g.id}>
                    [{g.tag}] {g.name}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Outras">
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
          <Select label="Função" value={value.role ?? ""} onChange={(e) => set({ role: (e.target.value || undefined) as Role | undefined })}>
            <option value="">Todas</option>
            <option value="dps">DPS</option>
            <option value="support">Suporte</option>
          </Select>
        )}
        {has("profession") && (
          <Select label="Classe" value={value.profession ?? ""} onChange={(e) => set({ profession: e.target.value || undefined })}>
            <option value="">Todas</option>
            {meta?.professions.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        )}
        {has("size") && (
          <Select
            label="Tamanho do squad"
            value={sizeId(value)}
            onChange={(e) => {
              const s = SIZES.find((x) => x.id === e.target.value);
              if (s) set({ minSquad: s.min, maxSquad: s.max });
            }}
          >
            {SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            {sizeId(value) === "custom" && <option value="custom">Personalizado</option>}
          </Select>
        )}
        {has("duration") && (
          <Select label="Duração mínima" value={String(value.minDurationSec ?? "")} onChange={(e) => set({ minDurationSec: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Qualquer</option>
            <option value="30">30 s</option>
            <option value="60">1 min</option>
            <option value="120">2 min</option>
            <option value="300">5 min</option>
          </Select>
        )}
        {has("map") && (
          <Select label="Mapa" value={String(value.map ?? "")} onChange={(e) => set({ map: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Todos</option>
            {meta?.maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? `Mapa ${m.id}`}
              </option>
            ))}
          </Select>
        )}
        {active > 0 && (
          <Button variant="ghost" size="sm" className="hidden h-9 md:inline-flex" onClick={() => onChange({})}>
            <RotateCcw className="size-3.5" /> Limpar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
