$ErrorActionPreference='Stop'
$paperRoot=Split-Path $PSScriptRoot -Parent
Push-Location $paperRoot
try { & node --import tsx services/paper/server.mjs } finally { Pop-Location }
