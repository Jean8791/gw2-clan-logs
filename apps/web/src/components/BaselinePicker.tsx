import type { Role } from "@gw2logs/shared";
import { t } from "../lib/i18n";
import { Segmented } from "./ui";

export type BaselineRole = Role | "all";

/** Com quem comparar: média de todos, só dos DPS ou só dos suportes. */
export function BaselinePicker({ value, onChange }: { value: BaselineRole; onChange: (v: BaselineRole) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-faint">{t("baseline.label")}</span>
      <Segmented
        size="sm"
        value={value}
        onChange={onChange}
        options={[
          { value: "dps", label: t("baseline.dps") },
          { value: "support", label: t("baseline.support") },
          { value: "all", label: t("baseline.all") },
        ]}
      />
    </div>
  );
}
