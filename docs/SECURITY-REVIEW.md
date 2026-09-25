# Dependency review - 2026-09-25

The current release target is Windows x86_64. `pnpm audit --json` covered all 296 reported npm dependency entries, including
development dependencies, and returned no known advisories. The OSV query covered 574 resolved Rust packages across all platforms,
including build dependencies; see `rust-advisory-report.json`. A clean query is not
proof that a dependency or the embedded engine is free of vulnerabilities.

The Windows dependency tree still includes five unmaintained `rust-unic` crates:

- `unic-char-property` 0.9.0: RUSTSEC-2025-0081
- `unic-char-range` 0.9.0: RUSTSEC-2025-0075
- `unic-common` 0.9.0: RUSTSEC-2025-0080
- `unic-ucd-ident` 0.9.0: RUSTSEC-2025-0100
- `unic-ucd-version` 0.9.0: RUSTSEC-2025-0098

These are maintenance advisories. No patch has been applied or suppressed; reassess
them when upgrading Tauri and its transitive dependencies. The all-platform query
also reports `glib` 0.18.5 (RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g, soundness)
and `proc-macro-error` 1.0.4 (RUSTSEC-2024-0370, unmaintained). Neither appears in
the locked Windows target dependency tree; Linux release approval requires a
separate resolution and platform test.

The regenerated inventory conservatively lists 815 npm/Rust packages. Forty-nine
all-platform/build packages do not include standalone license files in their local
package directories. All 11 such crates in the Windows Rust dependency tree have
upstream license text in `resources/legal/UPSTREAM-LICENSE-SUPPLEMENTS.txt`.
`react-remove-scroll-bar` has its separate upstream license supplement. The
remaining all-platform entries still require reconciliation before extending the
release scope. MPL-2.0 source archives and their availability notice are bundled
under `resources/legal/sources`. FluxCode itself uses Apache-2.0; dependency terms
remain with their owners.

The embedded Codex binary is pinned by SHA-256 and carries its upstream license
and notice. This application's Cargo/npm scans do not audit every dependency
inside that binary; review upstream security notices when changing its version.
The runtime intentionally permits agent commands full host access. CSP and
scoped renderer APIs do not sandbox agent execution.

## Embedded browser boundary (2026-09-25)

The remote `restricted-browser` WebView shares the native window, not local IPC
permissions. Capabilities authorize only `main` and eight fixed local workspace
WebViews; the custom command dispatcher independently rejects remote child labels. HTTP(S) navigation excludes
credentials, internal Tauri/asset/IPC hosts and the configured development origin.
Popup links reuse the child; downloads require the system browser. Native tests
attempt settings, terminal and window-plugin commands from remote content and
verify rejection, including an HTTP redirect to an internal origin. This does not
claim that arbitrary remote content is harmless or sandbox the fully authorized
local agent. Browser browsing state is incognito and is not restored after closing.

## Embedded engine source-lock follow-up (2026-09-25)

An additional OSV lookup covered 1,338 third-party packages from the pinned
`rust-v0.156.1/codex-rs/Cargo.lock`, downloaded from the upstream tag. The input
SHA-256 and all findings are recorded in `embedded-engine-advisory-report.json`.
Twenty-seven package versions have one or more advisory matches, including
maintenance, memory/soundness and network/parser categories. These findings are
not suppressed or resolved by the successful local engine smoke tests.

This is an all-platform source-lock review, not a generated SBOM of the distributed
Windows executable. Optional/build/non-Windows dependencies may be present; Git
forks require revision-level review. Windows reachability and upstream upgrade
choices remain unresolved release work. No claim is made that all 27 packages
are exploitable in FluxCode, or that non-Cargo embedded assets were audited.
The app Cargo scan and the engine source-lock scan must not be conflated.
