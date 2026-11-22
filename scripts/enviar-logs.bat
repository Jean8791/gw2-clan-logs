@echo off
rem Envia logs do ArcDPS (.zevtc, .evtc) ou o .json do Elite Insights para o site, pela API. Versao do enviar-logs.sh para Windows.
rem Uso: enviar-logs.bat "arquivo ou pasta" ["mais arquivos ou pastas"...]
rem
rem Alternativa automatica: scripts\instalar-agendamento.ps1 instala o monitorar-logs.ps1 no Agendador de Tarefas, que envia
rem sozinho a cada 5 minutos, so os logs novos (eles saem da pasta do ArcDPS). Veja "Envio automatico no Windows" no README.
rem
rem Exemplo (a pasta padrao do ArcDPS):
rem   enviar-logs.bat "%USERPROFILE%\Documents\Guild Wars 2\addons\arcdps\arcdps.cbtlogs"
rem
rem Configuracao: variaveis de ambiente ou o arquivo %APPDATA%\gw2logs\config.bat, com duas linhas:
rem   set GW2LOGS_URL=https://endereco-do-site
rem   set GW2LOGS_KEY=seu-token
rem O config.bat e executado como script: so ponha nele as duas linhas acima.
rem O token e gerado no site (Importar logs, "Envio por script"). Quem tem o token envia logs no seu nome: trate como senha.
rem
rem Nao guarda registro do que ja enviou: o servidor apaga os logs depois de um tempo e o que sumiu pode ser enviado de novo. O que ainda esta guardado la e ignorado e conta como "ja enviado". Precisa do curl.exe (ja vem no Windows 10 e 11).
setlocal EnableExtensions
chcp 65001 >nul

if "%~1"=="" (
  echo Uso: %~nx0 "arquivo ou pasta" ["mais arquivos ou pastas"...]
  exit /b 2
)
where curl.exe >nul 2>&1
if errorlevel 1 (
  echo enviar-logs: curl.exe nao encontrado. Ele vem no Windows 10 e 11.
  exit /b 2
)

rem variavel de ambiente vale mais que o arquivo de configuracao
set "ENV_URL=%GW2LOGS_URL%"
set "ENV_KEY=%GW2LOGS_KEY%"
if exist "%APPDATA%\gw2logs\config.bat" call "%APPDATA%\gw2logs\config.bat"
if defined ENV_URL set "GW2LOGS_URL=%ENV_URL%"
if defined ENV_KEY set "GW2LOGS_KEY=%ENV_KEY%"
if not defined GW2LOGS_URL goto semconfig
if not defined GW2LOGS_KEY goto semconfig
if "%GW2LOGS_URL:~-1%"=="/" set "GW2LOGS_URL=%GW2LOGS_URL:~0,-1%"

rem o token vai ao curl por um arquivo temporario seu, nunca na linha de comando; ele existe so durante cada envio (Ctrl+C no meio de um envio e a unica chance de sobrar um)
set "CFG=%TEMP%\gw2logs-%RANDOM%.cfg"
set "RESP=%TEMP%\gw2logs-%RANDOM%.resp"
set "CODE=%TEMP%\gw2logs-%RANDOM%.code"

set SENT=0
set KNOWN=0
set FAILED=0
set "STOP="

:proximo
if "%~1"=="" goto fim
if exist "%~1\" (
  for /r "%~1" %%f in (*.zevtc *.evtc *.json) do call :enviar "%%f"
) else if exist "%~1" (
  call :enviar "%~1"
) else (
  echo enviar-logs: nao encontrei %~1
)
shift
goto proximo

:enviar
if defined STOP exit /b 0
set "TRY=0"
set "CAMINHO=%~f1"
set "CAMINHO=%CAMINHO:\=/%"

:tentar
set "HTTP="
del "%RESP%" "%CODE%" >nul 2>&1
>"%CFG%" echo header = "X-Upload-Key: %GW2LOGS_KEY%"
curl.exe -sS -m 900 --config "%CFG%" -o "%RESP%" -w "%%{http_code}" -F "file=@\"%CAMINHO%\"" "%GW2LOGS_URL%/api/upload" >"%CODE%" 2>nul
del "%CFG%" >nul 2>&1
if exist "%CODE%" set /p HTTP=<"%CODE%"
if not defined HTTP goto semrede
if "%HTTP%"=="401" goto semtoken
if "%HTTP%"=="429" goto bloqueado
if not "%HTTP%"=="200" goto erroservidor

findstr /r /c:"code.:.queueFull" "%RESP%" >nul 2>&1
if errorlevel 1 goto semfila
if %TRY% geq 10 goto limite
set /a TRY+=1
echo Fila do servidor cheia, esperando 60 segundos. Tentativa %TRY% de 10.
timeout /t 60 /nobreak >nul
goto tentar

:semfila
findstr /r /c:"code.:.hourlyLimit" /c:"code.:.diskFull" "%RESP%" >nul 2>&1
if not errorlevel 1 goto limite
findstr /r /c:"error.:." "%RESP%" >nul 2>&1
if not errorlevel 1 goto recusado
findstr /r /c:"duplicate.:true" "%RESP%" >nul 2>&1
if not errorlevel 1 goto jaenviado
set /a SENT+=1
echo Enviado: %~f1
exit /b 0

:jaenviado
set /a KNOWN+=1
exit /b 0

:recusado
echo enviar-logs: o servidor recusou %~f1. Resposta:
type "%RESP%"
echo.
set /a FAILED+=1
exit /b 1

:erroservidor
echo enviar-logs: o servidor respondeu %HTTP% para %~f1.
set /a FAILED+=1
exit /b 1

:semrede
echo enviar-logs: nao consegui falar com %GW2LOGS_URL% (rede ou endereco errado).
set "STOP=1"
exit /b 1

:semtoken
echo enviar-logs: token de envio incorreto. Gere outro no site e confira GW2LOGS_KEY.
set "STOP=1"
exit /b 1

:bloqueado
echo enviar-logs: erros demais seguidos, este IP foi bloqueado por um tempo. Tente de novo mais tarde.
set "STOP=1"
exit /b 1

:limite
echo enviar-logs: limite do servidor atingido (fila cheia, limite por hora ou disco). Rode de novo mais tarde.
set "STOP=1"
exit /b 1

:semconfig
echo enviar-logs: defina GW2LOGS_URL e GW2LOGS_KEY (variaveis de ambiente ou %APPDATA%\gw2logs\config.bat). Veja o cabecalho deste arquivo.
exit /b 2

:fim
del "%CFG%" "%RESP%" "%CODE%" >nul 2>&1
echo Resumo: %SENT% enviado(s), %KNOWN% ja enviado(s), %FAILED% com erro.
if defined STOP exit /b 1
if %FAILED% gtr 0 exit /b 1
exit /b 0
