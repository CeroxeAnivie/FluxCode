# Contributing to FluxCode

Thank you for helping make coding feel more continuous and less interruptive.
Before changing behavior, read [architecture](docs/ARCHITECTURE.md),
[engineering standards](docs/ENGINEERING.md), and
[product experience principles](docs/PRODUCT-EXPERIENCE.md).

## Local development

Use the pinned Rust, Node and pnpm versions in the repository. On Windows install
Visual Studio C++ Build Tools and the Windows SDK. Follow the README setup steps;
the engine is downloaded and checksum verified, never committed as a binary.
Set your local proxy before network commands. Never commit API keys or engine homes.

## Changes

Keep domain rules independent of React and IPC. Keep filesystem, process and
credential access in the Rust host. UI code must go through the bridge contract.
Use UTF-8 without BOM. Generated protocol bindings must be regenerated, not edited.
Do not modify the user-owned root AGENTS.md to impose project policy.

For behavior changes, include normal, failure and boundary tests. UI changes need
keyboard and narrow-window checks and must preserve input and context on failure.
Use clear commits describing the change. Explain the problem, resulting behavior,
validation and remaining limitations in the pull request.

## Required checks

```powershell
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm format:check
pnpm test:codex
node scripts/reasoning-smoke.mjs
./scripts/dev.ps1 test
./scripts/dev.ps1 clippy
./scripts/dev.ps1 build
```

Install Playwright Chromium before UI tests (`pnpm exec playwright install chromium`).
Native GUI and package verification instructions are in [release checks](docs/RELEASE.md).
Use local fixtures, not production credentials. Discuss architectural changes in
an issue before introducing new dependencies. Contributions are licensed Apache-2.0.
