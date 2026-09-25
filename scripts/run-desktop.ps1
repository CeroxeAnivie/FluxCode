param([switch]$NoBuild)
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $env:CARGO_HOME = Join-Path $projectRoot '.toolchains/cargo'
    $env:RUSTUP_HOME = Join-Path $projectRoot '.toolchains/rustup'
    $env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
    if (-not $NoBuild) {
        pnpm tauri build --debug --no-bundle
        if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
    }
    $desktopBinary = Join-Path $projectRoot 'src-tauri/target/debug/fluxcode.exe'
    if (-not (Test-Path -LiteralPath $desktopBinary -PathType Leaf)) {
        throw 'No desktop build found. Run pnpm desktop:run without -NoBuild first.'
    }
    # Development must not import or modify the installed application's records.
    $env:FLUXCODE_TEST_DATA_DIR = Join-Path $projectRoot 'src-tauri/target/debug/data'
    # The host assigns an independent profile to each workspace window.
    Remove-Item -LiteralPath Env:WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
    & $desktopBinary
    if ($LASTEXITCODE -ne 0) { throw "FluxCode exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}
