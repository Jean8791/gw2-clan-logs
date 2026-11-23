<#
Envio automatico dos logs do ArcDPS para o site, feito para rodar pelo Agendador de Tarefas (veja instalar-agendamento.ps1).

Fluxo das pastas:
  pasta do ArcDPS (origem) -> GW2 Logs\integrando -> envio para o site -> GW2 Logs\integrado
                                                                        \-> GW2 Logs\erro
Os logs SAEM da pasta do ArcDPS: e assim que o mesmo log nao e enviado de novo a cada execucao.

Configuracao: o mesmo arquivo do enviar-logs.bat, %APPDATA%\gw2logs\config.bat, com linhas "set CHAVE=valor".
  GW2LOGS_URL             endereco do site (obrigatorio)
  GW2LOGS_KEY             token pessoal de envio, gerado no site em Importar logs (obrigatorio)
  GW2LOGS_ORIGEM          pasta do ArcDPS (padrao: Documentos\Guild Wars 2\addons\arcdps\arcdps.cbtlogs)
  GW2LOGS_PASTA           pasta de trabalho (padrao: Documentos\GW2 Logs)
  GW2LOGS_MAX_TENTATIVAS  erros de servidor seguidos por arquivo antes de desistir dele (padrao: 5)
  GW2LOGS_DIAS            so envia logs gravados nos ultimos N dias; os mais antigos ficam na pasta do ArcDPS, sem mexer (padrao: 3; 0 = sem limite)
Variavel de ambiente vale mais que o arquivo.

Registro: <pasta de trabalho>\monitor.log (vira monitor.old.log ao passar de 1 MB).
Token recusado (401): o envio fica pausado ate GW2LOGS_KEY mudar (token-recusado.txt guarda so o SHA-256 dele),
para nao somar tentativas falhas no servidor, que bloqueia o IP na 5a.
Saida: 0 tudo certo ou nada a enviar; 1 parou ou deu erro; 2 falta configuracao.

Compativel com o Windows PowerShell 5.1. Este arquivo precisa ficar so com ASCII e quebra de linha CRLF:
o PowerShell 5.1 le .ps1 sem BOM como ANSI.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$Extensoes = @('.zevtc', '.evtc', '.json')
$IdadeMinimaSegundos = 60          # o ArcDPS ja terminou de gravar
$LimitesDoServidor = @('queueFull', 'hourlyLimit', 'diskFull')
$TamanhoMaximoLog = 1MB
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Utf8ComBom = New-Object System.Text.UTF8Encoding($true)   # monitor.log: o BOM vai so no arquivo novo e faz o 5.1 ler os acentos certo

$script:ArquivoLog = $null

function Write-Log([string]$Mensagem) {
    $linha = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mensagem
    Write-Host $linha
    if ($script:ArquivoLog) {
        try { [System.IO.File]::AppendAllText($script:ArquivoLog, $linha + "`r`n", $Utf8ComBom) } catch { }
    }
}

# Le "set CHAVE=valor" (ou set "CHAVE=valor") do config.bat. Linhas rem/:: e outras sao ignoradas.
function Read-ConfigBat([string]$Caminho) {
    $valores = @{}
    if (-not (Test-Path -LiteralPath $Caminho -PathType Leaf)) { return $valores }
    foreach ($linha in Get-Content -LiteralPath $Caminho) {
        $l = $linha.Trim()
        if ($l -match '^(?i)set\s+"([A-Za-z0-9_]+)=(.*)"$' -or $l -match '^(?i)set\s+([A-Za-z0-9_]+)=(.*)$') {
            $valores[$Matches[1].ToUpperInvariant()] = $Matches[2].Trim()
        }
    }
    return $valores
}

function Get-Setting([hashtable]$Arquivo, [string]$Nome, [string]$Padrao) {
    $doAmbiente = [Environment]::GetEnvironmentVariable($Nome)
    if (-not [string]::IsNullOrWhiteSpace($doAmbiente)) { return $doAmbiente.Trim() }
    if ($Arquivo.ContainsKey($Nome) -and -not [string]::IsNullOrWhiteSpace($Arquivo[$Nome])) { return $Arquivo[$Nome] }
    return $Padrao
}

function Get-FullPathNoSlash([string]$Caminho) {
    return [System.IO.Path]::GetFullPath($Caminho).TrimEnd('\')
}

# Caminho livre: "nome.zevtc", senao "nome (1).zevtc", "nome (2).zevtc"...
function Get-UniquePath([string]$Caminho) {
    if (-not (Test-Path -LiteralPath $Caminho)) { return $Caminho }
    $pasta = [System.IO.Path]::GetDirectoryName($Caminho)
    $base = [System.IO.Path]::GetFileNameWithoutExtension($Caminho)
    $ext = [System.IO.Path]::GetExtension($Caminho)
    for ($n = 1; ; $n++) {
        $novo = Join-Path $pasta ('{0} ({1}){2}' -f $base, $n, $ext)
        if (-not (Test-Path -LiteralPath $novo)) { return $novo }
    }
}

# Move mantendo o caminho relativo a $Raiz dentro de $Destino, sem sobrescrever. Devolve o caminho final.
function Move-Relative([System.IO.FileInfo]$Arquivo, [string]$Raiz, [string]$Destino) {
    $relativo = $Arquivo.FullName.Substring($Raiz.Length).TrimStart('\')
    $alvo = Join-Path $Destino $relativo
    $pasta = [System.IO.Path]::GetDirectoryName($alvo)
    if (-not (Test-Path -LiteralPath $pasta)) { New-Item -ItemType Directory -Path $pasta -Force | Out-Null }
    $alvo = Get-UniquePath $alvo
    Move-Item -LiteralPath $Arquivo.FullName -Destination $alvo
    return $alvo
}

function Get-Relative([string]$Caminho, [string]$Raiz) {
    return $Caminho.Substring($Raiz.Length).TrimStart('\')
}

# O ArcDPS ainda grava o arquivo? Abrir com acesso exclusivo so funciona depois que ele soltou.
function Test-Livre([string]$Caminho) {
    try {
        $fs = [System.IO.File]::Open($Caminho, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
        $fs.Close()
        return $true
    } catch {
        return $false
    }
}

function Get-Logs([string]$Pasta) {
    if (-not (Test-Path -LiteralPath $Pasta -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $Pasta -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $Extensoes -contains $_.Extension.ToLowerInvariant() })
}

function Read-Tentativas([string]$Caminho) {
    $mapa = @{}
    if (-not (Test-Path -LiteralPath $Caminho -PathType Leaf)) { return $mapa }
    try {
        $obj = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($Caminho, $Utf8))
        if ($null -ne $obj) {
            foreach ($p in $obj.PSObject.Properties) { $mapa[$p.Name] = [int]$p.Value }
        }
    } catch {
        Write-Log "Aviso: tentativas.json invalido, recomecando a contagem ($($_.Exception.Message))"
    }
    return $mapa
}

function Save-Tentativas([string]$Caminho, [hashtable]$Mapa) {
    $obj = New-Object PSObject
    foreach ($k in ($Mapa.Keys | Sort-Object)) { $obj | Add-Member -NotePropertyName $k -NotePropertyValue $Mapa[$k] }
    $json = if ($Mapa.Count -eq 0) { '{}' } else { ConvertTo-Json -InputObject $obj }
    [System.IO.File]::WriteAllText($Caminho, $json, $Utf8)
}

function Get-Sha256Hex([string]$Texto) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($Utf8.GetBytes($Texto)) | ForEach-Object { $_.ToString('x2') }) -join '') }
    finally { $sha.Dispose() }
}

# Texto entre aspas de um arquivo --config do curl: \ e " precisam de escape.
function ConvertTo-CurlString([string]$Texto) {
    return '"' + $Texto.Replace('\', '\\').Replace('"', '\"') + '"'
}

# O primeiro item da lista que o servidor devolve. ConvertFrom-Json no PowerShell 5.1 devolve o array inteiro
# como um objeto so; no 7 ele enumera. O foreach abaixo trata os dois casos (e um array dentro de outro).
function Get-PrimeiroItem([string]$Json) {
    $dados = ConvertFrom-Json -InputObject $Json
    $itens = @()
    foreach ($x in $dados) {
        if ($x -is [System.Array]) { foreach ($y in $x) { $itens += $y } } else { $itens += $x }
    }
    if ($itens.Count -lt 1 -or $null -eq $itens[0]) { return $null }
    return $itens[0]
}

function Get-Prop($Objeto, [string]$Nome) {
    if ($null -eq $Objeto) { return $null }
    $p = $Objeto.PSObject.Properties[$Nome]
    if ($null -eq $p) { return $null }
    return $p.Value
}

# Envia um arquivo. Devolve @{ Saida = codigo do curl; Http = '200'...; Corpo = texto; Erro = stderr do curl }.
# O token e o arquivo vao pelo --config temporario, nunca na linha de comando. O curl roda na pasta do arquivo
# e recebe so o nome dele, para nao depender de como o curl le acentos do caminho (nome de personagem, usuario).
function Send-Log([System.IO.FileInfo]$Arquivo) {
    $id = [guid]::NewGuid().ToString('N')
    $cfg = Join-Path $env:TEMP "gw2logs-$id.cfg"
    $resp = Join-Path $env:TEMP "gw2logs-$id.resp"
    $linhas = @(
        'url = ' + (ConvertTo-CurlString ($script:Url + '/api/upload'))
        'header = ' + (ConvertTo-CurlString ('X-Upload-Key: ' + $script:Chave))
        'form = ' + (ConvertTo-CurlString ('file=@"' + $Arquivo.Name.Replace('\', '\\').Replace('"', '\"') + '"'))
    )
    $locAntes = Get-Location
    $dirAntes = [Environment]::CurrentDirectory
    $eapAntes = $ErrorActionPreference
    try {
        [System.IO.File]::WriteAllText($cfg, ($linhas -join "`n") + "`n", $Utf8)
        Set-Location -LiteralPath $Arquivo.DirectoryName
        [Environment]::CurrentDirectory = $Arquivo.DirectoryName
        # No 5.1, com 'Stop' a saida de erro do curl vira excecao: decide-se pelo $LASTEXITCODE
        $ErrorActionPreference = 'Continue'
        $saida = & $script:Curl -sS --connect-timeout 30 -m 900 -o $resp -w '%{http_code}' --config $cfg 2>&1
        $codigo = $LASTEXITCODE
        $ErrorActionPreference = $eapAntes
        $http = (@($saida | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join '').Trim()
        $erro = (@($saida | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() }) -join ' ').Trim()
        $corpo = ''
        if (Test-Path -LiteralPath $resp) { $corpo = [System.IO.File]::ReadAllText($resp, $Utf8) }
        return @{ Saida = $codigo; Http = $http; Corpo = $corpo; Erro = $erro }
    } finally {
        $ErrorActionPreference = $eapAntes
        Set-Location -LiteralPath $locAntes.ProviderPath
        [Environment]::CurrentDirectory = $dirAntes
        Remove-Item -LiteralPath $cfg -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $resp -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------- configuracao
$configBat = Join-Path $env:APPDATA 'gw2logs\config.bat'
$doArquivo = Read-ConfigBat $configBat
$documentos = [Environment]::GetFolderPath('MyDocuments')   # segue o OneDrive, se Documentos foi movido para la

$script:Url = Get-Setting $doArquivo 'GW2LOGS_URL' ''
$script:Chave = Get-Setting $doArquivo 'GW2LOGS_KEY' ''
$origem = Get-Setting $doArquivo 'GW2LOGS_ORIGEM' (Join-Path $documentos 'Guild Wars 2\addons\arcdps\arcdps.cbtlogs')
$pasta = Get-Setting $doArquivo 'GW2LOGS_PASTA' (Join-Path $documentos 'GW2 Logs')
$maxTentativasTexto = Get-Setting $doArquivo 'GW2LOGS_MAX_TENTATIVAS' '5'
$diasTexto = Get-Setting $doArquivo 'GW2LOGS_DIAS' '3'

$problemas = @()
try {
    $pasta = Get-FullPathNoSlash ([Environment]::ExpandEnvironmentVariables($pasta))
    $origem = Get-FullPathNoSlash ([Environment]::ExpandEnvironmentVariables($origem))
} catch {
    $problemas += "caminho invalido em GW2LOGS_PASTA ou GW2LOGS_ORIGEM ($($_.Exception.Message))"
}
$integrando = Join-Path $pasta 'integrando'
$integrado = Join-Path $pasta 'integrado'
$pastaErro = Join-Path $pasta 'erro'

# a pasta de trabalho precisa existir antes de qualquer registro
if ($problemas.Count -eq 0) {
    try {
        foreach ($p in @($pasta, $integrando, $integrado, $pastaErro)) {
            if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
        }
        $script:ArquivoLog = Join-Path $pasta 'monitor.log'
        if ((Test-Path -LiteralPath $script:ArquivoLog) -and (Get-Item -LiteralPath $script:ArquivoLog).Length -gt $TamanhoMaximoLog) {
            Move-Item -LiteralPath $script:ArquivoLog -Destination (Join-Path $pasta 'monitor.old.log') -Force
        }
    } catch {
        $script:ArquivoLog = $null
        $problemas += "nao consegui criar a pasta de trabalho $pasta ($($_.Exception.Message))"
    }
}

$script:Url = $script:Url.TrimEnd('/')
if ($script:Url -eq '' -or $script:Chave -eq '') { $problemas += "defina GW2LOGS_URL e GW2LOGS_KEY (variaveis de ambiente ou $configBat)" }
elseif ($script:Url -notmatch '^https?://') { $problemas += "GW2LOGS_URL precisa comecar com http:// ou https:// (esta '$($script:Url)')" }
$maxTentativas = 0
if (-not [int]::TryParse($maxTentativasTexto, [ref]$maxTentativas) -or $maxTentativas -lt 1) {
    $problemas += "GW2LOGS_MAX_TENTATIVAS precisa ser um numero maior que zero (esta '$maxTentativasTexto')"
}
$dias = 0
if (-not [int]::TryParse($diasTexto, [ref]$dias) -or $dias -lt 0) {
    $problemas += "GW2LOGS_DIAS precisa ser um numero inteiro, 0 ou maior (esta '$diasTexto')"
}
if ($problemas.Count -eq 0) {
    $prefixoOrigem = $origem + '\'
    $prefixoPasta = $pasta + '\'
    if ($pasta -eq $origem -or $prefixoPasta.StartsWith($prefixoOrigem, [StringComparison]::OrdinalIgnoreCase) -or $prefixoOrigem.StartsWith($prefixoPasta, [StringComparison]::OrdinalIgnoreCase)) {
        $problemas += "GW2LOGS_PASTA ($pasta) e GW2LOGS_ORIGEM ($origem) nao podem ficar uma dentro da outra"
    }
}

$script:Curl = Join-Path $env:SystemRoot 'System32\curl.exe'
if (-not (Test-Path -LiteralPath $script:Curl)) {
    $cmd = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { $script:Curl = $cmd.Source } else { $problemas += 'curl.exe nao encontrado (ele vem no Windows 10 e 11)' }
}

if ($problemas.Count -gt 0) {
    foreach ($p in $problemas) { Write-Log "Configuracao: $p" }
    exit 2
}

# ---------------------------------------------------------------- uma execucao por vez
# O nome leva o SID: a tarefa (S4U) e uma execucao na mao do mesmo usuario ficam em sessoes diferentes, por isso Global.
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex = New-Object System.Threading.Mutex($false, "Global\gw2logs-monitor-$sid")
$temMutex = $false
try {
    try { $temMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $temMutex = $true }
    if (-not $temMutex) { exit 0 }   # a execucao anterior ainda esta rodando: nao faz nada

    $movidos = 0; $enviados = 0; $jaEnviados = 0; $recusados = 0; $falhas = 0
    $motivoParada = $null

    # ------------------------------------------------------------ etapa 1: origem -> integrando
    if (-not (Test-Path -LiteralPath $origem -PathType Container)) {
        Write-Log "Aviso: pasta do ArcDPS nao encontrada ($origem). Confira GW2LOGS_ORIGEM."
    } else {
        $limite = (Get-Date).AddSeconds(-$IdadeMinimaSegundos)
        # os logs mais antigos que GW2LOGS_DIAS nao entram: ficam onde estao (evita encher a fila do servidor na primeira execucao)
        $maisAntigo = if ($dias -gt 0) { (Get-Date).AddDays(-$dias) } else { [datetime]::MinValue }
        foreach ($f in (Get-Logs $origem | Sort-Object LastWriteTime, FullName)) {
            if ($f.LastWriteTime -gt $limite) { continue }
            if ($f.LastWriteTime -lt $maisAntigo) { continue }
            if (-not (Test-Livre $f.FullName)) { continue }
            try {
                Move-Relative $f $origem $integrando | Out-Null
                $movidos++
            } catch {
                $falhas++
                Write-Log "Erro ao mover $($f.FullName) para integrando: $($_.Exception.Message)"
            }
        }
        # subpastas que ficaram vazias, da mais funda para a mais rasa (a propria origem fica)
        $pastas = @(Get-ChildItem -LiteralPath $origem -Recurse -Directory -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)
        foreach ($d in $pastas) {
            if ($d.LastWriteTime -gt $limite) { continue }
            if (@(Get-ChildItem -LiteralPath $d.FullName -Force -ErrorAction SilentlyContinue).Count -gt 0) { continue }
            try { Remove-Item -LiteralPath $d.FullName -Force } catch { }
        }
    }

    # ------------------------------------------------------------ etapa 2: envio do que esta em integrando
    $arquivoTentativas = Join-Path $pasta 'tentativas.json'
    $tentativas = Read-Tentativas $arquivoTentativas
    $mudouTentativas = $false
    $fila = @(Get-Logs $integrando | Sort-Object LastWriteTime, FullName)

    # Depois de um 401 o envio fica pausado ate o token mudar: cada token errado conta como tentativa falha no servidor,
    # e a 5a seguida bloqueia o IP, inclusive para o envio pelo navegador. O arquivo guarda so o SHA-256 do token.
    $arquivoTokenRecusado = Join-Path $pasta 'token-recusado.txt'
    $hashChave = Get-Sha256Hex $script:Chave
    if (Test-Path -LiteralPath $arquivoTokenRecusado -PathType Leaf) {
        $hashRecusado = ([System.IO.File]::ReadAllText($arquivoTokenRecusado, $Utf8)).Trim()
        if ($hashRecusado -eq $hashChave) {
            if ($fila.Count -gt 0) { $motivoParada = 'envio pausado: este token ja foi recusado (401). Gere outro no site e troque GW2LOGS_KEY' }
            $fila = @()
        } else {
            Remove-Item -LiteralPath $arquivoTokenRecusado -Force
            Write-Log 'Token mudou desde o ultimo 401: voltando a enviar.'
        }
    }

    # contagem de arquivos que ja nao estao em integrando nao serve para nada
    foreach ($k in @($tentativas.Keys)) {
        if (-not (Test-Path -LiteralPath (Join-Path $integrando $k) -PathType Leaf)) { $tentativas.Remove($k); $mudouTentativas = $true }
    }

    foreach ($f in $fila) {
        $motivo = $null
        $rel = Get-Relative $f.FullName $integrando
        $r = Send-Log $f

        if ($r.Saida -eq 26) {
            # o curl nao conseguiu ler o arquivo: problema deste arquivo, nao do servidor
            $motivo = "curl nao conseguiu ler o arquivo ($($r.Erro))"
            $r.Http = 'leitura'
        } elseif ($r.Saida -ne 0 -or $r.Http -eq '000' -or $r.Http -eq '') {
            $motivoParada = "sem conexao com $($script:Url) (curl saiu com $($r.Saida), http $($r.Http)) $($r.Erro)".Trim()
            break
        }

        if ($r.Http -eq '401') {
            $motivoParada = 'token recusado (401): gere outro no site e troque GW2LOGS_KEY. O envio fica pausado ate o token mudar'
            try { [System.IO.File]::WriteAllText($arquivoTokenRecusado, $hashChave, $Utf8) } catch { Write-Log "Erro ao gravar token-recusado.txt: $($_.Exception.Message)" }
            break
        }
        if ($r.Http -eq '429') { $motivoParada = 'servidor bloqueou este IP por um tempo (429)'; break }

        $item = $null
        if ($r.Http -eq '200') {
            try { $item = Get-PrimeiroItem $r.Corpo } catch { $item = $null }
            if ($null -eq $item -or $null -eq $item.PSObject.Properties['file']) {
                $motivo = 'resposta 200 sem o resultado esperado: ' + $r.Corpo.Substring(0, [Math]::Min(200, $r.Corpo.Length))
                $item = $null
            }
        } elseif ($r.Http -ne 'leitura') {
            $motivo = "servidor respondeu HTTP $($r.Http)"
        }

        if ($null -ne $item) {
            $erro = Get-Prop $item 'error'
            $code = [string](Get-Prop $item 'code')
            if ([string]::IsNullOrEmpty([string]$erro)) {
                Move-Relative $f $integrando $integrado | Out-Null
                if ($tentativas.ContainsKey($rel)) { $tentativas.Remove($rel); $mudouTentativas = $true }
                if ((Get-Prop $item 'duplicate') -eq $true) {
                    $jaEnviados++
                    Write-Log "Ja enviado: $rel (id $(Get-Prop $item 'id'))"
                } else {
                    $enviados++
                    Write-Log "Enviado: $rel (id $(Get-Prop $item 'id'), $(Get-Prop $item 'status'))"
                }
                continue
            }
            if ($LimitesDoServidor -contains $code) {
                $motivoParada = "limite do servidor ($code): $(([string]$erro).TrimEnd('.'))"
                break
            }
            Move-Relative $f $integrando $pastaErro | Out-Null
            if ($tentativas.ContainsKey($rel)) { $tentativas.Remove($rel); $mudouTentativas = $true }
            $recusados++
            Write-Log "Recusado: $rel -> erro ($code`: $erro)"
            continue
        }

        # outro HTTP, 200 estranho ou arquivo ilegivel: conta tentativa deste arquivo
        $n = 1
        if ($tentativas.ContainsKey($rel)) { $n = $tentativas[$rel] + 1 }
        $mudouTentativas = $true
        if ($n -ge $maxTentativas) {
            Move-Relative $f $integrando $pastaErro | Out-Null
            $tentativas.Remove($rel)
            $recusados++
            Write-Log "Desisti de $rel depois de $n tentativas -> erro ($motivo)"
            continue
        }
        $tentativas[$rel] = $n
        $motivoParada = "$motivo para $rel (tentativa $n de $maxTentativas)"
        break
    }

    if ($mudouTentativas) {
        try { Save-Tentativas $arquivoTentativas $tentativas } catch { $falhas++; Write-Log "Erro ao gravar tentativas.json: $($_.Exception.Message)" }
    }

    $restantes = @(Get-Logs $integrando).Count
    if ($motivoParada) { Write-Log "Parado: $($motivoParada.TrimEnd('.')). Fica para a proxima execucao." }
    Write-Log ("Resumo: {0} movido(s) da origem, {1} enviado(s), {2} ja enviado(s), {3} recusado(s), {4} falha(s), {5} aguardando em integrando." -f $movidos, $enviados, $jaEnviados, $recusados, $falhas, $restantes)
    if ($motivoParada -or $falhas -gt 0) { exit 1 }
    exit 0
} catch {
    Write-Log "Erro inesperado: $($_.Exception.Message) (linha $($_.InvocationInfo.ScriptLineNumber))"
    exit 1
} finally {
    if ($temMutex) { try { $mutex.ReleaseMutex() } catch { } }
    $mutex.Dispose()
}
