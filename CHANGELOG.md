# Changelog

## 0.1.1 — Interaction refinement (2026-09-27)

- Model lists are visible in the channel editor and include all discovered models by default. Add display aliases, search by alias or ID, remove individually or in bulk, and restore removed models. Requests retain their original model IDs.
- Model refresh preserves aliases and exclusions, adds new models, and keeps temporarily missing models by default. The explicit removal preview protects the active model.
- Protect channel and schedule edits from accidental cancellation. Keep schedule intervals after creation and extension drafts when switching tabs.
- Add settings section navigation; unchanged settings no longer reconnect an already connected engine, while disconnected sessions retain the recovery path.
- Improve search/rename focus, modal return focus, terminal empty states and adjacent-tab selection. Command search includes tasks beyond the recent 100.
- MCP editing opens and focuses its form. Authorization links can open directly in the default browser. Plugin operations and diagnostics export report results and retain failed input.
- Reuse the patched Codex 0.157.0 engine; no new dependencies. Windows installer and source remain Apache-2.0.

Model aliases and exclusions are optional TOML fields; existing profiles load unchanged. Empty new fields are omitted. Before downgrading after saving aliases/exclusions, restore the previous profiles backup: version 0.1.0 rejects unknown profile fields. Credentials remain in the OS vault.

## 0.1.0 — Windows local desktop (2026-09-26)

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

- Codex 0.157.0 with reviewed dependency upgrades and security backports;
  pinned binary hashes, protocol bindings and provider-default reasoning behavior.
- Lazy-loaded settings and Inspector, terminal clear targeting the visible mode,
  explicit upstream-overload errors and real-provider acceptance evidence.
- Native V8 notices, engine dependency inventory, corresponding MPL source
  archives and reproducible source patch recipe.

The installer is unsigned. Clean-machine installation/upgrade, publisher signing,
DPI/account matrices, prolonged soak and complete network/disk fault matrices
remain explicitly deferred. One real Responses provider passed a scoped native
acceptance run; this does not establish compatibility with every provider.
Five upstream maintenance advisories remain documented.
