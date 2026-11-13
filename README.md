# Logs do Clã: histórico de WvW para Guild Wars 2

Site para clãs e alianças de **Guild Wars 2** guardarem e analisarem as lutas de WvW. Os membros enviam os logs do ArcDPS (`.zevtc`), o site processa cada um com o **Elite Insights** e monta um histórico contínuo, com filtros que relatórios por sessão não têm:

- **Ranking** por período, **guilda**, **só a aliança**, função (DPS × suporte), classe, tamanho do squad, duração e mapa. Mostra totais ou valores **por minuto** de luta e ordena por qualquer coluna. Os filtros ficam no link, então dá para mandar no Discord.
- **Guildas**: a guilda que cada jogador representava na luta vem do log, e o nome e a tag vêm da API oficial do GW2. É só marcar com ★ as guildas da aliança.
- **Meu perfil**: o histórico do próprio jogador, a evolução luta a luta e a comparação com a média de quem joga na mesma função.
- **Comparar** até 4 jogadores lado a lado, com radar e tabela por minuto.
- **Detalhe da luta**: squad × inimigos, gráfico de dano, tabelas de Dano, Suporte, Boons e Defesa, visão **por guilda** e link para o relatório completo do Elite Insights (rotação, linha do tempo, replay).
- O mesmo log enviado duas vezes é ignorado. O site também aceita o `.json` do Elite Insights ou do dps.report.

## Stack

| Parte | Tecnologia |
|---|---|
| API | Node 20 + TypeScript, Fastify, SQLite (better-sqlite3) |
| Site | React 19 + Vite, Tailwind CSS 4, TanStack Query, Recharts |
| Parser | [Elite Insights](https://github.com/baaron4/GW2-Elite-Insights-Parser) CLI (.NET), chamado pela API |
| Testes / CI | Vitest, GitHub Actions |

Monorepo com npm workspaces:

```
apps/api/         API REST, fila de processamento, extração das estatísticas
  src/ingest.ts   JSON do Elite Insights → estatísticas por jogador (função pura, testada)
  src/queries.ts  ranking, perfil, comparação e filtros em SQL
apps/web/         site em React
packages/shared/  tipos, métricas e filtros usados pelos dois lados
```

O JSON completo de cada luta fica guardado em `data/fights/<id>/ei.json.gz`. Uma métrica nova pode ser calculada depois com `npm run reingest`, sem reenviar os logs.

## Rodar localmente

Precisa do **Node 20+**. Para processar `.zevtc` também precisa do **runtime .NET** e do Elite Insights. Sem eles, o site aceita só o `.json` do EI.

```bash
npm install
scripts/baixar-elite-insights.sh     # opcional: baixa o EI para tools/GW2EICLI
npm run build && npm start           # http://localhost:5080
```

Desenvolvimento, com o site em http://localhost:5173 e a API em :5080:

```bash
npm run dev
npm test
```

### Configuração (variáveis de ambiente)

| Variável | Para quê | Padrão |
|---|---|---|
| `UPLOAD_KEY` | Chave de API para enviar logs (`scripts/enviar-logs.sh`). Vazio = qualquer um envia, nunca deixe vazio na internet | vazio |
| `ADMIN_KEY` | Senha para marcar as guildas da aliança | igual a `UPLOAD_KEY` |
| `DATA_DIR` | Banco SQLite, logs enviados e relatórios | `./data` |
| `EI_DIR` | Pasta do Elite Insights CLI | `./tools/GW2EICLI` |
| `PORT` / `HOST` | Endereço do servidor | `5080` / `127.0.0.1` |
| `RETENTION_DAYS` | Dias que as lutas ficam guardadas, contados pela data da luta e não pela do envio (0 = para sempre). No Docker Compose o padrão é 30 | `0` |
| `GW2_API` | `off` desliga a busca de nomes de guildas e mapas | ligado |
| `EI_HTML` | `true` gera o relatório HTML do Elite Insights (botão "Relatório completo"). Custa 40 a 50 MB de disco e ~300 MB de memória a mais por luta grande, então fica desligado | `false` |
| `TRUST_PROXY` | `true` atrás do Caddy: conta o IP real do cliente nos bloqueios. O compose já liga | `false` |
| `UPLOAD_MAX_FAILS` / `UPLOAD_BLOCK_MIN` | Erros de senha seguidos do mesmo IP até bloquear, e por quantos minutos | `5` / `15` |
| `UPLOAD_MAX_QUEUE` | Logs esperando ou em processamento; acima disso o envio é recusado | `30` |
| `UPLOAD_MAX_PER_HOUR` | Logs novos aceitos por hora | `500` |
| `UPLOAD_MAX_DISK_MB` | Espaço máximo dos logs enviados | `4096` |
| `APP_MEM_LIMIT` (compose) | Teto de memória do container; em VM de 1 GB use `800m` | `1500m` |

### Enviar logs

O site não tem tela de envio: os logs entram só pela API, com a chave (`UPLOAD_KEY`), usando o script:

```bash
export GW2LOGS_URL=https://seu-dominio GW2LOGS_KEY=a-chave   # ou ~/.config/gw2logs/env (chmod 600)
scripts/enviar-logs.sh ~/Documentos/Guild\ Wars\ 2/addons/arcdps/arcdps.cbtlogs   # arquivos ou pastas
```

O script não manda de novo o que já enviou, espera quando a fila do servidor está cheia e para com aviso ao bater um limite. A chave só segue ao servidor por entrada padrão (não aparece em `ps`). Quem tem a chave envia: guarde-a como senha e troque `UPLOAD_KEY` se ela vazar.

Faça backup da pasta `data`: é ali que fica todo o histórico.

## Colocar no ar (grátis, 24 h, sem depender do seu PC)

Serviços como Render e Vercel no plano grátis desligam o servidor ou apagam o disco, e o site precisa guardar o banco. A opção usada aqui é uma VM *Always Free* da Oracle Cloud (Ampere A1, ARM) com HTTPS automático pelo Caddy e um subdomínio grátis do DuckDNS.

1. **VM na Oracle Cloud:** crie a conta e uma instância `VM.Standard.A1.Flex` (1 a 2 OCPUs e 6 a 12 GB bastam), imagem Ubuntu 24.04, com IP público e sua chave SSH. Na VCN, libere as portas 80 e 443 de entrada (*Security List*). No Ubuntu da Oracle o firewall do sistema também bloqueia: `sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT && sudo netfilter-persistent save`.
2. **Subdomínio:** em duckdns.org crie `algo.duckdns.org` apontando para o IP público da VM.
3. **Docker na VM:** `curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER` (saia e entre de novo no SSH).
4. **Projeto:** `git clone https://github.com/Jean8791/gw2-clan-logs && cd gw2-clan-logs && cp .env.example .env`, e edite o `.env` (domínio e senhas fortes).
5. **Subir:** `docker compose up -d --build`. O primeiro build leva alguns minutos; o certificado HTTPS sai sozinho na primeira visita.
6. **Backup diário:** `crontab -e` e `0 4 * * * cd ~/gw2-clan-logs && scripts/backup.sh`. Ele guarda as últimas 7 cópias do banco em `/data/backup` (dentro do volume). Os logs enviados e relatórios ficam em `/data` e expiram com `RETENTION_DAYS` (30 dias no Compose). Cada luta ocupa cerca de 10 MB, então um mês com uns 600 logs fica perto de 6 GB: confira o espaço do disco da VM.
7. **Atualizar:** `git pull && docker compose up -d --build`.

Para testar sem VM, o PC com **Cloudflare Tunnel** também serve (`cloudflared tunnel --url http://localhost:5080`), mas só fica no ar com o PC ligado.

## Onde ficam os logs do ArcDPS

`Documentos\Guild Wars 2\addons\arcdps\arcdps.cbtlogs\`. Para gravar **WvW**: no jogo, Alt+Shift+T → *Logging* → ative a gravação de WvW. Cura e barreira só aparecem se quem gravou usa o addon **Healing Stats**.

## Como as métricas são calculadas

- **Dano, abates e downs** contam só **jogadores inimigos**, sem guardas e estruturas. Em PvE contam os alvos da luta.
- **Por minuto** usa o tempo ativo de cada jogador na luta.
- **Boons** são o volume gerado para o squad (`squadBuffVolumes` do Elite Insights).
- **Função** é estimada por luta: é suporte quem cura e dá barreira mais que metade do próprio dano, ou quem está entre os maiores geradores de boons do squad.
