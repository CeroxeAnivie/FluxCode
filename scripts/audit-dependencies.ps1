param([string]$ProxyUrl, [switch]$WindowsOnly)
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$effectiveProxy = if ($ProxyUrl) { $ProxyUrl } elseif ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } else { $env:HTTP_PROXY }
$requestOptions = if ($effectiveProxy) { @{ Proxy = $effectiveProxy } } else { @{} }
$metadataText = & cargo metadata --manifest-path src-tauri/Cargo.toml --locked --format-version 1
if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve current dependency metadata.' }
$metadata = ($metadataText -join "`n") | ConvertFrom-Json
[System.IO.File]::WriteAllText((Join-Path $root 'work/rust-metadata.json'), ($metadataText -join "`n"), $utf8)
# Include patched path dependencies; a local source must not disappear from audits.
$packages = @($metadata.packages | Where-Object { $_.id -ne $metadata.resolve.root })
if ($WindowsOnly) {
    $tree = & cargo tree --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --edges normal,build --prefix none --format '{p}'
    if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve Windows dependencies.' }
    $reachable = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($line in $tree) {
        if ($line -match '^(\S+) v([^\s]+)') { [void]$reachable.Add("$($Matches[1])@$($Matches[2])") }
    }
    $packages = @($packages | Where-Object { $reachable.Contains("$($_.name)@$($_.version)") })
}
$findings = @()
for ($i = 0; $i -lt $packages.Count; $i += 100) {
    $batch = @($packages | Select-Object -Skip $i -First 100)
    $queries = @($batch | ForEach-Object { @{ package = @{ name = $_.name; ecosystem = 'crates.io' }; version = $_.version } })
    $body = @{ queries = $queries } | ConvertTo-Json -Depth 8 -Compress
    $result = Invoke-RestMethod -Method Post @requestOptions -Uri 'https://api.osv.dev/v1/querybatch' -ContentType 'application/json' -Body $body
    for ($j = 0; $j -lt $batch.Count; $j++) {
        if ($result.results[$j].vulns) { $findings += @{ name = $batch[$j].name; version = $batch[$j].version; advisories = @($result.results[$j].vulns.id) } }
    }
}
$scope = if ($WindowsOnly) { 'Windows x86_64 normal and build dependencies, including local patches' } else { 'All platforms, including local patches' }
$report = @{ checkedAt = [DateTime]::UtcNow.ToString('o'); source = 'OSV'; ecosystem = 'crates.io'; scope = $scope; packageCount = $packages.Count; findings = $findings }
$output = if ($WindowsOnly) { 'docs/windows-rust-advisory-report.json' } else { 'docs/rust-advisory-report.json' }
[System.IO.File]::WriteAllText((Join-Path $root $output), ($report | ConvertTo-Json -Depth 8), $utf8)
$report | ConvertTo-Json -Depth 8
