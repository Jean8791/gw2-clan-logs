import { CheckCircle2, CircleDashed, FileUp, Info, KeyRound, ListChecks, Loader2, PauseCircle, XCircle } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { MAX_JSON_MB, MAX_UPLOAD_MB, MAX_ZIP_LOGS, MAX_ZIP_MB, retentionCutoff, ROUTES, readLogsFromZip, ZipError, type ItemState, type QueueItem } from "@gw2logs/shared";
import { RetentionNotice } from "../components/RetentionNotice";
import { Button, Card, ErrorBox, PageHeader, Rich, cx } from "../components/ui";
import { createToken, useConfig, useFights } from "../lib/api";
import { codeText, fightErrorText } from "../lib/errors";
import { date } from "../lib/format";
import { t } from "../lib/i18n";
import { uploadQueue, useUploadQueue } from "../lib/upload-queue";

const ACCEPT = [".zevtc", ".evtc", ".zip", ".json"];

type Item = QueueItem<File>;

const MB = 1024 * 1024;
const isJson = (name: string) => name.toLowerCase().endsWith(".json");
/** Acima do tamanho máximo: o .json tem limite próprio (e mensagem própria), bem menor que o do log original. */
const tooBigItem = (file: File): Item => ({ file, state: { kind: "error", code: isJson(file.name) ? "jsonTooBig" : "tooBig" } });

/** Itens de um arquivo escolhido. Um .zip vira um item por log de dentro, ou um item de erro se não der para abri-lo. */
async function itemsOf(file: File): Promise<Item[]> {
  if (!file.name.toLowerCase().endsWith(".zip")) return [file.size > (isJson(file.name) ? MAX_JSON_MB : MAX_UPLOAD_MB) * MB ? tooBigItem(file) : { file, state: { kind: "pending" } }];
  if (file.size > MAX_ZIP_MB * MB) return [{ file, state: { kind: "error", code: "zipTooBig" } }];
  try {
    const { logs, tooBig } = readLogsFromZip(new Uint8Array(await file.arrayBuffer()));
    const items: Item[] = [
      ...logs.map((l): Item => ({ file: new File([l.data], l.name), state: { kind: "pending" } })),
      ...tooBig.map((name) => tooBigItem(new File([], name))),
    ];
    return items.length ? items : [{ file, state: { kind: "error", code: "zipEmpty" } }];
  } catch (e) {
    return [{ file, state: { kind: "error", code: e instanceof ZipError ? e.code : "zipInvalid" } }];
  }
}

export function UploadPage() {
  const { data: cfg } = useConfig();
  // a lista e o envio moram na fila global: sair desta página não os interrompe, e ao voltar a lista está aqui
  const { items, running, pct } = useUploadQueue();
  const [drag, setDrag] = useState(false);
  const [opening, setOpening] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // acompanha o processamento das lutas já enviadas (atualiza sozinho enquanto houver fila)
  const fights = useFights({}, 100);
  const fightOf = (id?: string) => fights.data?.find((f) => f.id === id);
  // Lutas que já nasceram fora do prazo de guarda (a data que vale é a da luta, não a do envio): a limpeza as apaga na próxima rodada.
  // Pedidas ao servidor pelo mesmo corte da limpeza, porque as antigas nem aparecem entre as 100 mais novas da lista acima.
  const retentionDays = cfg?.retentionDays ?? 0;
  const cutoff = useMemo(() => retentionCutoff(new Date(), retentionDays), [retentionDays]);
  const pastRetention = useFights({ to: cutoff }, 500, retentionDays > 0);
  const expiredIds = useMemo(() => new Set((pastRetention.data ?? []).filter((f) => f.status === "done").map((f) => f.id)), [pastRetention.data]);
  const isExpired = (it: Item) => it.state.kind === "done" && !!it.state.result.id && expiredIds.has(it.state.result.id);
  const expiredCount = retentionDays > 0 ? items.filter(isExpired).length : 0;

  /** Escolher ou soltar os arquivos já valida e começa a importar (a fila ignora o que já está na lista). */
  const add = async (list: FileList | null) => {
    if (!list || running || opening) return;
    // copia já: o seletor esvazia a lista assim que o evento termina
    const chosen = [...list].filter((f) => ACCEPT.some((e) => f.name.toLowerCase().endsWith(e)));
    setOpening(true);
    try {
      const fresh: Item[] = [];
      for (const file of chosen) fresh.push(...(await itemsOf(file)));
      void uploadQueue.add(fresh);
    } finally {
      setOpening(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    add(e.dataTransfer.files);
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
    const expired = expiredCount > 0 && isExpired(it) && (
      <span className="text-bad" title={t("upload.expiredTip", { n: retentionDays })}>
        {t("upload.expired")}
      </span>
    );
    if (s.result.duplicate) return expired ? <span className="inline-flex items-center gap-2">{t("upload.duplicate")}{expired}</span> : t("upload.duplicate");
    if ((f?.status ?? s.result.status) === "done") {
      const link = (
        <Link className="text-gold hover:underline" to={ROUTES.fight(s.result.id ?? "")}>
          {t("upload.viewFight")}
        </Link>
      );
      return expired ? <span className="inline-flex items-center gap-2">{link}{expired}</span> : link;
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
          <RetentionNotice />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => !running && !opening && input.current?.click()}
            className={cx(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition",
              drag ? "border-gold bg-gold/10" : "border-line bg-surface/50 hover:border-faint",
            )}
          >
            <FileUp className={cx("size-10", drag ? "text-gold" : "text-faint")} />
            <div className="font-medium">{opening ? t("upload.opening") : t("upload.drop")}</div>
            <div className="text-sm text-muted">{t("upload.dropHint", { file: MAX_UPLOAD_MB, zip: MAX_ZIP_MB, logs: MAX_ZIP_LOGS })}</div>
            <input ref={input} type="file" multiple accept={ACCEPT.join(",")} className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {running ? (
              <>
                <Loader2 className="size-4 animate-spin text-info" />
                <Button onClick={() => uploadQueue.stop()}>{t("upload.stop")}</Button>
              </>
            ) : (
              waiting > 0 && (
                <Button variant="primary" onClick={() => void uploadQueue.sendAll()}>
                  <FileUp className="size-4" />
                  {t("upload.send")}
                </Button>
              )
            )}
            {!running && items.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => uploadQueue.clear()}>
                {t("common.clear")}
              </Button>
            )}
            {waiting > 0 && <span className="text-sm text-muted">{t("upload.filesToSend", { n: waiting })}</span>}
          </div>
          <p className="text-xs text-faint">{t("upload.safety")}</p>

          {expiredCount > 0 && (
            <div role="status" className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
              {t("upload.expiredSummary", { count: expiredCount, n: retentionDays })}
            </div>
          )}

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

        <div className="flex flex-col gap-4">
        <Card title={<span className="inline-flex items-center gap-2"><ListChecks className="size-4 text-gold" /> {t("upload.limits.title")}</span>}>
          <div className="space-y-3 px-5 py-4 text-sm text-muted">
            <p>
              <Rich text={t("upload.limits.types")} />
            </p>
            <p>
              <Rich text={t("upload.limits.size", { file: MAX_UPLOAD_MB, json: MAX_JSON_MB, zip: MAX_ZIP_MB, logs: MAX_ZIP_LOGS })} />
            </p>
            {cfg && (
              <p>
                <Rich text={t("upload.limits.user", { queue: cfg.limits.queuePerUser, hour: cfg.limits.perHourPerUser })} />
              </p>
            )}
            <p>
              <Rich text={t("upload.limits.duplicate")} />
            </p>
          </div>
        </Card>
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
      </div>
    </>
  );
}


/** Gera o token do script de envio e mostra, uma vez só, as duas linhas de configuração. */
export function ScriptCard() {
  const [created, setCreated] = useState<{ token: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const config = created ? `GW2LOGS_URL=${window.location.origin}\nGW2LOGS_KEY=${created.token}` : "";

  const generate = () => {
    setError(null);
    createToken().then(setCreated, setError);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(config).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card title={<span className="inline-flex items-center gap-2"><KeyRound className="size-4 text-gold" /> {t("upload.script.title")}</span>}>
      <div className="space-y-3 px-5 py-4 text-sm text-muted">
        <p>{t("upload.script.help")}</p>
        {created && (
          <>
            <pre className="overflow-x-auto rounded-lg bg-surface-3 p-3 text-xs text-text">{config}</pre>
            <p className="text-gold">{t("upload.script.once")}</p>
            <p>{t("upload.script.expires", { date: date(created.expiresAt) })}</p>
            <Button size="sm" onClick={copy}>
              {copied ? t("upload.script.copied") : t("upload.script.copy")}
            </Button>
          </>
        )}
        {error != null && <ErrorBox error={error} />}
        <div>
          <Button size="sm" variant={created ? "outline" : "primary"} onClick={generate}>
            {created ? t("upload.script.regenerate") : t("upload.script.generate")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
