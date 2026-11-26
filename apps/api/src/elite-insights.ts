// Roda o Elite Insights CLI (parser oficial da comunidade, em .NET) sobre um .zevtc/.evtc.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const EI_DLL = "GuildWars2EliteInsights-CLI.dll";

export const eiAvailable = (eiDir: string) => existsSync(path.join(eiDir, EI_DLL));

export interface EiOutput {
  json: string;
  html: string | null;
}

/** Erro de uma luta guardado em fights.error como "código" ou "código|detalhe"; o site traduz pelo código. */
export const fightError = (code: string, detail?: string) => new Error(detail ? `${code}|${detail}` : code);

/**
 * Configuração do Elite Insights. Fica enxuta de propósito: replay de combate, linhas do tempo por segundo e modificadores
 * de dano não são usados e quase dobram a memória (um log de 14 MB cai de ~1,4 GB para ~0,5 GB). O DetailledWvW precisa ficar:
 * sem ele o EI não traz o dano, os kills nem os inimigos em WvW.
 */
export const eiConfLines = (outDir: string, o: { html: boolean }): string[] => [
  "SaveAtOut=false", `OutLocation=${outDir}`,
  `SaveOutHTML=${o.html}`, "SaveOutJSON=true", "SaveOutCSV=false", "IndentJSON=false", "CompressRaw=false",
  "ParsePhases=true", "ParseCombatReplay=false", "DetailledWvW=true", "ComputeDamageModifiers=false",
  "RawTimelineArrays=false", "HtmlExternalScripts=false", "SkipFailedTries=false",
  "UploadToDPSReports=false", "UploadToWingman=false", "SaveOutTrace=false",
  "SingleThreaded=true", "AddPoVProf=false", "AddDuration=false",
];

/** Ambiente do processo: o .NET devolve memória ao sistema com mais vontade (menos pico, sem ficar mais lento). */
export const eiEnv = (base: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ DOTNET_GCConserveMemory: "9", ...base });

/**
 * Por que o EI não gerou o JSON. Ele imprime "Processed - {json}" com o motivo da falha; sem essa linha e com saída 2, foi o vigia de
 * memória dele (passou de 90% da memória do contêiner, tentou coletar lixo e saiu em silêncio). Se o vigia estiver desligado, o .NET
 * lança OutOfMemoryException e o motivo vem na linha. Nos dois casos é falta de memória, não log curto nem corrompido.
 */
export function eiFailure(stdout: string, code: number | null): Error {
  const line = stdout.split("\n").find((l) => l.startsWith("Processed - "));
  try {
    const r = line ? JSON.parse(line.slice("Processed - ".length)) : null;
    if (r && r.parsed === false && typeof r.status === "string") {
      return r.status.includes("OutOfMemoryException") ? fightError("eiMemory") : fightError("eiUnreadableWhy", r.status);
    }
  } catch {
    /* sem motivo legível */
  }
  return code === 2 && !line ? fightError("eiMemory") : fightError("eiUnreadable");
}

export async function runEliteInsights(opts: { eiDir: string; dotnet: string; logFile: string; outDir: string; html?: boolean; timeoutMs?: number }): Promise<EiOutput> {
  const { eiDir, dotnet, logFile, outDir } = opts;
  if (!eiAvailable(eiDir)) {
    throw fightError("eiMissing", eiDir);
  }
  await fs.mkdir(outDir, { recursive: true });
  const conf = path.join(outDir, "ei.conf");
  await fs.writeFile(conf, eiConfLines(outDir, { html: opts.html ?? false }).join("\n"));

  const { stdout, code } = await new Promise<{ stdout: string; code: number | null }>((resolve, reject) => {
    const p = spawn(dotnet, [path.join(eiDir, EI_DLL), "-c", conf, logFile], { cwd: eiDir, env: eiEnv(process.env) });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(fightError("eiTimeout"));
    }, opts.timeoutMs ?? 5 * 60_000);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(fightError("eiStart", `${dotnet}: ${e.message}`));
    });
    p.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout: out + err, code: exitCode });
    });
  });

  const files = await fs.readdir(outDir);
  const json = files.find((f) => f.endsWith(".json"));
  const html = files.find((f) => f.endsWith(".html"));
  if (!json) {
    throw eiFailure(stdout, code);
  }
  return { json: path.join(outDir, json), html: html ? path.join(outDir, html) : null };
}
