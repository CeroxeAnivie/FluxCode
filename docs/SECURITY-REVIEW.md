# Dependency review — 2026-09-24

The production npm dependency audit returned zero advisories across 109 dependencies.
OSV queried 279 resolved Rust packages for the Windows target, including build
dependencies. Five notices concern unmaintained `rust-unic` crates:

- unic-char-property 0.9.0: RUSTSEC-2025-0081
- unic-char-range 0.9.0: RUSTSEC-2025-0075
- unic-common 0.9.0: RUSTSEC-2025-0080
- unic-ucd-ident 0.9.0: RUSTSEC-2025-0100
- unic-ucd-version 0.9.0: RUSTSEC-2025-0098

These are maintenance advisories, not a finding that the release has zero security
risk. They remain visible in `rust-advisory-report.json`; none are suppressed.
They arrive through upstream dependencies and need reassessment on Tauri upgrades.
The runtime intentionally permits agent commands full host access. CSP and scoped
preview APIs isolate the renderer; they do not sandbox agent execution.

Third-party notices cover 387 npm/Rust entries conservatively. Some transitive
dependencies use MPL-2.0; their corresponding unmodified source archives and source
availability notice are included under `resources/legal/sources`. FluxCode's own
code uses Apache-2.0. Dependency licenses are not replaced by the project license.

The embedded Codex binary is verified against GitHub release SHA-256. Its complete
transitive binary dependency security review is not established by the wrapper's
Cargo/npm audits; review upstream security notices when changing the engine pin.
