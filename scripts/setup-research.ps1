param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$researchRoot = Split-Path $PSScriptRoot -Parent
$researchRepo = Join-Path (Split-Path $researchRoot -Parent) 'repo-review/TradingAgents_TauricResearch'
if (-not (Test-Path -LiteralPath $researchRepo)) { throw 'The reviewed TradingAgents checkout is missing. See services/research/README.md.' }
& $Python -m venv (Join-Path $researchRoot '.venv-research')
if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
$researchPython = Join-Path $researchRoot '.venv-research/Scripts/python.exe'
& $researchPython -m pip install -r (Join-Path $researchRoot 'services/research/requirements.lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install the research dependencies.' }
& $researchPython -m pip install -e $researchRepo
if ($LASTEXITCODE -ne 0) { throw 'Could not install the TradingAgents checkout.' }
& $researchPython (Join-Path $researchRoot 'services/research/bootstrap.py')
if ($LASTEXITCODE -ne 0) { throw 'Could not configure the local connection.' }
