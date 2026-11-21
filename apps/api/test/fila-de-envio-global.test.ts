import { describe, expect, it } from "vitest";
import { createUploadQueue, type ItemState, type UploadResult } from "@gw2logs/shared";

/** Arquivo de mentira: a fila só precisa de nome e tamanho. */
const arq = (name: string, size = 1) => ({ name, size });
const pendente = (f: { name: string; size: number }) => ({ file: f, state: { kind: "pending" } as ItemState });
const ok = (file: string): UploadResult => ({ file, id: "id-" + file, status: "queued" }) as UploadResult;

/** Um envio que só termina quando o teste manda (para ver o estado no meio do caminho). */
function comPorta() {
  const portas: (() => void)[] = [];
  const send = (f: { name: string }) => new Promise<UploadResult>((resolve) => portas.push(() => resolve(ok(f.name))));
  const soltar = async () => {
    portas.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { send, soltar };
}
const semEspera = () => Promise.resolve();
const estados = (q: ReturnType<typeof createUploadQueue>) => q.getSnapshot().items.map((i) => i.state.kind);

describe("fila de envio global: o envio não depende da página", () => {
  it("envia tudo, na ordem, sem ninguém assistindo", async () => {
    const enviados: string[] = [];
    const q = createUploadQueue({ send: async (f) => (enviados.push(f.name), ok(f.name)), wait: semEspera });

    await q.add([pendente(arq("a.zevtc")), pendente(arq("b.zevtc"))]);

    expect(enviados).toEqual(["a.zevtc", "b.zevtc"]);
    expect(estados(q)).toEqual(["done", "done"]);
    expect(q.getSnapshot().running).toBe(false);
  });

  it("quem sai da página e volta (uma assinatura nova) vê o envio em andamento e a lista de antes", async () => {
    const { send, soltar } = comPorta();
    const q = createUploadQueue({ send, wait: semEspera });
    const sair = q.subscribe(() => {}); // a página de importar monta...
    const terminou = q.add([pendente(arq("a.zevtc")), pendente(arq("b.zevtc"))]);
    sair(); // ...e desmonta no meio do envio

    const visto = q.getSnapshot(); // a página volta
    expect(visto.running).toBe(true);
    expect(visto.items.map((i) => i.file.name)).toEqual(["a.zevtc", "b.zevtc"]);
    expect(visto.items[0]!.state.kind).toBe("sending");

    await soltar();
    await soltar();
    await terminou;
    expect(estados(q)).toEqual(["done", "done"]);
  });

  it("quem assinou é avisado a cada mudança, e depois de cancelar a assinatura não é mais", async () => {
    const q = createUploadQueue({ send: async (f) => ok(f.name), wait: semEspera });
    let avisos = 0;
    const cancelar = q.subscribe(() => avisos++);

    await q.add([pendente(arq("a.zevtc"))]);
    const ate = avisos;
    cancelar();
    await q.add([pendente(arq("b.zevtc"))]);

    expect(ate).toBeGreaterThan(0);
    expect(avisos).toBe(ate);
  });

  it("avisa quando o envio começa e quando termina (o navegador usa para perguntar antes de recarregar)", async () => {
    const eventos: string[] = [];
    const q = createUploadQueue({
      send: async (f) => (eventos.push("envia " + f.name), ok(f.name)),
      wait: semEspera,
      onRunningChange: (r) => eventos.push(r ? "começou" : "terminou"),
      onSettled: () => void eventos.push("lista atualizada"),
    });

    await q.add([pendente(arq("a.zevtc")), pendente(arq("b.zevtc"))]);

    expect(eventos).toEqual(["começou", "envia a.zevtc", "envia b.zevtc", "terminou", "lista atualizada"]);
  });

  it("o progresso do arquivo aparece no estado e volta a zero quando ele muda", async () => {
    const q = createUploadQueue({
      send: async (f, progresso) => (progresso(40), progresso(90), ok(f.name)),
      wait: semEspera,
    });
    const vistos: number[] = [];
    q.subscribe(() => vistos.push(q.getSnapshot().pct));

    await q.add([pendente(arq("a.zevtc"))]);

    expect(vistos).toContain(40);
    expect(vistos).toContain(90);
    expect(q.getSnapshot().pct).toBe(0);
  });
});

describe("fila de envio global: regras da lista", () => {
  it("o mesmo arquivo (nome e tamanho) não entra duas vezes, nem no mesmo lote", async () => {
    const enviados: string[] = [];
    const q = createUploadQueue({ send: async (f) => (enviados.push(f.name), ok(f.name)), wait: semEspera });

    await q.add([pendente(arq("a.zevtc", 5)), pendente(arq("a.zevtc", 5)), pendente(arq("a.zevtc", 6))]);
    await q.add([pendente(arq("a.zevtc", 5))]);

    expect(q.getSnapshot().items.map((i) => `${i.file.name}:${i.file.size}`)).toEqual(["a.zevtc:5", "a.zevtc:6"]);
    expect(enviados).toHaveLength(2);
  });

  it("item que já nasceu com erro (arquivo grande demais) fica na lista sem ser enviado", async () => {
    const enviados: string[] = [];
    const q = createUploadQueue({ send: async (f) => (enviados.push(f.name), ok(f.name)), wait: semEspera });

    await q.add([{ file: arq("grande.zevtc"), state: { kind: "error", code: "tooBig" } }, pendente(arq("b.zevtc"))]);

    expect(enviados).toEqual(["b.zevtc"]);
    expect(q.getSnapshot().items[0]!.state).toEqual({ kind: "error", code: "tooBig" });
  });

  it("parar deixa o resto como não enviado, e enviar de novo retoma só o que faltou", async () => {
    const { send, soltar } = comPorta();
    const enviados: string[] = [];
    const q = createUploadQueue({ send: (f) => (enviados.push(f.name), send(f)), wait: semEspera });
    const terminou = q.add([pendente(arq("a.zevtc")), pendente(arq("b.zevtc")), pendente(arq("c.zevtc"))]);

    q.stop();
    await soltar(); // o a.zevtc, que já estava indo, termina
    await terminou;

    expect(estados(q)).toEqual(["done", "skipped", "skipped"]);
    const retomada = q.sendAll();
    await soltar();
    await soltar();
    await retomada;
    expect(estados(q)).toEqual(["done", "done", "done"]);
    expect(enviados).toEqual(["a.zevtc", "b.zevtc", "c.zevtc"]); // o a.zevtc não foi reenviado
  });

  it("limpar esvazia a lista, mas não no meio do envio", async () => {
    const { send, soltar } = comPorta();
    const q = createUploadQueue({ send, wait: semEspera });
    const terminou = q.add([pendente(arq("a.zevtc"))]);

    q.clear();
    expect(q.getSnapshot().items).toHaveLength(1);
    await soltar();
    await terminou;
    q.clear();

    expect(q.getSnapshot().items).toHaveLength(0);
  });

  it("arquivo adicionado durante um envio entra como pendente e vai no próximo envio, sem começar outro por cima", async () => {
    const { send, soltar } = comPorta();
    const enviados: string[] = [];
    const q = createUploadQueue({ send: (f) => (enviados.push(f.name), send(f)), wait: semEspera });
    const primeiro = q.add([pendente(arq("a.zevtc"))]);

    await q.add([pendente(arq("b.zevtc"))]);
    expect(q.getSnapshot().items[1]!.state.kind).toBe("pending");
    await soltar();
    await primeiro;
    const segundo = q.sendAll();
    await soltar();
    await segundo;

    expect(enviados).toEqual(["a.zevtc", "b.zevtc"]);
  });

  it("erro de rede para a fila inteira e o restante fica não enviado", async () => {
    const q = createUploadQueue({
      send: async () => {
        throw Object.assign(new Error("rede"), { status: 0 });
      },
      wait: semEspera,
    });

    await q.add([pendente(arq("a.zevtc")), pendente(arq("b.zevtc"))]);

    expect(estados(q)).toEqual(["error", "skipped"]);
    expect(q.getSnapshot().running).toBe(false);
  });
});

describe("fila de envio global: bordas", () => {
  it("o erro de rede também avisa que terminou e atualiza a lista", async () => {
    const eventos: string[] = [];
    const q = createUploadQueue({
      send: async () => {
        throw Object.assign(new Error("rede"), { status: 0 });
      },
      wait: semEspera,
      onRunningChange: (r) => eventos.push(r ? "começou" : "terminou"),
      onSettled: () => void eventos.push("lista atualizada"),
    });

    await q.add([pendente(arq("a.zevtc"))]);

    expect(eventos).toEqual(["começou", "terminou", "lista atualizada"]);
  });

  it("falhar ao atualizar a lista de lutas não quebra a fila", async () => {
    const q = createUploadQueue({
      send: async (f) => ok(f.name),
      wait: semEspera,
      onSettled: () => Promise.reject(new Error("falha ao atualizar")),
    });

    await expect(q.add([pendente(arq("a.zevtc"))])).resolves.toBeUndefined();

    expect(q.getSnapshot().running).toBe(false);
    expect(estados(q)).toEqual(["done"]);
  });

  it("enviar tudo com um envio em andamento não abre um segundo envio por cima", async () => {
    const { send, soltar } = comPorta();
    const enviados: string[] = [];
    const q = createUploadQueue({ send: (f) => (enviados.push(f.name), send(f)), wait: semEspera });
    const primeiro = q.add([pendente(arq("a.zevtc")), pendente(arq("b.zevtc"))]);

    await q.sendAll();

    expect(enviados).toEqual(["a.zevtc"]); // só o envio que já estava indo
    await soltar();
    await soltar();
    await primeiro;
    expect(enviados).toEqual(["a.zevtc", "b.zevtc"]);
  });

  it("parar sem nada em andamento não contamina o próximo envio", async () => {
    const enviados: string[] = [];
    const q = createUploadQueue({ send: async (f) => (enviados.push(f.name), ok(f.name)), wait: semEspera });

    q.stop();
    await q.add([pendente(arq("a.zevtc"))]);

    expect(enviados).toEqual(["a.zevtc"]);
    expect(estados(q)).toEqual(["done"]);
  });
});
