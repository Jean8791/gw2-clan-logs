# Site de logs do clã (ArcDPS + Elite Insights)
# Build:  docker build -t gw2logs .
# Rodar:  docker run -d -p 8080:8080 -v gw2logs-data:/data -e UPLOAD_KEY=senhadocla --restart unless-stopped gw2logs

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Gw2Logs/Gw2Logs.csproj src/Gw2Logs/
RUN dotnet restore src/Gw2Logs/Gw2Logs.csproj
COPY src/ src/
RUN dotnet publish src/Gw2Logs/Gw2Logs.csproj -c Release -o /app --no-restore

# Elite Insights CLI (parser oficial da comunidade). Troque a versão para atualizar.
ARG EI_VERSION=v3.32.0.0
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/ei.zip "https://github.com/baaron4/GW2-Elite-Insights-Parser/releases/download/${EI_VERSION}/GW2EICLI.zip" \
 && mkdir -p /ei && unzip -q /tmp/ei.zip -d /ei && rm /tmp/ei.zip

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
COPY --from=build /ei /ei
ENV ASPNETCORE_URLS=http://+:8080 \
    DATA_DIR=/data \
    EI_DIR=/ei
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["dotnet", "Gw2Logs.dll"]
