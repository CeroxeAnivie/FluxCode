param([string]$ProxyUrl = 'http://127.0.0.1:14455/')
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$env:HTTP_PROXY = $ProxyUrl
$env:HTTPS_PROXY = $ProxyUrl
$env:ALL_PROXY = $ProxyUrl
$root = Split-Path -Parent $PSScriptRoot
$tag = 'rust-v0.156.1'
$assetName = 'codex-x86_64-pc-windows-msvc.exe'
$expectedHash = '70bcb05f9bf1a4e7306edd0cd1b57d02af3267ad02a34b26f45c8c4bb20a3301'
$engineDir = Join-Path $root 'src-tauri/resources/engine'
$legalDir = Join-Path $root 'src-tauri/resources/legal'
New-Item -ItemType Directory -Force -Path $engineDir, $legalDir | Out-Null
$destination = Join-Path $engineDir 'codex.exe'
if (!(Test-Path -LiteralPath $destination) -or (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
    Invoke-WebRequest -UseBasicParsing -Proxy $ProxyUrl -Uri "https://github.com/openai/codex/releases/download/$tag/$assetName" -OutFile "$destination.download"
    if ((Get-FileHash -LiteralPath "$destination.download" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Engine checksum mismatch' }
    Move-Item -LiteralPath "$destination.download" -Destination $destination -Force
}
foreach ($name in @('LICENSE', 'NOTICE')) {
    $r = Invoke-WebRequest -UseBasicParsing -Proxy $ProxyUrl -Uri "https://raw.githubusercontent.com/openai/codex/$tag/$name"
    [System.IO.File]::WriteAllText((Join-Path $legalDir "CODEX-$name.txt"), [string]$r.Content, $utf8)
}
$protocolDir = Join-Path $root 'src/generated/codex'
& $destination app-server generate-ts --experimental --out $protocolDir
if ($LASTEXITCODE -ne 0) { throw 'Protocol generation failed' }
& $destination --version
Write-Output "Verified bundled engine: $tag ($expectedHash)"
