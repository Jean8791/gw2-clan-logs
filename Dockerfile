# Logs do Clã: site + API + Elite Insights numa imagem só.
# Build:  docker build -t gw2-clan-logs .
# Rodar:  docker run -d -p 8080:8080 -v gw2logs-data:/data -e RETENTION_DAYS=30 --restart unless-stopped gw2-clan-logs

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Elite Insights CLI (parser oficial). Para atualizar, troque EI_VERSION e EI_SHA256 juntos (veja o README): o download só vale se o hash bater.
FROM debian:bookworm-slim AS ei
ARG EI_VERSION=v3.32.0.0
ARG EI_SHA256=ffcd8578a333723f6ca23ba875bc8b1ac758bdb6888f473c4b5c0602d4d902dd
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates unzip && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/ei.zip "https://github.com/baaron4/GW2-Elite-Insights-Parser/releases/download/${EI_VERSION}/GW2EICLI.zip" \
 && echo "${EI_SHA256}  /tmp/ei.zip" | sha256sum -c - \
 && mkdir -p /ei && unzip -q /tmp/ei.zip -d /ei

# Runtime .NET (para o EI) + Node (para a API)
FROM mcr.microsoft.com/dotnet/runtime:10.0
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=ei /ei /ei
# Usuário sem privilégios: o EI (.NET) processa arquivos enviados por terceiros e não deve rodar como root. O código fica de root (só leitura
# para ele); só /data e a home dele pertencem a ele. uid 10001 (o mesmo do chown do README); o nome evita colidir com o usuário `app` que as imagens .NET costumam trazer.
RUN groupadd --gid 10001 gw2logs \
 && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/gw2logs --shell /usr/sbin/nologin gw2logs \
 && mkdir -p /data /home/gw2logs/.config /home/gw2logs/.local/share \
 && chown -R gw2logs:gw2logs /data /home/gw2logs
# O EI (.NET) cai com "Value cannot be null (path)" se não houver pasta de configuração do usuário.
ENV HOME=/home/gw2logs XDG_CONFIG_HOME=/home/gw2logs/.config XDG_DATA_HOME=/home/gw2logs/.local/share
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data EI_DIR=/ei WEB_DIR=/app/apps/web/dist
VOLUME /data
USER gw2logs
EXPOSE 8080
CMD ["node", "apps/api/dist/index.js"]
