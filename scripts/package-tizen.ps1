[CmdletBinding()]
param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $projectRoot 'dist'
$artifactsPath = Join-Path $projectRoot 'artifacts'

if (-not (Test-Path -LiteralPath (Join-Path $distPath 'config.xml'))) {
  throw 'dist/config.xml is missing. Run npm run build before packaging.'
}

if (-not $OutputPath) {
  $OutputPath = Join-Path $artifactsPath 'izumi-companion.wgt'
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedOutput) -Force | Out-Null
if (Test-Path -LiteralPath $resolvedOutput) {
  Remove-Item -LiteralPath $resolvedOutput -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $distPath,
  $resolvedOutput,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

Write-Output "Created $resolvedOutput"
