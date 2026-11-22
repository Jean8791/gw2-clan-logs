import { Download, KeyRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createToken } from "../lib/api";
import { date } from "../lib/format";
import { t } from "../lib/i18n";
import { Button, Card, ErrorBox, Rich, Segmented } from "./ui";

type Os = "windows" | "linux";
type Created = { token: string; expiresAt: string };

const SCRIPTS: Record<Os, string> = { windows: "enviar-logs.bat", linux: "enviar-logs.sh" };
const LOGS_FOLDER: Record<Os, string> = {
  windows: '"%USERPROFILE%\\Documents\\Guild Wars 2\\addons\\arcdps\\arcdps.cbtlogs"',
  linux: "~/Documentos/Guild\\ Wars\\ 2/addons/arcdps/arcdps.cbtlogs",
};

/** Conteúdo do arquivo de configuração: o `.bat` do Windows executa `set`, o `.sh` lê CHAVE=valor. */
const configOf = (os: Os, token: string) => {
  const set = os === "windows" ? "set " : "";
  return `${set}GW2LOGS_URL=${window.location.origin}\n${set}GW2LOGS_KEY=${token}`;
};
const configPath = (os: Os) => (os === "windows" ? "%APPDATA%\\gw2logs\\config.bat" : "~/.config/gw2logs/env");
const runOf = (os: Os) => `${os === "windows" ? "" : "./"}${SCRIPTS[os]} ${LOGS_FOLDER[os]}`;

const Code = ({ children }: { children: string }) => <pre className="overflow-x-auto rounded-lg bg-surface-3 p-3 text-xs text-text">{children}</pre>;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-gold/15 text-xs font-semibold text-gold">{n}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {children}
      </div>
    </li>
  );
}

function ScriptModal({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [os, setOs] = useState<Os>(navigator.userAgent.includes("Windows") ? "windows" : "linux");
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => dialog.current?.showModal(), []);

  const generate = () => {
    setError(null);
    createToken().then(setCreated, setError);
  };
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
      className="m-auto w-[min(42rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-text backdrop:bg-black/60"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide">
          <KeyRound className="size-4 text-gold" /> {t("upload.script.modalTitle")}
        </h2>
        <Button variant="ghost" size="sm" aria-label={t("common.close")} onClick={() => dialog.current?.close()}>
          <X className="size-4" />
        </Button>
      </header>
      <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4 text-sm text-muted">
        <p>{t("upload.script.help")}</p>
        <Segmented
          value={os}
          onChange={setOs}
          options={[
            { value: "windows", label: "Windows" },
            { value: "linux", label: "Linux / macOS" },
          ]}
        />
        <ol className="space-y-5">
          <Step n={1} title={t("upload.script.step1")}>
            <p>{t("upload.script.step1Help")}</p>
            <a
              href={`/scripts/${SCRIPTS[os]}`}
              download
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-xs font-medium text-text transition hover:border-faint hover:bg-surface-3"
            >
              <Download className="size-4" /> {t("upload.script.download", { name: SCRIPTS[os] })}
            </a>
          </Step>
          <Step n={2} title={t("upload.script.step2")}>
            <p>{t("upload.script.step2Help")}</p>
            {created && (
              <>
                <p className="text-gold">{t("upload.script.once")}</p>
                <p>{t("upload.script.expires", { date: date(created.expiresAt) })}</p>
              </>
            )}
            {error != null && <ErrorBox error={error} />}
            <Button size="sm" variant={created ? "outline" : "primary"} onClick={generate}>
              {created ? t("upload.script.regenerate") : t("upload.script.generate")}
            </Button>
          </Step>
          <Step n={3} title={t("upload.script.step3")}>
            <p>
              <Rich text={t("upload.script.step3Help", { path: configPath(os) })} />
            </p>
            {created ? (
              <>
                <Code>{configOf(os, created.token)}</Code>
                <Button size="sm" onClick={() => copy(configOf(os, created.token))}>
                  {copied ? t("upload.script.copied") : t("upload.script.copy")}
                </Button>
              </>
            ) : (
              <p className="text-faint">{t("upload.script.needToken")}</p>
            )}
          </Step>
          <Step n={4} title={t("upload.script.step4")}>
            <p>{t("upload.script.step4Help")}</p>
            <Code>{runOf(os)}</Code>
            <p className="text-xs text-faint">{t("upload.script.step4Note")}</p>
          </Step>
        </ol>
      </div>
    </dialog>
  );
}

/** Cartão da tela Importar: o passo a passo do envio por script fica num modal, para não ocupar a tela. */
export function ScriptCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card title={<span className="inline-flex items-center gap-2"><KeyRound className="size-4 text-gold" /> {t("upload.script.title")}</span>}>
        <div className="space-y-3 px-5 py-4 text-sm text-muted">
          <p>{t("upload.script.summary")}</p>
          <Button size="sm" onClick={() => setOpen(true)}>
            {t("upload.script.open")}
          </Button>
        </div>
      </Card>
      {open && <ScriptModal onClose={() => setOpen(false)} />}
    </>
  );
}
