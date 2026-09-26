param([string]$ProxyUrl, [string]$ArtifactDirectory)
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
if ($ProxyUrl) {
    $env:HTTP_PROXY = $ProxyUrl
    $env:HTTPS_PROXY = $ProxyUrl
    $env:ALL_PROXY = $ProxyUrl
}
$arguments = @((Join-Path $PSScriptRoot 'prepare-engine.py'))
if ($ArtifactDirectory) { $arguments += @('--artifact-directory', $ArtifactDirectory) }
& python @arguments
if ($LASTEXITCODE -ne 0) { throw 'Engine resource preparation failed' }
