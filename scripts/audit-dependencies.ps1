$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$metadata = Get-Content -LiteralPath work/rust-metadata.json -Raw -Encoding UTF8 | ConvertFrom-Json
$packages = @($metadata.packages | Where-Object { $_.source })
$findings = @()
for ($i = 0; $i -lt $packages.Count; $i += 100) {
    $batch = @($packages | Select-Object -Skip $i -First 100)
    $queries = @($batch | ForEach-Object { @{ package = @{ name = $_.name; ecosystem = 'crates.io' }; version = $_.version } })
    $body = @{ queries = $queries } | ConvertTo-Json -Depth 8 -Compress
    $result = Invoke-RestMethod -Method Post -Proxy 'http://127.0.0.1:14455/' -Uri 'https://api.osv.dev/v1/querybatch' -ContentType 'application/json' -Body $body
    for ($j = 0; $j -lt $batch.Count; $j++) {
        if ($result.results[$j].vulns) { $findings += @{ name = $batch[$j].name; version = $batch[$j].version; advisories = @($result.results[$j].vulns.id) } }
    }
}
$report = @{ checkedAt = [DateTime]::UtcNow.ToString('o'); source = 'OSV'; ecosystem = 'crates.io'; packageCount = $packages.Count; findings = $findings }
[System.IO.File]::WriteAllText((Join-Path $root 'docs/rust-advisory-report.json'), ($report | ConvertTo-Json -Depth 8), $utf8)
$report | ConvertTo-Json -Depth 8
