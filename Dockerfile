# Logs do Clã: site + API + Elite Insights numa imagem só.
# Build:  docker build -t gw2-clan-logs .
# Rodar:  docker run -d -p 8080:8080 -v gw2logs-data:/data -e UPLOAD_KEY=senhadocla --restart unless-stopped gw2-clan-logs

FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Elite Insights CLI (parser oficial). Troque a versão para atualizar.
FROM debian:bookworm-slim AS ei
ARG EI_VERSION=v3.32.0.0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates unzip && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/ei.zip "https://github.com/baaron4/GW2-Elite-Insights-Parser/releases/download/${EI_VERSION}/GW2EICLI.zip" \
 && mkdir -p /ei && unzip -q /tmp/ei.zip -d /ei

# Runtime .NET (para o EI) + Node (para a API)
FROM mcr.microsoft.com/dotnet/runtime:8.0-bookworm-slim
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=ei /ei /ei
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data EI_DIR=/ei WEB_DIR=/app/apps/web/dist
VOLUME /data
EXPOSE 8080
CMD ["node", "apps/api/dist/index.js"]
