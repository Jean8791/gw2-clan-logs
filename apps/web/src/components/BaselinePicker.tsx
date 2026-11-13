import type { Role } from "@gw2logs/shared";
import { Segmented } from "./ui";

export type BaselineRole = Role | "all";

/** Com quem comparar: média de todos, só dos DPS ou só dos suportes. */
export function BaselinePicker({ value, onChange }: { value: BaselineRole; onChange: (v: BaselineRole) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-faint">Média de</span>
      <Segmented
        size="sm"
        value={value}
        onChange={onChange}
        options={[
          { value: "dps", label: "DPS" },
          { value: "support", label: "Suportes" },
          { value: "all", label: "Todos" },
        ]}
      />
    </div>
  );
}
