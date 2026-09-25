param([string]$ProxyUrl)
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
$effectiveProxy = if ($ProxyUrl) { $ProxyUrl } elseif ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } else { $env:HTTP_PROXY }
$requestOptions = if ($effectiveProxy) { @{ Proxy = $effectiveProxy } } else { @{} }
$root = Split-Path -Parent $PSScriptRoot
$tag = 'rust-v0.156.1'
$engineDir = Join-Path $root 'src-tauri/resources/engine'
$legalDir = Join-Path $root 'src-tauri/resources/legal'
New-Item -ItemType Directory -Force -Path $engineDir, $legalDir | Out-Null
$destination = Join-Path $engineDir 'codex.exe'
$artifacts = @(
    @{ Asset = 'codex-x86_64-pc-windows-msvc.exe'; File = 'codex.exe'; Sha256 = '70bcb05f9bf1a4e7306edd0cd1b57d02af3267ad02a34b26f45c8c4bb20a3301' },
    @{ Asset = 'codex-code-mode-host-x86_64-pc-windows-msvc.exe'; File = 'codex-code-mode-host.exe'; Sha256 = '0f83a73dc6d511d43bd3e52cc0a999cb383c19c645ef3fbd8fbdaddde3088138' }
)
foreach ($artifact in $artifacts) {
    $target = Join-Path $engineDir $artifact.File
    if (!(Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $artifact.Sha256) {
        $temporary = "$target.download"
        try {
            Invoke-WebRequest -UseBasicParsing @requestOptions -Uri "https://github.com/openai/codex/releases/download/$tag/$($artifact.Asset)" -OutFile $temporary
            if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $artifact.Sha256) {
                throw "Engine checksum mismatch: $($artifact.File)"
            }
            Move-Item -LiteralPath $temporary -Destination $target -Force
        } finally {
            Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        }
    }
}
foreach ($legal in @(
    @{ Name = 'LICENSE'; Sha256 = 'd17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc' },
    @{ Name = 'NOTICE'; Sha256 = '9d71575ecfd9a843fc1677b0efb08053c6ba9fd686a0de1a6f5382fd3c220915' }
)) {
    $target = Join-Path $legalDir "CODEX-$($legal.Name).txt"
    if (!(Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $legal.Sha256) {
        $temporary = "$target.download"
        try {
            Invoke-WebRequest -UseBasicParsing @requestOptions -Uri "https://raw.githubusercontent.com/openai/codex/$tag/$($legal.Name)" -OutFile $temporary
            if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $legal.Sha256) {
                throw "Legal resource checksum mismatch: $($legal.Name)"
            }
            Move-Item -LiteralPath $temporary -Destination $target -Force
        } finally {
            Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        }
    }
}
$protocolDir = Join-Path $root 'src/generated/codex'
& $destination app-server generate-ts --experimental --out $protocolDir
if ($LASTEXITCODE -ne 0) { throw 'Protocol generation failed' }
& $destination --version
Write-Output "Verified bundled engine and code-mode host: $tag"
