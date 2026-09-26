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
Provider request and stream retries are disabled: after an uncertain outcome the
application reconciles the recorded turn, preserving input for explicit user retry.

The renderer's RPC allowlist excludes configuration mutation and account APIs.
The host enforces `danger-full-access` and `never` at thread and turn boundaries.
Interactive commands go through a dedicated host command that resolves the configured
shell, sets UTF-8 and an optional configured proxy environment, and calls Codex `command/exec` with bounded
timeout/output. Commands are user-authorized shell input; filesystem previews remain
project-scoped and reject traversal, binary content and oversized files.

On engine exit, pending requests fail and the UI offers reconnection. No automatic
replay of model turns or shell commands. On app exit, the owned engine is stopped.
No global Codex installation or configuration is modified.

## Compatibility and release boundaries

Codex 0.157.0 with the reviewed `engine/security` dependency patches is locked by
SHA-256 in `config/engine-release.toml`. The app-server protocol is upstream
experimental: compatibility is tested against this exact bundle, never an arbitrary
user CLI. Updating it requires regenerating bindings and passing the real-engine
fixture tests. Current packaging is Windows x86_64; cross-platform host code is not
a claim that macOS/Linux installers have been verified.

The explicit Off behavior and pinned model catalog adaptation are documented in
`ENGINE-COMPATIBILITY.md`. Font preferences persist in the TOML configuration.

The terminal dock owns up to eight interactive PTY sessions through the bundled
engine. Hiding the dock preserves sessions. Windows Job Objects bind engine/tool
descendants to the desktop lifetime; a single-instance host avoids concurrent state
owners. Structured JSON logs rotate daily and retain seven files without recording
raw prompts, credentials or engine stderr.

CodeMirror provides file editing, search, undo and syntax highlighting. Writes use
optimistic disk-content checks; conflicts open an explicit merge editor before any
overwrite. Diff review supports unified and side-by-side layouts. Long conversations
use virtual rows and batched deltas; engine history remains authoritative.

The Windows app is distributed locally. Updates are a disabled placeholder with no
updater plugin or automatic network requests. Configured model APIs and user-invoked
network tools remain available. Signing, clean-machine release acceptance and broad
provider interoperability are not implied by local build success.

Each workspace window can host a remote child WebView2 in its right browser panel.
React owns the toolbar, resizing and focus return; the browser transport serializes
creation, layout and closure. Rust validates URLs and bounds, blocks internal
origins, reuses the same child for popup links, and denies downloads with an
external-browser handoff. Remote content uses an incognito profile. Local
capabilities target only `main` and the eight fixed workspace WebViews, not their
containing windows; application IPC independently rejects remote child labels. Tauri is pinned to 2.11.6
because its child-WebView API requires the upstream `unstable` feature.

Multiwindow shared mutations go through the main renderer's single catalog/queue
writer; native request correlation and per-window mirrors preserve ownership.
See `MULTIWINDOW.md` for capacity, recovery and close behavior. System appearance
uses the native Windows theme and native change events rather than WebView2's
potentially different CSS media preference. Browser previews use media queries.
