import { useId, useState } from "react";
import { useMeta } from "../lib/api";
import { Button, Input } from "./ui";

/** Campo com sugestões das contas que já apareceram nos logs. */
export function PlayerPicker({ onPick, label = "Conta do GW2", button = "Escolher", exclude = [] }: { onPick: (account: string) => void; label?: string; button?: string; exclude?: string[] }) {
  const { data } = useMeta();
  const [value, setValue] = useState("");
  const listId = useId();
  const players = (data?.players ?? []).filter((p) => !exclude.includes(p.account));
  const match = players.find((p) => p.account.toLowerCase() === value.trim().toLowerCase() || (p.name ?? "").toLowerCase() === value.trim().toLowerCase());

  const submit = () => {
    if (match) {
      onPick(match.account);
      setValue("");
    }
  };

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input className="flex-1" label={label} list={listId} placeholder="Nome.1234 ou nome do personagem" value={value} onChange={(e) => setValue(e.target.value)} />
      <datalist id={listId}>
        {players.map((p) => (
          <option key={p.account} value={p.account}>
            {p.name ?? ""} {p.profession ? `· ${p.profession}` : ""}
          </option>
        ))}
      </datalist>
      <Button type="submit" variant="primary" disabled={!match}>
        {button}
      </Button>
    </form>
  );
}
