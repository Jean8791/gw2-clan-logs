# Roda o site no seu PC: http://localhost:5080
# Uso:  powershell -ExecutionPolicy Bypass -File .\iniciar.ps1  [-SenhaDoCla "minhasenha"]
param([string]$SenhaDoCla = "")

$root = $PSScriptRoot
$env:ASPNETCORE_URLS = "http://localhost:5080"
$env:DATA_DIR = Join-Path $root "data"
$env:EI_DIR = Join-Path $root "tools\GW2EICLI"
$env:UPLOAD_KEY = $SenhaDoCla

if (-not (Test-Path (Join-Path $env:EI_DIR "GuildWars2EliteInsights-CLI.dll"))) {
    # Primeira execução: baixa o Elite Insights CLI (parser oficial da comunidade) do GitHub.
    $versao = "v3.32.0.0"
    $url = "https://github.com/baaron4/GW2-Elite-Insights-Parser/releases/download/$versao/GW2EICLI.zip"
    Write-Host "Baixando o Elite Insights $versao..." -ForegroundColor Yellow
    $zip = Join-Path $env:TEMP "GW2EICLI-$versao.zip"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
        New-Item -ItemType Directory -Force $env:EI_DIR | Out-Null
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($zip)
        foreach ($e in $z.Entries) {
            # prefixo \\?\ evita o limite de 260 caracteres em caminhos longos
            $t = "\\?\" + (Join-Path $env:EI_DIR $e.FullName)
            if ($e.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($t) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($t)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $t, $true)
        }
        $z.Dispose(); Remove-Item $zip
    } catch {
        Write-Host "Não foi possível baixar o Elite Insights: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Baixe o GW2EICLI.zip em https://github.com/baaron4/GW2-Elite-Insights-Parser/releases e extraia em $env:EI_DIR"
        exit 1
    }
}

Write-Host "Site em http://localhost:5080  (Ctrl+C para parar)" -ForegroundColor Green
dotnet run --project (Join-Path $root "src\Gw2Logs") -c Release --no-launch-profile
