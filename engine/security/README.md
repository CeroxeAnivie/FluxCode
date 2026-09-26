# Windows engine security build

This directory records the Codex rust-v0.157.0 source build bundled by FluxCode.
Its binaries passed the engine tool, code-mode, reasoning and compaction contracts
before installation. `config/engine-release.toml` records their exact hashes.
Preparing source alone does not replace an existing installation's engine.

## Reproduction

Use Python 3.12+, Git, the pinned Rust toolchain, and Visual Studio C++ build
tools. Configure network proxy environment variables before invoking the build
where required by your environment; no machine-specific proxy is committed.

```powershell
python scripts/build-secure-engine.py --prepare-only
python scripts/build-secure-engine.py
```

The preparation checks the upstream source archive and original crate archives
against SHA-256 values in `manifest.toml`, applies `dependency-fixes.patch`, and
installs the reviewed `Cargo.lock`. Build with the upstream Windows static CRT
settings and Codex's sandbox-enabled V8 artifacts. Those artifacts are verified
through the checksum manifest in the pinned upstream source. Do not substitute
the standard Deno Windows V8 archive or disable its sandbox.

The build defaults to the machine's available logical CPUs; use `--jobs` to set
an explicit concurrency limit when memory is constrained. It retains release
optimization, ThinLTO, static CRT and sandbox settings. The initial build is
expensive; keep the target directory for later rebuilds. A differently
stamped source directory is rejected instead of silently reusing stale patches.

The release binaries can be downloaded with `scripts/prepare-engine.ps1`; ordinary
FluxCode UI/host development does not rebuild Codex. Rebuilding from source is
needed when changing the engine patches, dependencies or compiler configuration.
Independent builds are not promised to be bit-for-bit identical: review and pin
their actual digests before distribution. Do not bypass a release checksum failure.

The reviewed Windows pair was built with Rust 1.98.1, static CRT, release
optimization and sandbox-enabled V8. The final cached build took 26m26s at 24 jobs
on a 24-core/32 GiB machine; this is not the time for a clean build. Peak memory
pressure and low-parallelism final phases limit the benefit of increasing jobs.

License collection tools are `collect-engine-licenses.py` (Cargo graph and MPL
sources), `collect-engine-license-supplements.py` (upstream repository notices),
`collect-engine-metadata-licenses.py` (standard terms plus publisher attribution
where standalone files are absent), and `collect-native-engine-licenses.py`
(pinned V8 native dependencies). They write the bundled `ENGINE-*` legal files.
README-only evidence is explicitly identified, never counted as a license text.

## Changes and provenance

- Update gix, jsonwebtoken (AWS-LC provider), tar and serde_with requirements,
  and pin the reviewed transitive dependency resolutions in Cargo.lock.
- Backport Hickory compression limits from upstream commits
  `f87f50c4ca90f432f07c8e27b4b93816bbaa8740` and
  `b81a8d62fc2ed07188d29ddaed983fbb28b69e09`: at most 64 pointer entries
  and 120 compressed names. Preserve canonical-name pointer registration.
  Add a bounded exit for unrelated DNSSEC SOA/query names; DNSSEC is not enabled
  in the selected Windows engine features.
- Backport OpenTelemetry baggage limits from upstream commit
  `a389ca6b3e416416bc8fc9b01cf6076b9182ed14`: reject headers larger than
  8,192 bytes before allocation and inspect at most 64 member entries.
- Increase the chatgpt crate recursion limit to 256 for the pinned Rust 1.98.1
  compiler. No runtime agent behavior is changed by that build setting.

Source archive licenses remain authoritative. The backports retain the original
crate licenses. The application URLPattern backport is separate and documented
under `src-tauri/vendor/urlpattern/FLUXCODE-PATCH.md`.

## Review scope

`docs/patched-engine-advisory-report.json` records 1,012 Windows normal/build
package versions. This is a source dependency graph, not a binary SBOM.
Version-based matches for Hickory and OpenTelemetry remain visible because the
backports deliberately retain the compatible crate versions. Patch regression
checks passed: two DNS bounds tests, 22 binary serialization tests and six baggage
tests. The canonical compression regression is covered by upstream's existing
target-compression test.

Five upstream maintenance advisories remain: bincode 1.3.3, derivative 2.2.0,
fxhash 0.2.1, paste 1.0.15 and proc-macro-error2 2.0.1. They have not been
suppressed or described as fixed. Replacing them requires upstream format/macro
compatibility work; a successful binary build does not resolve these notices.
