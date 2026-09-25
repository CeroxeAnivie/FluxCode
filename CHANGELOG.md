# Changelog

## Unreleased

- Independent workspace windows with shared task state, private drafts, project
  selection and recovery; closing the main view preserves coordination until the
  last workspace closes.
- Bounded tasks, terminals and pending requests, reserved interruption capacity,
  per-window terminal cleanup and runtime resource counters.

- Multiple saved Responses channels with bulk TOML import/export, model discovery,
  refresh previews, credential management and explicit switching.
- Durable drafts and queue recovery, searchable conversation history, workspace
  management and an overview of running, waiting and failed tasks.
- Verified backup/restore, SQLite snapshots, recovery copies and data retained
  beside the program; Windows directory-move acceptance includes Unicode and
  long paths with validated short-path aliases.
- Git line staging, merge/rebase conflict resolution, editable files and multiple
  project terminals. Foreground terminal recovery synchronizes PTY dimensions.
- Resizable right-hand WebView2 browser with remote IPC isolation and external
  browser handoff.
- Improved localized error feedback, failed-save recovery and stale-turn routing.

This section describes the working tree, not a released installer. Full keyboard,
screen-reader, sleep/resume, extended fault/soak and clean-machine lifecycle
acceptance remain open. Signing and broader real-provider verification also remain
release requirements; local fixture success is not a substitute.

## 0.1.0 — Initial public preview

- Windows desktop workspace with bundled Codex 0.156.1; no separate CLI installation.
- Local projects, conversations, streaming output, cancellation, history and archiving.
- Responses providers, OS credential storage and editable TOML configuration.
- Per-conversation model and reasoning selection; Off omits the wire effort field.
- Adjustable, remembered typography and keyboard-accessible model controls.
- File previews, Git changes and bounded terminal commands with full access.
- Apache-2.0 licensing, third-party notices and documented verification evidence.

This is the first public preview. Signing, clean-machine lifecycle acceptance,
production-provider acceptance and macOS/Linux distribution remain release gates.
