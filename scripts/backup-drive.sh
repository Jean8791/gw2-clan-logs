#!/usr/bin/env bash
# Envia uma cópia consistente do banco, criptografada, para o Google Drive (rclone) e apaga as cópias com mais de BACKUP_DIAS dias.
# Pré-requisito (README, "Backup fora da VM"): rclone com o remoto cifrado `gw2crypt`, criado por cima de um remoto do Drive com escopo drive.file.
# Uso (na VM): scripts/backup-drive.sh
# Variáveis opcionais: BACKUP_DIAS (padrão 30), BACKUP_REMOTE (padrão gw2crypt:; um remoto local, como :local:/pasta/, serve para testar sem o Drive)
# e GW2_DIR (pasta do projeto; padrão: a pasta acima de scripts/).
# Cron do root (depois do backup local das 04:00; o root não acha a configuração do rclone do usuário, então aponte para ela):
#   15 4 * * * RCLONE_CONFIG=/home/ubuntu/.config/rclone/rclone.conf /home/ubuntu/gw2-clan-logs/scripts/backup-drive.sh >> /var/log/gw2-backup-drive.log 2>&1
set -euo pipefail
cd "${GW2_DIR:-$(dirname "${BASH_SOURCE[0]}")/..}"

REMOTE="${BACKUP_REMOTE:-gw2crypt:}"
DIAS="${BACKUP_DIAS:-30}"
NOME="gw2logs-$(date -u +%Y-%m-%d).db"
TMP="/data/backup/envio-drive.db" # dentro do volume do app; apagado no fim (com os arquivos de apoio), com ou sem erro

exec 9>/run/lock/gw2-backup-drive.lock
flock -n 9 || { echo "$(date -u +%FT%TZ) outro envio já está rodando; saindo"; exit 0; }

command -v rclone >/dev/null || { echo "rclone não está instalado" >&2; exit 1; }
# o -wal e o -shm nascem quando a cópia é aberta para conferir a integridade
trap 'docker compose exec -T app rm -f "$TMP" "$TMP-wal" "$TMP-shm" "$TMP-journal" </dev/null || true' EXIT

echo "$(date -u +%FT%TZ) início: $NOME"
rclone lsd "$REMOTE" >/dev/null # falha cedo se o Drive ou a credencial não responderem

# 1) cópia consistente (mesmo com o site em uso) e conferência de integridade antes de enviar
docker compose exec -T app node -e '
const Database = require("better-sqlite3");
const fs = require("node:fs");
const destino = process.argv[1];
fs.mkdirSync("/data/backup", { recursive: true });
new Database("/data/gw2logs-v2.db", { readonly: true })
  .backup(destino)
  .then(() => {
    const copia = new Database(destino, { readonly: true });
    try {
      const r = copia.pragma("integrity_check", { simple: true });
      if (r !== "ok") throw new Error("integridade da cópia falhou: " + r);
    } finally {
      copia.close();
    }
  })
  .catch((e) => {
    console.error("falha ao copiar o banco: " + e.message);
    process.exit(1);
  });
' -- "$TMP" </dev/null

# 2) envia (cifrado) e 3) confere que o tamanho no Drive é o da cópia
TAMANHO="$(docker compose exec -T app stat -c %s "$TMP" </dev/null | tr -d '\r')"
docker compose exec -T app cat "$TMP" </dev/null | rclone rcat "${REMOTE}${NOME}"
NO_DRIVE="$(rclone size "${REMOTE}${NOME}" --json | grep -oE '"bytes": *[0-9]+' | grep -oE '[0-9]+$')"
[ "$TAMANHO" = "$NO_DRIVE" ] || { echo "tamanho diferente: cópia $TAMANHO, Drive $NO_DRIVE" >&2; exit 1; }

# 4) só depois de conferir o envio de hoje, apaga as antigas (só os gw2logs-*.db: qualquer outro arquivo da pasta fica como está)
rclone delete "$REMOTE" --include "gw2logs-*.db" --min-age "${DIAS}d"
echo "$(date -u +%FT%TZ) ok: $NOME ($TAMANHO bytes); no Drive: $(rclone lsf "$REMOTE" --include "gw2logs-*.db" | wc -l) cópia(s)"
