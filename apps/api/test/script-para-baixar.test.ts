import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../src/config.js";

/** A tela Importar logs deixa baixar o script de envio: o build do site leva os dois scripts do repositório para /scripts. */
const web = path.join(repoRoot, "apps", "web");
const modalSource = () => fs.readFileSync(path.join(web, "src", "components", "ScriptHelp.tsx"), "utf8");

describe("script de envio para baixar", () => {
  it("o build do site copia só os dois scripts de envio, sem os de backup", () => {
    const build = JSON.parse(fs.readFileSync(path.join(web, "package.json"), "utf8")).scripts.build as string;

    expect(build).toContain("dist/scripts");
    expect(build).toContain("enviar-logs.sh");
    expect(build).toContain("enviar-logs.bat");
    expect(build).not.toMatch(/backup/);
  });

  it("os links do modal apontam para arquivos que existem no repositório", () => {
    for (const nome of ["enviar-logs.sh", "enviar-logs.bat"]) {
      expect(modalSource()).toContain(`"${nome}"`);
      expect(fs.existsSync(path.join(repoRoot, "scripts", nome)), nome).toBe(true);
    }
  });

  it("o cartão do script aparece para o dono autenticado sem exigir administrador", () => {
    const upload = fs.readFileSync(path.join(web, "src", "pages", "Upload.tsx"), "utf8");
    const routes = fs.readFileSync(path.join(web, "src", "main.tsx"), "utf8");

    expect(upload).toMatch(/<ScriptCard \/>\s*\n\s*<Card/);
    expect(upload).not.toContain("isAdmin");
    expect(routes).toContain("<OwnerOnly><UploadPage /></OwnerOnly>");
  });

  it("o monitor automático só leva para a fila os logs dos últimos 3 dias, configurável por GW2LOGS_DIAS", () => {
    const monitor = fs.readFileSync(path.join(repoRoot, "scripts", "monitorar-logs.ps1"), "utf8");

    expect(monitor).toContain("Get-Setting $doArquivo 'GW2LOGS_DIAS' '3'");
    expect(monitor).toContain("if ($f.LastWriteTime -lt $maisAntigo) { continue }");
    expect(monitor).toContain("-not [int]::TryParse($diasTexto, [ref]$dias)");
    expect(monitor).toMatch(/^[\x00-\x7f]*$/); // o PowerShell 5.1 lê o arquivo como ANSI: só ASCII
    expect(monitor).toContain("\r\n");
  });

  it("o monitor não deixa parado o log gravado com o relógio do PC adiantado (data no futuro)", () => {
    const monitor = fs.readFileSync(path.join(repoRoot, "scripts", "monitorar-logs.ps1"), "utf8");

    expect(monitor).toContain("if ($f.LastWriteTime -gt $limite -and $f.LastWriteTime -le $agora) { continue }");
    expect(monitor).toContain("if (-not (Test-Livre $f.FullName)) { continue }");
  });

  it("o monitor só move para integrado o que o servidor confirma como pronto, e leva para erro o que falhou ao processar", () => {
    const monitor = fs.readFileSync(path.join(repoRoot, "scripts", "monitorar-logs.ps1"), "utf8");

    expect(monitor).toContain("/api/upload/status?ids=");
    expect(monitor).toContain("$pendentes[$rel] = $idLuta");
    expect(monitor).toContain("if ($statusLuta -eq 'done')");
    expect(monitor).toContain("elseif ($statusLuta -eq 'error')");
    expect(monitor).toContain("Move-Relative $f $integrando $integrado");
    expect(monitor.match(/\$integrado \| Out-Null/g)).toHaveLength(2); // só a confirmação (done) e o duplicado já pronto movem para integrado
    expect(monitor).toContain("$s.Http -eq '401'"); // token revogado com só pendentes: pausa, em vez de martelar o servidor
  });

  it("a configuração do Windows usa `set` e a do Linux usa CHAVE=valor, como cada script lê", () => {
    expect(modalSource()).toContain('os === "windows" ? "set " : ""');
    expect(fs.readFileSync(path.join(repoRoot, "scripts", "enviar-logs.bat"), "utf8")).toContain("set GW2LOGS_KEY=");
  });
});
