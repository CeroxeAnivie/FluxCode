# Verification — 2026-09-24

## Passed

- TypeScript strict typecheck and Vite production build.
- 18 frontend domain/persistence tests.
- 12 Rust configuration, policy, filesystem and instruction-ownership tests.
- 6 Playwright workflow tests: layout/files/diffs/terminal, task streaming and
  restore, cancellation/failure draft retention, minimum-size layout/settings.
- Real bundled Codex 0.156.1 smoke test: initialize, full-access policy, native
  exec_command call, actual file creation, tool result fed back to a local mock
  Responses service, streamed final response, resume, terminal success/failure,
  and archive. No production API is called.
- Real Tauri/WebView2 native integration: GUI → Rust IPC → bundled engine → local
  Responses service, streaming, terminal, OS credential save/delete, TOML persistence,
  user/environment file separation, reload/resume and application shutdown.
- Real Responses wire contract: known/custom models, Off, none, minimal, low, medium, high, xhigh and max; clearing a prior effort is verified.
- Native GUI verifies Off → High → reload/resume → Off; UI checks cover remembered selections, locked running controls and 18px typography at a 960px window.
- Rust Clippy `--all-targets -- -D warnings` and Prettier checks.
- Strict UTF-8 decoding of project text files, including generated bindings;
  Chinese content reread successfully with no U+FFFD replacement characters.
- Windows x86_64 optimized build and NSIS installer generation.
- Installer resource manifest verified: bundled engine, Apache LICENSE/NOTICE,
  third-party notices, supplemental license texts and MPL source archives.
- Production JavaScript verified to exclude test transport and fixture models.
- Embedded engine SHA-256 verified against pinned GitHub release.

## Package

`FluxCode_0.1.0_x64-setup.exe` — 75,917,579 bytes.

SHA-256: `6b3f1e55a460e6b3432d068c9351ceb03c8ee33d7b03f0a8b60e13f07df75b24`

## Limits and remaining release work

The installer is unsigned. Clean-machine install/upgrade/uninstall acceptance and
real-provider/API-account acceptance have not been performed. macOS/Linux packages
have not been built or verified. The terminal panel is for bounded commands, not
interactive TUI programs. File previews are read-only. Unsupported interactive
server requests fail explicitly; the agent is instructed to ask normal chat questions.

The npm production audit reported no advisories. The Rust audit retains five
unmaintained `rust-unic` dependency notices through `urlpattern`/Tauri; see
`SECURITY-REVIEW.md`. These are not suppressed and require upstream tracking.
The bundled engine has its own upstream dependency/security lifecycle.

The Windows linker emits an informational import-library creation message as a
Rust linker warning; there were no compiler or Clippy source warnings.
