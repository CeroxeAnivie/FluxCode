# Bundled browser runtime

The Windows installer contains `browser-runtime/node.exe`, `driver.mjs`, a pinned `playwright-core` package and their full license/notice files. It does not bundle Chromium or launch a second browser. Playwright attaches only to the isolated, visible remote-page WebView2 profile; the application UI uses a separate profile.

`config/browser-runtime.toml` pins Node 24.21.0, the official Windows ZIP checksum, the extracted executable checksum and Playwright 1.63.0. `node scripts/prepare-browser-runtime.mjs` verifies both checksums, prepares resources and copies the driver. It uses the build process's optional proxy environment. No machine proxy is saved in the repository. `node scripts/verify-release.mjs` extracts and compares every bundled runtime file and checks the packaged executable/version.

Node's full third-party license text is distributed as `browser-runtime/NODE-LICENSE.txt`. Playwright's Apache-2.0 license and third-party notices remain in `browser-runtime/node_modules/playwright-core/`. The image viewer's MIT license is in `legal/THIRD-PARTY-NOTICES.txt`. Existing engine and MPL source notices remain unchanged.

The driver processes bounded NDJSON operations sequentially. Mutations need a current snapshot ID and an exact accessibility reference, use Playwright actionability checks, and are never automatically replayed. User takeover cancels the helper process and blocks later automation until explicit resume. Cancellation cannot undo an already dispatched browser action. Dialogs suspend the triggering action and are answered by a later `handle_dialog` call.

To run Windows native tests, configure Rust and any required network access in the process environment, then use `pnpm test:native`. Tauri embeds the Common Controls v6 manifest in application binaries only; this runner also embeds the same manifest in test executables with the Windows SDK `mt.exe`. This allows the real native dialog plugin to load during tests instead of failing with a missing TaskDialogIndirect entry point.

The native integration fixture uses `cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol --bin fluxcode`, followed by `node scripts/native-browser-interaction-smoke.mjs`. Run `pnpm build` and the runtime preparation script first. Debug-only environment variables isolate test data and the app's CDP port; release builds do not enable that test interface.
