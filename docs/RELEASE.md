# Release process

1. Pin the engine tag, asset digest, schema bindings and runtime version together.
   Run `scripts/prepare-engine.ps1`; any digest mismatch fails the preparation.
2. Install the locked Node and Rust dependencies with the required proxy enabled.
3. Run typecheck, domain tests, GUI tests, real-engine fixture smoke tests, formatting,
   Rust tests and Clippy. Inspect screenshots at normal and minimum window sizes.
4. Refresh dependency inventory and bundled third-party license texts. Review
   advisories; do not equate a zero advisory count with absence of security risks.
5. Build the Windows NSIS installer. Verify engine and legal resources are included.
   Test on a clean Windows account with WebView2 and no global Codex installation.
6. Exercise install, first-run configuration, credential save/delete, task resume,
   missing Git/model failures, command interruption, shutdown, upgrade and uninstall.
7. Configure a publisher-owned code-signing certificate and timestamp server before
   public distribution. No signing identity is fabricated or bundled in source.
8. Publish checksums and release notes. Retain previous installer for rollback;
   back up user TOML and runtime state before any future schema migration.

The initial local build is unsigned. A successful build and fixture tests do not
establish compatibility with every Responses provider or constitute public release
approval. Use the selected real provider for a separate user-authorized acceptance
test before public launch. Runtime command tools have intentional full host access.
