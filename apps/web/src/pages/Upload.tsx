import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, FileUp, Info, Loader2, PauseCircle, XCircle } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { MAX_UPLOAD_MB, ROUTES, sendInOrder, type ItemState } from "@gw2logs/shared";
import { Button, Card, PageHeader, Rich, cx } from "../components/ui";
import { uploadLog, useConfig, useFights } from "../lib/api";
import { codeText, fightErrorText } from "../lib/errors";
import { t } from "../lib/i18n";

const ACCEPT = [".zevtc", ".evtc", ".zip", ".json"];

interface Item {
  file: File;
  state: ItemState;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function UploadPage() {
  const { data: cfg } = useConfig();
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const stop = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  // acompanha o processamento das lutas já enviadas (atualiza sozinho enquanto houver fila)
  const fights = useFights({}, 100);
  const fightOf = (id?: string) => fights.data?.find((f) => f.id === id);

  const add = (list: FileList | null) => {
    if (!list || running) return;
    const ok = [...list].filter((f) => ACCEPT.some((e) => f.name.toLowerCase().endsWith(e)));
    setItems((cur) => [
      ...cur,
      ...ok
        .filter((f) => !cur.some((c) => c.file.name === f.name && c.file.size === f.size))
        .map((file): Item => ({ file, state: file.size > MAX_UPLOAD_MB * 1024 * 1024 ? { kind: "error", code: "tooBig" } : { kind: "pending" } })),
    ]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    add(e.dataTransfer.files);
  };

  const start = async () => {
    const todo = items.map((it, index) => ({ it, index })).filter(({ it }) => it.state.kind === "pending" || it.state.kind === "skipped");
    if (!todo.length) return;
    stop.current = false;
    setRunning(true);
    try {
      await sendInOrder(todo, {
        send: ({ it }) => uploadLog(it.file, setPct),
        wait: sleep,
        shouldStop: () => stop.current,
        onState: (i, state) => {
          setPct(0);
          setItems((cur) => cur.map((it, k) => (k === todo[i]!.index ? { ...it, state } : it)));
        },
      });
    } finally {
      setRunning(false);
      await qc.invalidateQueries({ queryKey: ["fights"] });
    }
  };

  const waiting = items.filter((i) => i.state.kind === "pending" || i.state.kind === "skipped").length;

  const statusText = (it: Item) => {
    const s = it.state;
    if (s.kind === "pending") return t("upload.pending");
    if (s.kind === "sending") return t("upload.sending", { pct });
    if (s.kind === "waiting") return t("upload.waiting", { n: s.waits });
    if (s.kind === "error") return codeText(s.code, s.message);
    if (s.kind === "skipped") return t("upload.notSent", { reason: s.code === "stopped" ? t("upload.stopped") : codeText(s.code) });
    const f = fightOf(s.result.id);
    if (f?.error) return fightErrorText(f.error);
    if (s.result.duplicate) return t("upload.duplicate");
    if ((f?.status ?? s.result.status) === "done") {
      return (
        <Link className="text-gold hover:underline" to={ROUTES.fight(s.result.id ?? "")}>
          {t("upload.viewFight")}
        </Link>
      );
    }
    return (f?.status ?? s.result.status) === "parsing" ? t("upload.parsing") : t("upload.queued");
  };

  const icon = (s: ItemState) =>
    s.kind === "error" ? (
      <XCircle className="size-4 shrink-0 text-bad" />
    ) : s.kind === "skipped" ? (
      <PauseCircle className="size-4 shrink-0 text-faint" />
    ) : s.kind === "pending" ? (
      <CircleDashed className="size-4 shrink-0 text-faint" />
    ) : s.kind === "done" ? (
      <CheckCircle2 className="size-4 shrink-0 text-good" />
    ) : (
      <Loader2 className="size-4 shrink-0 animate-spin text-info" />
    );

  return (
    <>
      <PageHeader title={t("page.import.title")} subtitle={t("page.import.subtitle")} />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => !running && input.current?.click()}
            className={cx(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition",
              drag ? "border-gold bg-gold/10" : "border-line bg-surface/50 hover:border-faint",
            )}
          >
            <FileUp className={cx("size-10", drag ? "text-gold" : "text-faint")} />
            <div className="font-medium">{t("upload.drop")}</div>
            <div className="text-sm text-muted">{t("upload.dropHint")}</div>
            <input ref={input} type="file" multiple accept={ACCEPT.join(",")} className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!waiting || running} onClick={start}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              {t("upload.send")}
            </Button>
            {running && <Button onClick={() => (stop.current = true)}>{t("upload.stop")}</Button>}
            {!running && items.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setItems([])}>
                {t("common.clear")}
              </Button>
            )}
            <span className="text-sm text-muted">{t("upload.filesToSend", { n: waiting })}</span>
          </div>
          <p className="text-xs text-faint">{t("upload.safety")}</p>

          {items.length > 0 && (
            <Card title={t("upload.done")}>
              <ul className="max-h-[28rem] divide-y divide-line/60 overflow-y-auto">
                {items.map((it) => (
                  <li key={it.file.name + it.file.size} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    {icon(it.state)}
                    <span className="min-w-0 flex-1 truncate">{it.file.name}</span>
                    <span className="tabular shrink-0 text-faint">{(it.file.size / 1024 / 1024).toFixed(1)} MB</span>
                    <span className="shrink-0 text-xs text-muted">{statusText(it)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card title={<span className="inline-flex items-center gap-2"><Info className="size-4 text-gold" /> {t("upload.help.title")}</span>}>
          <div className="space-y-3 px-5 py-4 text-sm text-muted">
            <p>
              {t("upload.help.windows")} <code className="rounded bg-surface-3 px-1 py-0.5 text-xs text-text">{t("upload.help.windowsPath")}</code>
            </p>
            <p>
              <Rich text={t("upload.help.record")} />
            </p>
            <p>
              <Rich text={t("upload.help.healing")} />
            </p>
            {cfg && !cfg.eliteInsights && (
              <p className="rounded-lg border border-gold/30 bg-gold/10 p-3 text-gold">
                <Rich text={t("upload.help.noEi")} />
              </p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

