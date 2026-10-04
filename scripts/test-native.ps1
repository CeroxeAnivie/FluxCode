param([Parameter(ValueFromRemainingArguments = $true)][string[]]$TestArguments)
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$root = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $root 'src-tauri/Cargo.toml'
# Tauri embeds Common Controls v6 in application binaries, but not lib test
# executables. Native dialog tests need the same activation manifest at load time.
$artifacts = & cargo test --manifest-path $manifest --locked --features tauri/custom-protocol --all-targets --no-run --message-format=json-render-diagnostics
if ($LASTEXITCODE -ne 0) { throw 'Native test compilation failed.' }
$tests = @($artifacts | ForEach-Object {
    $entry = $_ | ConvertFrom-Json
    if ($entry.reason -eq 'compiler-artifact' -and $entry.profile.test -and $entry.executable) { $entry.executable }
})
if (!$tests.Count) { throw 'No native test executable was produced.' }
$kits = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots').KitsRoot10
$tool = Get-ChildItem -LiteralPath (Join-Path $kits 'bin') -Directory | Sort-Object Name -Descending | ForEach-Object {
    $candidate = Join-Path $_.FullName 'x64/mt.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $candidate }
} | Select-Object -First 1
if (!$tool) { throw 'Windows SDK manifest tool mt.exe is required for native tests.' }
foreach ($test in $tests) {
    & $tool '-nologo' '-manifest' (Join-Path $root 'src-tauri/windows-app.manifest') "-outputresource:$test;#1"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to embed the application manifest in native tests.' }
    & $test @TestArguments
    if ($LASTEXITCODE -ne 0) { throw "Native tests failed: $LASTEXITCODE" }
}
