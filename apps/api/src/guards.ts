import fs from "node:fs/promises";
import path from "node:path";

interface Attempts {
  fails: number;
  last: number;
  blockedUntil: number;
}

/** Bloqueia um IP por um tempo depois de errar a senha N vezes seguidas (contra tentativa de adivinhar). */
export class AttemptLimiter {
  private byIp = new Map<string, Attempts>();

  constructor(
    private maxFails: number,
    private blockMs: number,
    private now: () => number = Date.now,
  ) {}

  /** Milissegundos que faltam para o IP poder tentar de novo; 0 = livre. */
  blockedFor(ip: string): number {
    const a = this.byIp.get(ip);
    if (!a || a.blockedUntil === 0) return 0;
    const left = a.blockedUntil - this.now();
    if (left <= 0) this.byIp.delete(ip);
    return Math.max(0, left);
  }

  fail(ip: string) {
    const now = this.now();
    this.forgetOld(now);
    const a = this.byIp.get(ip) ?? { fails: 0, last: now, blockedUntil: 0 };
    a.fails++;
    a.last = now;
    if (a.fails >= this.maxFails) a.blockedUntil = now + this.blockMs;
    this.byIp.set(ip, a);
  }

  /** Senha certa: os erros anteriores deixam de contar. */
  reset(ip: string) {
    this.byIp.delete(ip);
  }

  size() {
    return this.byIp.size;
  }

  // sem isso a tabela cresceria com cada IP que errou uma vez
  private forgetOld(now: number) {
    for (const [ip, a] of this.byIp) if (a.blockedUntil ? a.blockedUntil <= now : now - a.last > this.blockMs) this.byIp.delete(ip);
  }
}

/** Tamanho, em bytes, dos arquivos de uma pasta (a dos logs enviados é plana). */
export async function folderBytes(dir: string): Promise<number> {
  const names = await fs.readdir(dir).catch(() => []);
  const sizes = await Promise.all(names.map((n) => fs.stat(path.join(dir, n)).then((s) => (s.isFile() ? s.size : 0), () => 0)));
  return sizes.reduce((a, b) => a + b, 0);
}
