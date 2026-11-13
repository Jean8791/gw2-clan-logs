# Onde paramos (13/11/2026)

## Já feito
- ArcDPS funcionando pelo **Nexus**. O erro "Unable to initialize 3D output" era o Controle Inteligente de Aplicativos do Windows, que já foi desligado.
- Gravação de WvW ligada no ArcDPS. A janela de Buffs foi configurada para suporte: botão **o** (o que você gera) e lista **2** (Estabilidade, Égide, Proteção…).
- Healing Stats instalado pelo Nexus. **Conferir** em Alt+Shift+T → About → extensions se ele aparece.
- Site do clã pronto nesta pasta. Para rodar: `powershell -ExecutionPolicy Bypass -File .\iniciar.ps1` → http://localhost:5080

## Continuando no Ubuntu
- Descompacte o zip, entre em `gw2-clan-logs` e rode `chmod +x iniciar.sh && ./iniciar.sh`. Ver a seção "Rodar no Linux / Ubuntu" do README.
- `data/` já tem o banco do site com as 6 primeiras lutas (Seared Borderlands), os relatórios e os arquivos enviados.
- `logs-arcdps/` tem os **20 logs originais** do ArcDPS de 12–13/11. Para enviar todos ao site (os já enviados são ignorados):
  ```bash
  for f in logs-arcdps/**/*.zevtc logs-arcdps/*/*/*.zevtc; do [ -f "$f" ] && curl -s -F "uploader=SeuNome" -F "file=@$f" http://localhost:5080/api/upload; echo; done
  ```
- Enviar ao GitHub pelo Ubuntu (lá o git já está configurado): `git init -b main && git add -A && git commit -m "Site de logs do clã"`. Depois crie o repositório **privado** `gw2-clan-logs` e faça o push. `data/`, `tools/` e `logs-arcdps/` **não** devem ir para o GitHub, porque têm nomes de contas do clã.

## Para continuar
1. **Testar com logs reais de WvW.** Os logs ficam em `Documentos\Guild Wars 2\addons\arcdps\arcdps.cbtlogs`; envie em "Enviar logs".
2. **Filtros no site**, na lista de lutas e no ranking. Escolher quais:
   - tamanho do squad e número de inimigos (raid × roaming)
   - duração mínima da luta
   - mapa (EBG, Borderlands…)
   - data específica
   - função: suportes × DPS no ranking
   - quem gravou ou enviou
3. **Enviador automático:** um programa que vigia a pasta do ArcDPS e manda os logs novos para o site sozinho.
4. **Colocar no ar para o clã:** Cloudflare Tunnel ou Oracle Cloud grátis (ver README.md).

## Ajustes sugeridos no ArcDPS (aba Logging)
- minimum squad participants: **1** (grava tudo, o site filtra)
- WvW ignore logs shorter than: **5**
- map logging: **desligado** (instanced e pvp)
