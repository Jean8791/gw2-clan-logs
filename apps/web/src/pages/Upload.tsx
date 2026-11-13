import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileUp, Info, Loader2, XCircle } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import type { UploadResult } from "@gw2logs/shared";
import { Button, Card, ErrorBox, Input, PageHeader, cx } from "../components/ui";
import { uploadLogs, useConfig, useFights } from "../lib/api";
import { useMe, useSessionValue } from "../lib/hooks";
import { accountShort } from "../lib/format";
import { t } from "../lib/i18n";

const ACCEPT = [".zevtc", ".evtc", ".zip", ".json"];

export function UploadPage() {
  const { data: cfg } = useConfig();
  const me = useMe();
  const [key, setKey] = useSessionValue("gw2logs.uploadKey");
  const [uploader, setUploader] = useState(me ? accountShort(me) : "");
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  // acompanha o processamento das lutas recém-enviadas
  const fights = useFights({}, 50);
  const statusOf = (id?: string) => fights.data?.find((f) => f.id === id);

  const add = (list: FileList | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => ACCEPT.some((e) => f.name.toLowerCase().endsWith(e)));
    setFiles((cur) => [...cur, ...ok.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    add(e.dataTransfer.files);
  };

  const send = async () => {
    setError(null);
    setProgress(0);
    try {
      const r = await uploadLogs(files, uploader.trim(), key, setProgress);
      setResults((cur) => [...r, ...cur]);
      setFiles([]);
      await qc.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <PageHeader title={t("page.upload.title")} subtitle={t("page.upload.subtitle")} />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => input.current?.click()}
            className={cx(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition",
              drag ? "border-gold bg-gold/10" : "border-line bg-surface/50 hover:border-faint",
            )}
          >
            <FileUp className={cx("size-10", drag ? "text-gold" : "text-faint")} />
            <div className="font-medium">Arraste os logs aqui ou clique para escolher</div>
            <div className="text-sm text-muted">.zevtc ou .evtc do ArcDPS · .json do Elite Insights / dps.report</div>
            <input ref={input} type="file" multiple accept={ACCEPT.join(",")} className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
          </div>

          {files.length > 0 && (
            <Card title={`${files.length} arquivo(s) para enviar`} action={<Button variant="ghost" size="sm" onClick={() => setFiles([])}>Limpar</Button>}>
              <ul className="max-h-64 divide-y divide-line/60 overflow-y-auto">
                {files.map((f) => (
                  <li key={f.name + f.size} className="flex justify-between px-5 py-2 text-sm">
                    <span className="truncate">{f.name}</span>
                    <span className="tabular shrink-0 text-faint">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <Input className="w-56" label="Seu nome (opcional)" maxLength={60} value={uploader} onChange={(e) => setUploader(e.target.value)} placeholder="ex.: Nome.1234" />
            {cfg?.uploadKeyRequired && <Input className="w-56" label="Senha do clã" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="pergunte no Discord" />}
            <Button variant="primary" disabled={!files.length || progress !== null} onClick={send}>
              {progress !== null ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              {progress !== null ? `Enviando… ${progress}%` : "Enviar"}
            </Button>
          </div>
          {error != null && <ErrorBox error={error} />}

          {results.length > 0 && (
            <Card title="Enviados">
              <ul className="divide-y divide-line/60">
                {results.map((r, i) => {
                  const f = statusOf(r.id);
                  const st = f?.status ?? r.status;
                  return (
                    <li key={(r.id ?? r.file) + i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      {r.error || st === "error" ? (
                        <XCircle className="size-4 shrink-0 text-bad" />
                      ) : st === "done" ? (
                        <CheckCircle2 className="size-4 shrink-0 text-good" />
                      ) : (
                        <Loader2 className="size-4 shrink-0 animate-spin text-info" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{r.file}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {r.error ??
                          (f?.error ? f.error : r.duplicate ? "Já enviado antes" : st === "done" ? <Link className="text-gold hover:underline" to={`/lutas/${r.id}`}>Ver luta</Link> : st === "parsing" ? "Processando…" : "Na fila")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>

        <Card title={<span className="inline-flex items-center gap-2"><Info className="size-4 text-gold" /> Onde ficam os logs</span>}>
          <div className="space-y-3 px-5 py-4 text-sm text-muted">
            <p>
              No Windows: <code className="rounded bg-surface-3 px-1 py-0.5 text-xs text-text">Documentos\Guild Wars 2\addons\arcdps\arcdps.cbtlogs\</code>
            </p>
            <p>
              Para gravar <b className="text-text">WvW</b>: no jogo, <b className="text-text">Alt+Shift+T</b> → <i>Logging</i> → ative a gravação de WvW. Por padrão o ArcDPS só grava bosses de PvE.
            </p>
            <p>Para aparecer cura e barreira, quem grava precisa do addon <b className="text-text">Healing Stats</b>.</p>
            {cfg && !cfg.eliteInsights && (
              <p className="rounded-lg border border-gold/30 bg-gold/10 p-3 text-gold">
                Este servidor está sem o Elite Insights: por enquanto só aceita o <b>.json</b> gerado pelo EI ou baixado do dps.report.
              </p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
