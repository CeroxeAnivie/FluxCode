# Release process

Current delivery scope is a Windows local desktop tool. Application updates are
a disabled settings placeholder: there is no update endpoint, background check,
download, or in-app installation. Distribute installer files manually. Configured
Responses providers and explicitly invoked network tools still require network
access; local operation does not imply an on-device language model.

1. Pin the engine tag, asset digest, schema bindings and runtime version together.
   The authoritative identity is `config/engine-release.toml`. Run
   `scripts/prepare-engine.ps1`; any digest mismatch fails the preparation.
   Preparation uses Python 3.12+ standard TOML parsing. Custom reviewed builds use
   `-ArtifactDirectory` or the release manifest's verified asset distribution URL;
   they never silently fall back to an unpatched upstream binary. The source build
   recipe and backport provenance live in `engine/security`.
   Close FluxCode before replacing its resources. Preparation verifies the full
   staged batch first and rolls back ordinary replacement failures; multiple-file
   publication is not power-loss atomic. A failed rollback retains original files
   and reports their recovery directory. Run `python scripts/test-prepare-engine.py`
   for the replacement failure regressions.
2. Install the locked Node and Rust dependencies. Configure a proxy in the
   developer's environment only when that environment requires one.
3. Run typecheck, domain tests, GUI tests, real-engine fixture smoke tests, formatting,
   Rust tests and Clippy. Inspect screenshots at normal and minimum window sizes.
4. Refresh dependency inventory and bundled third-party license texts. Review
   advisories; do not equate a zero advisory count with absence of security risks.
5. Build the Windows NSIS installer. Verify engine and legal resources are included.
   Run `node --test scripts/lib/release-binary.test.mjs` and
   `node scripts/verify-release.mjs`. The latter requires 7-Zip (the standard
   Program Files location, or `SEVENZIP_BIN`) and retains extracted verification
   evidence under `work/`. It compares the actual packaged executable and every
   engine/legal resource with the current build; only Tauri's NSIS marker differs.
   Test on a clean Windows account with WebView2 and no global Codex installation.
6. Exercise install, first-run configuration, credential save/delete, task resume,
   missing Git/model failures, command interruption, shutdown, upgrade and uninstall.
   The NSIS uninstaller retains `data` by default. Its explicit delete-data checkbox
   removes application-owned `data` only during a real uninstall, never during an
   update. Test both choices and confirm an unknown or linked `data` directory is
   not recursively removed.
7. Configure a publisher-owned code-signing certificate and timestamp server before
   public distribution. No signing identity is fabricated or bundled in source.
8. Publish checksums and release notes. Retain previous installer for rollback;
   back up user TOML and runtime state before any future schema migration.

The initial local build is unsigned. A successful build and fixture tests do not
establish compatibility with every Responses provider or constitute public release
approval. Use the selected real provider for a separate user-authorized acceptance
test before public launch. Runtime command tools have intentional full host access.
