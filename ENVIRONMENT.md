# FluxCode development environment

This file documents environment facts. `AGENTS.md` is reserved for user instructions.
Engineering conventions are documented in `docs/ENGINEERING.md`.

| Item                    | Value                                                  |
| ----------------------- | ------------------------------------------------------ |
| Project                 | Current repository root                                |
| Reference visual system | sibling `NeoLink`, `ModernTheme`                       |
| Host                    | Windows x86_64, PowerShell                             |
| Frontend                | React 19.3, TypeScript 7.0, Vite 8.3                   |
| Desktop                 | Tauri 2, Rust 1.98.1, edition 2024                     |
| Agent runtime           | bundled Codex CLI 0.156.1, stdio JSONL                 |
| Model protocol          | Responses API only                                     |
| Default execution       | `danger-full-access`, `approval_policy = "never"`      |
| Proxy                   | `http://127.0.0.1:14455/` for outbound network clients |
| Text encoding           | UTF-8 without BOM                                      |
| License                 | Apache-2.0                                             |

Local Rust tooling may be installed in `.toolchains/` without changing system PATH.
Use `scripts/dev.ps1` to configure Rust tooling and the build proxy. Dependencies
are pinned in `pnpm-lock.yaml`, `src-tauri/Cargo.lock`, and `rust-toolchain.toml`.
The user-facing runtime has a separate OS application-data directory and does not
modify an existing standalone Codex installation.
