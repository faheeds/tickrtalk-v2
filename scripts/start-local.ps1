param([switch]$ServiceLauncher)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
if (-not $ServiceLauncher) {
  # WMI creates the launcher outside the calling terminal's process job.
  # This prevents a temporary terminal session from taking the workers down.
  $hostExe = (Get-Command pwsh).Source
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[UInt16]0}
  $commandLine = '"' + $hostExe + '" -NoProfile -WindowStyle Hidden -File "' + $PSCommandPath + '" -ServiceLauncher'
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$commandLine;CurrentDirectory=$appRoot;ProcessStartupInformation=$startup}
  if ($result.ReturnValue -ne 0) { throw ('Independent launcher could not start: ' + $result.ReturnValue) }
  Write-Output 'TickrTalk services are starting independently. Open http://127.0.0.1:4173/preview/algo'
  return
}
$logRoot = Join-Path $appRoot '.local-run'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
function Test-LocalPort([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $pending = $client.ConnectAsync('127.0.0.1', $Port); return ($pending.Wait(250) -and $client.Connected) }
  catch { return $false }
  finally { $client.Dispose() }
}
function Start-LocalService($Name, $Executable, $Arguments, [int]$Port) {
  if (Test-LocalPort $Port) {
    if ($Name -eq 'website') {
      $page = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/preview/algo" -UseBasicParsing -TimeoutSec 8
      if ($page.Content -notmatch '<title>TickrTalk') { throw "Port $Port belongs to another app. TickrTalk has not replaced it." }
    }
    Write-Output "$Name already listening on $Port"
    return
  }
  $serviceProcess = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot "$Name.out.log") -RedirectStandardError (Join-Path $logRoot "$Name.err.log") -PassThru
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-LocalPort $Port) { Write-Output "$Name started on $Port"; return }
    if ($serviceProcess.HasExited) { throw "$Name stopped. See its private logs in .local-run." }
  }
  throw "$Name did not start within ten seconds. See .local-run."
}
$nodePath = (Get-Command node).Source
if (Test-Path -LiteralPath (Join-Path $appRoot '.paper-data/cloud-cutover.json')) {
  Write-Output 'Paper execution has moved to Vercel. The local paper worker will not start.'
} else {
  Start-LocalService 'paper' $nodePath 'services/paper/server.mjs' 8003
}
$researchPython = Join-Path $appRoot '.venv-research/Scripts/python.exe'
if (Test-Path -LiteralPath $researchPython) { Start-LocalService 'research' $researchPython 'services/research/server.py' 8001 }
$env:NEXT_BUILD_DIR = '.next-paper'
if (-not (Test-Path -LiteralPath (Join-Path $appRoot '.next-paper/BUILD_ID'))) { throw 'Build the local website before starting it.' }
Start-LocalService 'website' $nodePath 'node_modules/next/dist/bin/next start -p 4173 -H 127.0.0.1' 4173
Write-Output 'TickrTalk: http://127.0.0.1:4173/preview/algo'
