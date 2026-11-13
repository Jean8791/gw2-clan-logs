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
| `UPLOAD_KEY` | Senha para enviar logs. Vazio = qualquer um envia | vazio |
| `ADMIN_KEY` | Senha para marcar as guildas da aliança | igual a `UPLOAD_KEY` |
| `DATA_DIR` | Banco SQLite, logs enviados e relatórios | `./data` |
| `EI_DIR` | Pasta do Elite Insights CLI | `./tools/GW2EICLI` |
| `PORT` / `HOST` | Endereço do servidor | `5080` / `127.0.0.1` |
| `GW2_API` | `off` desliga a busca de nomes de guildas e mapas | ligado |

Faça backup da pasta `data`: é ali que fica todo o histórico.

## Colocar no ar

A imagem Docker já traz o Elite Insights e o runtime .NET:

```bash
docker build -t gw2-clan-logs .
docker run -d --name gw2logs -p 8080:8080 -v gw2logs-data:/data \
  -e UPLOAD_KEY=senhadocla --restart unless-stopped gw2-clan-logs
```

Opções gratuitas: uma VM *Always Free* da Oracle Cloud (Ampere A1), ou o próprio PC com **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:5080`). Serviços como Render e Vercel no plano grátis desligam o servidor ou apagam o disco, e o site precisa guardar o banco.

## Onde ficam os logs do ArcDPS

`Documentos\Guild Wars 2\addons\arcdps\arcdps.cbtlogs\`. Para gravar **WvW**: no jogo, Alt+Shift+T → *Logging* → ative a gravação de WvW. Cura e barreira só aparecem se quem gravou usa o addon **Healing Stats**.

## Como as métricas são calculadas

- **Dano, abates e downs** contam só **jogadores inimigos**, sem guardas e estruturas. Em PvE contam os alvos da luta.
- **Por minuto** usa o tempo ativo de cada jogador na luta.
- **Boons** são o volume gerado para o squad (`squadBuffVolumes` do Elite Insights).
- **Função** é estimada por luta: é suporte quem cura e dá barreira mais que metade do próprio dano, ou quem está entre os maiores geradores de boons do squad.
