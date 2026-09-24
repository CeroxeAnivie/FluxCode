param([ValidateSet('dev', 'build', 'check', 'test', 'fmt', 'clippy')][string]$Task = 'dev')
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:HTTP_PROXY = 'http://127.0.0.1:14455/'
$env:HTTPS_PROXY = $env:HTTP_PROXY
$env:ALL_PROXY = $env:HTTP_PROXY
$env:npm_config_proxy = $env:HTTP_PROXY
$env:npm_config_https_proxy = $env:HTTP_PROXY
if (Test-Path -LiteralPath "$root/.toolchains/cargo/bin") {
    $env:CARGO_HOME = "$root/.toolchains/cargo"
    $env:RUSTUP_HOME = "$root/.toolchains/rustup"
    $env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
}
switch ($Task) {
    'dev' { pnpm desktop:dev }
    'build' { pnpm desktop:build }
    'check' { cargo check --manifest-path src-tauri/Cargo.toml }
    'test' { cargo test --manifest-path src-tauri/Cargo.toml }
    'fmt' { cargo fmt --manifest-path src-tauri/Cargo.toml }
    'clippy' { cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings }
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
