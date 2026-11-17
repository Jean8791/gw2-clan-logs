import { createSession, upsertDiscordUser } from "../src/auth.js";
import type { App } from "../src/server.js";

/** Cria um usuário direto no banco (sem passar pelo Discord) com o token pessoal de envio. */
export function criarUsuario(app: App, discordId: string, nome = "Teste") {
  const user = upsertDiscordUser(app.db, { id: discordId, username: nome, avatar: null });
  return { ...user, token: createSession(app.db, user.id, "api") };
}

/** Corpo multipart com arquivos (e campos) para o POST /api/upload. */
export function multipart(files: { name: string; content: string }[], fields: Record<string, string> = {}) {
  const boundary = "----teste" + Math.random().toString(16).slice(2);
  let body = "";
  for (const [k, v] of Object.entries(fields)) body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  for (const f of files)
    body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n${f.content}\r\n`;
  body += `--${boundary}--\r\n`;
  return { payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
