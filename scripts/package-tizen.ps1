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

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open(
  $resolvedOutput,
  [System.IO.Compression.ZipArchiveMode]::Create
)

try {
  Get-ChildItem -LiteralPath $distPath -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
      $entryName = $_.FullName.Substring($distPath.Length).TrimStart('\', '/').Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $_.FullName,
        $entryName,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
}
finally {
  $archive.Dispose()
}

$verificationArchive = [System.IO.Compression.ZipFile]::OpenRead($resolvedOutput)
try {
  $invalidEntries = @($verificationArchive.Entries | Where-Object { $_.FullName.Contains('\') })
  if ($invalidEntries.Count -gt 0) {
    throw "Widget contains invalid Windows-style entry paths: $($invalidEntries.FullName -join ', ')"
  }
}
finally {
  $verificationArchive.Dispose()
}

Write-Output "Created $resolvedOutput"
