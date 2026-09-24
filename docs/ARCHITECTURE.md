# Architecture

FluxCode is a local desktop host for a pinned, bundled Codex executable. The Rust
host owns engine process lifetime, JSONL framing, request correlation, bounded
pending requests, timeouts, configuration and filesystem access. The frontend
does not call model APIs or run a second agent loop.

## Dependency direction

Presentation → application use cases → infrastructure adapters → Tauri commands.
Pure domain reducers are shared without I/O dependencies. Generated Codex schemas
are confined to the protocol adapter. The Rust host separates `config`, `context`,
`credentials`, `engine`, and `workspace`. `lib.rs` composes these modules and enforces
the product's trusted command boundary.

## Storage and ownership

- `fluxcode.toml`: documented, versioned app configuration; comment-preserving edits.
- `engine-home/`: isolated Codex runtime state, history and user agent instructions.
- `engine-home/AGENTS.md`: user-owned; create once, never overwrite.
- `engine-home/ENVIRONMENT.md`: generated environment facts, refreshed on connection.
- System credential store: optional API key, scoped by provider URL and environment key.
- WebView local metadata: project membership, task titles/archival state and per-task
  model/effort selections. No message
  history or secrets. The engine is authoritative for execution history.

Default instructions live in `config/agent/BASE_INSTRUCTIONS.md`; project/user
instructions remain distinct. Task creation adds concrete OS, architecture, shell,
workspace, encoding and proxy facts. Model names do not grant capabilities.

## Protocol and execution

The process is initialized once using `initialize` + `initialized`, followed by
thread/turn operations. Notifications feed a pure conversation reducer. Completed
items replace accumulated deltas by ID. History hydration buffers concurrent events.
Unknown server requests receive explicit errors rather than hanging indefinitely.

The renderer's RPC allowlist excludes configuration mutation and account APIs.
The host enforces `danger-full-access` and `never` at thread and turn boundaries.
Interactive commands go through a dedicated host command that resolves the configured
shell, sets UTF-8 and proxy environment, and calls Codex `command/exec` with bounded
timeout/output. Commands are user-authorized shell input; filesystem previews remain
project-scoped and reject traversal, binary content and oversized files.

On engine exit, pending requests fail and the UI offers reconnection. No automatic
replay of model turns or shell commands. On app exit, the owned engine is stopped.
No global Codex installation or configuration is modified.

## Compatibility and release boundaries

Codex 0.156.1 is locked by release SHA-256. The app-server protocol is upstream
experimental: compatibility is tested against this exact bundle, never an arbitrary
user CLI. Updating it requires regenerating bindings and passing the real-engine
fixture tests. Current packaging is Windows x86_64; cross-platform host code is not
a claim that macOS/Linux installers have been verified.

The explicit Off behavior and pinned model catalog adaptation are documented in
`ENGINE-COMPATIBILITY.md`. Font preferences persist in the TOML configuration.

The terminal panel runs bounded commands and streams output. It is not yet a full
interactive PTY for TUI programs. Files are previewed read-only; agent tools perform
edits. Remote workers, auto-update, code signing and broad provider interoperability
are separate release work, not implied by the current implementation.
