<#
Instala (ou remove) o envio automatico dos logs do ArcDPS no Agendador de Tarefas do Windows.

Uso, num PowerShell aberto na pasta do projeto:
  powershell -ExecutionPolicy Bypass -File scripts\instalar-agendamento.ps1               (a cada 5 minutos)
  powershell -ExecutionPolicy Bypass -File scripts\instalar-agendamento.ps1 -Minutos 10
  powershell -ExecutionPolicy Bypass -File scripts\instalar-agendamento.ps1 -Desinstalar

O que faz:
  1. copia o monitorar-logs.ps1 para %LOCALAPPDATA%\gw2logs\ (e tira o bloqueio de arquivo baixado da internet);
  2. se nao existir %APPDATA%\gw2logs\config.bat, pede o endereco do site e o token e grava o arquivo, legivel so por voce;
  3. cria a tarefa "GW2 Logs - enviar logs do ArcDPS", repetida a cada -Minutos, sem fim.
     Como administrador a tarefa usa S4U: roda escondida e mesmo com voce deslogado, sem guardar senha.
     Sem administrador ela roda so com voce logado e pode piscar uma janela a cada execucao.
-Desinstalar remove a tarefa e o script copiado; a configuracao e as pastas de logs ficam.

Este arquivo precisa ficar so com ASCII e quebra de linha CRLF (o PowerShell 5.1 le .ps1 sem BOM como ANSI).
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 1440)]
    [int]$Minutos = 5,
    [switch]$Desinstalar
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$NomeTarefa = 'GW2 Logs - enviar logs do ArcDPS'
$PastaScript = Join-Path $env:LOCALAPPDATA 'gw2logs'
$ScriptInstalado = Join-Path $PastaScript 'monitorar-logs.ps1'
$PastaConfig = Join-Path $env:APPDATA 'gw2logs'
$ConfigBat = Join-Path $PastaConfig 'config.bat'

function Get-TarefaExistente {
    return Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- desinstalar
if ($Desinstalar) {
    if (Get-TarefaExistente) {
        Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false
        Write-Host "Tarefa removida: $NomeTarefa"
    } else {
        Write-Host "A tarefa '$NomeTarefa' nao estava instalada."
    }
    if (Test-Path -LiteralPath $ScriptInstalado) {
        Remove-Item -LiteralPath $ScriptInstalado -Force
        Write-Host "Script removido: $ScriptInstalado"
    }
    Write-Host ''
    Write-Host "Ficaram: a configuracao ($ConfigBat) e as pastas de logs (Documentos\GW2 Logs, com o monitor.log)."
    Write-Host 'Apague-as na mao se nao for mais usar.'
    exit 0
}

# ---------------------------------------------------------------- 1. copiar o monitor
$origemScript = Join-Path $PSScriptRoot 'monitorar-logs.ps1'
if (-not (Test-Path -LiteralPath $origemScript)) {
    Write-Error "Nao encontrei $origemScript. Rode este instalador de dentro da pasta scripts do projeto."
}
if (-not (Test-Path -LiteralPath $PastaScript)) { New-Item -ItemType Directory -Path $PastaScript -Force | Out-Null }
Copy-Item -LiteralPath $origemScript -Destination $ScriptInstalado -Force
Unblock-File -LiteralPath $ScriptInstalado
Write-Host "Script copiado para $ScriptInstalado"

# ---------------------------------------------------------------- 2. configuracao
if (Test-Path -LiteralPath $ConfigBat) {
    Write-Host "Configuracao ja existe: $ConfigBat (nao foi alterada)"
} else {
    Write-Host ''
    Write-Host 'Configuracao do envio. O token e gerado no site: Importar logs, cartao "Envio por script".'
    do {
        $url = (Read-Host 'Endereco do site (ex.: https://logs.exemplo.com)').Trim().TrimEnd('/')
        $urlOk = $url -match '^https?://[^\s"%&^|<>]+$'
        if (-not $urlOk) { Write-Host 'Endereco invalido: precisa comecar com http:// ou https:// e nao pode ter espacos nem " % & ^ | < >.' }
    } while (-not $urlOk)
    do {
        $seguro = Read-Host 'Token pessoal de envio (nao aparece na tela)' -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
        try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        # o config.bat tambem e executado pelo enviar-logs.bat: caracteres especiais do cmd quebrariam a linha
        $tokenOk = $token -match '^[A-Za-z0-9_\-\.~+/=]+$'
        if (-not $tokenOk) { Write-Host 'Token vazio ou com caracteres inesperados. Copie de novo do site.' }
    } while (-not $tokenOk)

    if (-not (Test-Path -LiteralPath $PastaConfig)) { New-Item -ItemType Directory -Path $PastaConfig -Force | Out-Null }
    # cria vazio, restringe o acesso ao usuario atual e so entao grava o token
    [System.IO.File]::WriteAllText($ConfigBat, '')
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $ConfigBat /inheritance:r /grant:r "*${sid}:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $ConfigBat -Force -ErrorAction SilentlyContinue
        Write-Error "icacls falhou (codigo $LASTEXITCODE) ao restringir $ConfigBat. Nada foi gravado."
    }
    $conteudo = "@echo off`r`nset GW2LOGS_URL=$url`r`nset GW2LOGS_KEY=$token`r`n"
    [System.IO.File]::WriteAllText($ConfigBat, $conteudo, (New-Object System.Text.ASCIIEncoding))
    $token = $null
    Write-Host "Configuracao gravada em $ConfigBat (acesso so para o seu usuario)"
}

# ---------------------------------------------------------------- 3. tarefa agendada
$identidade = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$admin = (New-Object System.Security.Principal.WindowsPrincipal($identidade)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)

$argumentos = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $ScriptInstalado
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumentos -WorkingDirectory $PastaScript

$gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minutos)
# duracao vazia = repetir sem fim (algumas versoes do Windows preenchem um valor quando ela e omitida)
if ($gatilho.Repetition.Duration) { $gatilho.Repetition.Duration = '' }

$config = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

if ($admin) {
    $principal = New-ScheduledTaskPrincipal -UserId $identidade.Name -LogonType S4U -RunLevel Limited
    $modo = 'S4U: roda escondida, mesmo com voce deslogado'
} else {
    $principal = New-ScheduledTaskPrincipal -UserId $identidade.Name -LogonType Interactive -RunLevel Limited
    $modo = 'Interactive: roda so com voce logado (para rodar deslogado e sem janela, rode este instalador como administrador)'
}

Register-ScheduledTask -TaskName $NomeTarefa -Action $acao -Trigger $gatilho -Settings $config -Principal $principal `
    -Description 'Envia os logs do ArcDPS para o site (gw2-clan-logs, scripts\monitorar-logs.ps1).' -Force | Out-Null

# onde fica o monitor.log: GW2LOGS_PASTA do config.bat ou do ambiente, senao Documentos\GW2 Logs
$pastaLogs = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'GW2 Logs'
if ($env:GW2LOGS_PASTA) { $pastaLogs = $env:GW2LOGS_PASTA }
elseif (Test-Path -LiteralPath $ConfigBat) {
    foreach ($l in Get-Content -LiteralPath $ConfigBat) {
        if ($l.Trim() -match '^(?i)set\s+"?GW2LOGS_PASTA=([^"]*)"?$') { $pastaLogs = $Matches[1].Trim() }
    }
}

Write-Host ''
Write-Host "Tarefa criada: $NomeTarefa"
Write-Host "  a cada $Minutos minuto(s), comecando em 1 minuto; modo $modo"
Write-Host ''
Write-Host 'Para testar agora:'
Write-Host "  Start-ScheduledTask -TaskName '$NomeTarefa'"
Write-Host "  Get-Content '$(Join-Path $pastaLogs 'monitor.log')' -Tail 20"
Write-Host ''
Write-Host 'Os logs saem da pasta do ArcDPS e passam por GW2 Logs\integrando -> integrado (ou erro).'
Write-Host 'Para remover: powershell -ExecutionPolicy Bypass -File scripts\instalar-agendamento.ps1 -Desinstalar'
