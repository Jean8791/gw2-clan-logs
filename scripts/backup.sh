#!/usr/bin/env bash
# Copia o banco (cópia consistente, mesmo com o site em uso) para /data/backup dentro do volume.
# Guarda uma cópia por dia da semana (gw2logs-seg.db ...), então ficam as últimas 7.
# Uso (na VM, na pasta do projeto): scripts/backup.sh   |   cron: 0 4 * * * cd ~/gw2-clan-logs && scripts/backup.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker compose exec -T app node -e '
const Database = require("better-sqlite3");
const fs = require("node:fs");
const dia = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date().getDay()];
fs.mkdirSync("/data/backup", { recursive: true });
const destino = `/data/backup/gw2logs-${dia}.db`;
new Database("/data/gw2logs-v2.db", { readonly: true }).backup(destino).then(() => console.log("Backup: " + destino));
'
