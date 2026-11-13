# Próximos passos

## Feito (v0.2)
- Reescrita em Node/TypeScript + React (a versão .NET está no primeiro commit).
- Filtros por período, guilda, aliança, função, classe, tamanho do squad, duração e mapa.
- Guildas com nome e tag pela API do GW2, marcação das guildas da aliança.
- Perfil do jogador ("sou eu"), evolução luta a luta e comparação com a média da mesma função.
- Comparação de até 4 jogadores (radar + tabela).
- Correção: geração de boons agora lê `squadBuffVolumes` (a versão antiga lia `squadBuffs`, que o EI 3.x não gera).
- Dano/abates contam só jogadores inimigos.

## Pendente
1. **Testar com o Elite Insights de verdade**: instalar o runtime .NET, rodar `scripts/baixar-elite-insights.sh` e enviar os 20 logs de `logs-arcdps/`. Conferir qual versão do .NET o EI v3.32 exige e ajustar a imagem base do Dockerfile se precisar (hoje: `dotnet/runtime:8.0`).
2. **Testar o Dockerfile** (`docker build`).
3. **Enviador automático**: programa que vigia a pasta do ArcDPS e envia os logs novos sozinho.
4. **Colocar no ar para o clã**: Oracle Cloud Always Free ou Cloudflare Tunnel (ver README).
5. Ideias: sessões (agrupar as lutas de uma noite), página do comandante, prints no README.

## Ajustes sugeridos no ArcDPS (aba Logging)
- minimum squad participants: **1** (grava tudo, o site filtra)
- WvW ignore logs shorter than: **5**
- map logging: **desligado** (instanced e pvp)
