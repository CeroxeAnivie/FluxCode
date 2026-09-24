$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$proxy = 'http://127.0.0.1:14455/'
$headers = @{ 'User-Agent' = 'FluxCode-license-audit' }
$missing = Get-Content -LiteralPath work/missing-license-files.json -Raw -Encoding UTF8 | ConvertFrom-Json
$metadata = Get-Content -LiteralPath work/rust-metadata.json -Raw -Encoding UTF8 | ConvertFrom-Json
$cache = @{}
$text = [System.Text.StringBuilder]::new()
foreach ($entry in $missing) {
    $package = $metadata.packages | Where-Object { $_.name -eq $entry.name -and $_.version -eq $entry.version } | Select-Object -First 1
    $vcs = Get-Content -LiteralPath (Join-Path $entry.directory '.cargo_vcs_info.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $repository = $package.repository.TrimEnd('/') -replace '\.git$', ''
    $slug = $repository -replace '^https://github.com/', ''
    $key = "$slug/$($vcs.git.sha1)"
    if (!$cache.ContainsKey($key)) {
        $tree = Invoke-RestMethod -Proxy $proxy -Headers $headers -Uri "https://api.github.com/repos/$slug/git/trees/$($vcs.git.sha1)?recursive=1"
        $files = @($tree.tree | Where-Object { $_.type -eq 'blob' -and $_.path -match '(^|/)(LICENSE[^/]*|COPYING[^/]*)$' })
        $minDepth = ($files | ForEach-Object { ($_.path -split '/').Length } | Measure-Object -Minimum).Minimum
        $files = @($files | Where-Object { ($_.path -split '/').Length -eq $minDepth })
        if ($files.Count -eq 0) { throw "No upstream license found for $key" }
        $licenseText = [System.Text.StringBuilder]::new()
        foreach ($file in $files) {
            $url = "https://raw.githubusercontent.com/$slug/$($vcs.git.sha1)/$($file.path)"
            $response = Invoke-WebRequest -UseBasicParsing -Proxy $proxy -Uri $url
            [void]$licenseText.AppendLine("Source: $url")
            [void]$licenseText.AppendLine([string]$response.Content)
        }
        $cache[$key] = $licenseText.ToString()
    }
    [void]$text.AppendLine("`n=======================================================================")
    [void]$text.AppendLine("$($entry.name) $($entry.version) - $($entry.license)")
    [void]$text.AppendLine($cache[$key])
}
$legal = Join-Path $root 'src-tauri/resources/legal'
[System.IO.File]::WriteAllText((Join-Path $legal 'UPSTREAM-LICENSE-SUPPLEMENTS.txt'), $text.ToString(), $utf8)
$sourceDir = Join-Path $legal 'sources'
New-Item -ItemType Directory -Force -Path $sourceDir | Out-Null
$sourceNotice = [System.Text.StringBuilder]::new()
[void]$sourceNotice.AppendLine('MPL-2.0 components: corresponding unmodified source archives are included in legal/sources/.')
foreach ($package in ($metadata.packages | Where-Object { $_.license -eq 'MPL-2.0' })) {
    $archiveName = "$($package.name)-$($package.version).crate"
    $archive = Get-ChildItem -LiteralPath '.toolchains/cargo/registry/cache' -Recurse -File -Filter $archiveName | Select-Object -First 1
    if (!$archive) { throw "Missing corresponding source: $archiveName" }
    Copy-Item -LiteralPath $archive.FullName -Destination (Join-Path $sourceDir $archiveName)
    [void]$sourceNotice.AppendLine("$($package.name) $($package.version): $($package.repository) | sources/$archiveName")
}
[System.IO.File]::WriteAllText((Join-Path $legal 'SOURCE-AVAILABILITY.txt'), $sourceNotice.ToString(), $utf8)
Write-Output "Supplemented $($missing.Count) license notices; included MPL source archives."
