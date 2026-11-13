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

export async function runEliteInsights(opts: { eiDir: string; dotnet: string; logFile: string; outDir: string; timeoutMs?: number }): Promise<EiOutput> {
  const { eiDir, dotnet, logFile, outDir } = opts;
  if (!eiAvailable(eiDir)) {
    throw new Error(`Elite Insights não encontrado em ${eiDir}. Rode scripts/baixar-elite-insights.sh ou envie o .json gerado pelo EI.`);
  }
  await fs.mkdir(outDir, { recursive: true });
  const conf = path.join(outDir, "ei.conf");
  await fs.writeFile(
    conf,
    [
      "SaveAtOut=false", `OutLocation=${outDir}`,
      "SaveOutHTML=true", "SaveOutJSON=true", "SaveOutCSV=false", "IndentJSON=false", "CompressRaw=false",
      "ParsePhases=true", "ParseCombatReplay=true", "DetailledWvW=true", "ComputeDamageModifiers=true",
      "RawTimelineArrays=true", "HtmlExternalScripts=false", "SkipFailedTries=false",
      "UploadToDPSReports=false", "UploadToWingman=false", "SaveOutTrace=false",
      "SingleThreaded=false", "AddPoVProf=false", "AddDuration=false",
    ].join("\n"),
  );

  const stdout = await new Promise<string>((resolve, reject) => {
    const p = spawn(dotnet, [path.join(eiDir, EI_DLL), "-c", conf, logFile], { cwd: eiDir });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("O Elite Insights demorou mais de 5 minutos."));
    }, opts.timeoutMs ?? 5 * 60_000);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Não foi possível iniciar o Elite Insights (${dotnet}): ${e.message}`));
    });
    p.on("close", () => {
      clearTimeout(timer);
      resolve(out + err);
    });
  });

  const files = await fs.readdir(outDir);
  const json = files.find((f) => f.endsWith(".json"));
  const html = files.find((f) => f.endsWith(".html"));
  if (!json) {
    // O EI imprime "Processed - {json}" com o motivo da falha.
    const line = stdout.split("\n").find((l) => l.startsWith("Processed - "));
    let reason: string | null = null;
    try {
      const r = line ? JSON.parse(line.slice("Processed - ".length)) : null;
      if (r && r.parsed === false && typeof r.status === "string") reason = r.status;
    } catch {
      /* sem motivo legível */
    }
    throw new Error("O Elite Insights não conseguiu ler este log" + (reason ? `: ${reason}` : " (muito curto, corrompido ou versão não suportada)."));
  }
  return { json: path.join(outDir, json), html: html ? path.join(outDir, html) : null };
}
