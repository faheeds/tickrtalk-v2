$ErrorActionPreference = 'Stop'
$researchRoot = Split-Path $PSScriptRoot -Parent
$researchPython = Join-Path $researchRoot '.venv-research/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $researchPython)) { throw 'Run setup-research.ps1 first.' }
& $researchPython (Join-Path $researchRoot 'services/research/server.py')
