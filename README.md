# Logs do Clã: site de logs do ArcDPS para Guild Wars 2

Os membros do clã enviam os logs do ArcDPS (`.zevtc`). O site processa cada um com o **Elite Insights** (o parser oficial da comunidade) e mostra:

- **Lutas:** lista de lutas de WvW e PvE, com squad, inimigos, kills, mortes e DPS.
- **Detalhe da luta:** gráfico de dano por jogador e tabelas de Dano, Suporte (strips, cleanses, cura, barreira), Boons gerados para o squad (estabilidade, rapidez, alacridade…) e Defesa. Tem um link para o **relatório completo do Elite Insights** (rotação, linha do tempo, replay da luta).
- **Ranking do clã:** por período (7/30/90 dias ou tudo), em total ou **por minuto** de luta. A tabela pode ser ordenada por qualquer coluna.
- **Histórico do jogador:** evolução do DPS, strips e cleanses luta a luta, e as classes que ele jogou.

O mesmo log enviado duas vezes é detectado e ignorado. Também é possível enviar o `.json` gerado pelo Elite Insights ou baixado do dps.report.

## Onde ficam os logs do ArcDPS

`Documentos\Guild Wars 2\addons\arcdps\arcdps.cbtlogs\`

Para gravar lutas de **WvW**: no jogo, abra Alt+Shift+T → *Logging* e ative a gravação de WvW. Por padrão o ArcDPS só grava bosses de PvE.

## Rodar no seu PC

Precisa do **.NET 10 SDK** (`winget install Microsoft.DotNet.SDK.10`). Na primeira execução, o `iniciar.ps1` baixa sozinho o **Elite Insights CLI** para `tools\GW2EICLI`.

```powershell
powershell -ExecutionPolicy Bypass -File .\iniciar.ps1
# com senha para enviar logs:
powershell -ExecutionPolicy Bypass -File .\iniciar.ps1 -SenhaDoCla "minhasenha"
```

Depois abra http://localhost:5080.

## Rodar no Linux / Ubuntu

Precisa do **.NET 10 SDK** (`sudo apt install dotnet-sdk-10.0`; se o pacote não aparecer, veja https://learn.microsoft.com/dotnet/core/install/linux-ubuntu) e do `unzip`.

```bash
chmod +x iniciar.sh
./iniciar.sh                                  # http://localhost:5080
UPLOAD_KEY=senhadocla ./iniciar.sh            # exige senha para enviar logs
URLS=http://0.0.0.0:5080 ./iniciar.sh         # aceita acesso de outras máquinas
```

Na primeira execução, o script baixa o Elite Insights sozinho.

## Configuração

| Variável | Para quê | Padrão |
|---|---|---|
| `UPLOAD_KEY` | Senha que o pessoal digita para enviar logs. Vazio = qualquer um envia. | vazio |
| `DATA_DIR` | Onde ficam o banco (SQLite), os logs enviados e os relatórios | `./data` |
| `EI_DIR` | Pasta do Elite Insights CLI | `../../tools/GW2EICLI` |

**Faça backup da pasta `data`**: é ali que fica todo o histórico do clã.

## Colocar no ar de graça

Opção 1 é a mais fácil. Opção 2 deixa o site no ar 24 h sem depender do seu PC.

### Opção 1: no seu PC + Cloudflare Tunnel (grátis)
O site roda no seu PC e o Cloudflare cria um endereço público (`https://algo.trycloudflare.com`) sem abrir porta no roteador.
1. Rode `iniciar.ps1 -SenhaDoCla "..."`.
2. Instale o `cloudflared` (`winget install Cloudflare.cloudflared`).
3. Rode `cloudflared tunnel --url http://localhost:5080` e mande o link para o clã.

Limitação: o site só fica no ar enquanto o seu PC estiver ligado, e o link muda a cada vez. Com uma conta grátis da Cloudflare e um domínio dá para ter um link fixo.

### Opção 2: Oracle Cloud "Always Free" (servidor grátis 24 h)
A Oracle dá uma VM ARM gratuita para sempre, que sobra para este site.
1. Crie a conta em cloud.oracle.com. Ela pede cartão só para verificação.
2. Crie uma instância **Ampere A1** (ARM) com Ubuntu e libere a porta 8080 (ou 80/443) na *Security List*.
3. Na VM: instale o Docker, copie esta pasta e rode:
   ```bash
   docker build -t gw2logs .
   docker run -d --name gw2logs -p 8080:8080 -v gw2logs-data:/data -e UPLOAD_KEY=senhadocla --restart unless-stopped gw2logs
   ```
4. Para HTTPS e domínio próprio, use o Cloudflare Tunnel na VM ou um proxy como o Caddy.

Por que não Render, Vercel ou Netlify grátis? O site precisa rodar o Elite Insights e guardar o banco em disco. Os planos grátis desses serviços desligam o servidor ou apagam o disco.

## Estrutura

```
src/Gw2Logs/
  Program.cs        rotas da API e upload
  LogProcessor.cs   fila em segundo plano: roda o Elite Insights e extrai as estatísticas
  Db.cs             banco SQLite (tabelas fights e player_stats)
  wwwroot/          páginas (HTML/CSS/JS, gráficos com Chart.js)
Dockerfile          imagem pronta para servidor (já baixa o Elite Insights)
iniciar.ps1         roda localmente no Windows
```

O JSON completo do Elite Insights de cada luta fica guardado (`data/fights/<id>/ei.json.gz`). Dá para criar estatísticas novas depois sem reenviar os logs.
