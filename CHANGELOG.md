# Changelog

## 0.1.7 — Visible agent teams and smooth desktop panels (2026-10-04)

- Show descendant agents under the selected task with live, read-only detail panels, localized status and rendered reasoning/tool output. Enable native parent/child/sibling messaging, interruption and follow-up without a small product quota.
- Apply FluxCode system identity and collaboration capability metadata to known and custom channel models. Preserve upstream technical defaults and legal attribution.
- Record per-turn model IDs, retain the working label and elapsed time, and animate activity dots even with reduced motion using a gentle opacity pulse.
- Unify native acrylic tint across chrome and workspace at 90% opacity. Add short panel/disclosure transitions with immediate drag resizing, reduced-motion support, preserved editor/terminal state and stable Markdown link focus.
- No new dependencies or database schema migration. Reuse the existing patched engine binaries.

## 0.1.6 — Browser interaction, images and native desktop finish (2026-10-04)

- The visible WebView2 browser now supports element snapshots, click, fill, select, checkbox, key, hover, scroll, screenshot and page dialogs through bundled Playwright. User takeover cancels pending automation; stale targets require a fresh snapshot.
- Paste, drop or select chat images; view thumbnails and zoom previews, send image-only messages, and retain images in conversation history. Image files are stored under the application's data directory with bounded decoding.
- Text files open directly in the CodeMirror editor. Create a project file, toggle wrapping and reference a saved file in chat; existing conflict detection and draft recovery are preserved.
- Windows native acrylic follows theme and system transparency preferences, with a verified opaque fallback. App native dialog commands no longer override remote pages' alert/confirm.
- Ship the pinned Node/Playwright runtime and its licenses inside the installer; reuse Codex 0.157.0 without rebuilding the engine.

## 0.1.5 — Composer queue and visible browser tools (2026-10-04)

- Remove the permanent Queue and Send now buttons while a task is running; retain Stop.
- Ctrl+Enter queues the current draft. Pressing it again with an unchanged empty draft inserts that exact queued message into the running turn, including its attachments.
- Reserve the queued message durably before insertion; repeated keys cannot send it twice, and uncertain failures require review instead of automatic replay. Changing tasks, editing the draft or ending the turn invalidates the shortcut target.
- Align model and reasoning controls to the right in both the main and project windows; preserve wrapping in narrow panels.
- Replace the subtle opacity pulse with staggered moving dots and elapsed waiting time. Reduced-motion preferences remain respected and the timer continues updating.
- Remove the extra final-paragraph margin in sent messages, restore symmetric bubble padding and apply block-aware Markdown spacing using the existing react-markdown/GFM renderer.
- Dock the editable, cancellable queue immediately above the composer. Pause messages while editing and preserve order, attachments and stopped-turn state.
- Register a built-in MCP browser tool using the official rmcp SDK and a bounded Windows named-pipe bridge. Agent navigation automatically opens the main-window right panel with an agent badge; reading retrieves the same visible page. Support open/read/back/forward/reload/close, with no arbitrary scripts or form interaction.
- Refresh browser tool guidance for new and resumed threads; acknowledge actual desktop actions and surface failures.
- Reuse bundled Codex 0.157.0 binaries. Include the new dependency licenses; no database or user configuration migration.

## 0.1.4 — Clear next steps and persistent actions (2026-10-04)

- Simplify the welcome view into a single heading and lightweight starters. Remove duplicate status and dialog headings, move context controls into the composer, and keep empty file panels out of the initial workspace.

- Keep channel editor actions against the panel bottom; scroll the form independently. Task/workspace lists, conversation import, task editing and conflict resolution also keep their actions visible. Extension and schedule headers remain accessible while content scrolls.
- Show actionable, redacted error reasons directly. Known application messages remain localized; technical service details are selectable inline. Preserve queue failure context across restarts instead of replacing it with a generic message.
- Group error actions at the right edge. Offer “Reconnect engine” only for connection failures; dismissing a notice does not change engine state or resend work.
- Highlight required setup with an icon, contrasted surface and direct project/channel/engine actions. Keep drafts while completing setup; retain model selection access independently of send availability.
- Use the installed blue F icon for the welcome screen, title bar, assistant avatars, favicon and repository hero. All application marks reference assets/icon.svg; the existing Windows icons already match it.
- No dependencies, provider/configuration schema or database migration. Bundled Codex 0.157.0 is reused.

## 0.1.3 — Desktop navigation and channel state (2026-10-04)

- Separate global navigation from the project/task pane; keep terminal, files and browser actions beside the workspace. Settings and channels use persistent category/list columns.
- Let the composer fill its workspace at every panel and window width. Add a shared original vector FluxCode mark, translucent navigation/floating surfaces, light/dark support and reduced-transparency fallback.
- Changing an address, key, credential identifier or proxy clears the previous model draft, aliases, exclusions, filter and bulk selection. Successful discovery replaces the directory; failures preserve the last valid directory for the same connection.
- Refresh removes missing models by default. Retaining them is an explicit choice. Model pickers and the capabilities view use the saved channel catalogue; stale defaults are not reintroduced. Existing conversation choices remain recorded, with an explicit reselection error if no longer available.
- Explicit reconnect reads current saved credentials, including deletion, instead of falling back to an obsolete session key. Saving without reconnecting reports the deferred key change.
- Ignore late model-selection saves and file previews after newer selections or scope changes. Keep refresh success feedback associated with the directory that was saved.
- No provider TOML/schema or database migration; legacy single-model profiles remain readable. No dependencies added and no Cherry Studio source/assets incorporated. Bundled Codex 0.157.0 remains unchanged.

## 0.1.2 — Models, browser and artifact links (2026-09-27)

- Compact themed model rows, inline aliases, icon removal and a single scroll area for small catalogues. Large catalogues retain virtualization.
- Address-bar text searches Bing; valid URLs and bare hostnames navigate directly. Unsafe explicit schemes remain blocked.
- Remote pages retain responsive layout; fixed-width content scales to the panel down to 35%, preserving scrolling for exceptionally wide content. No remote IPC capability is added.
- Markdown links to absolute Windows paths and file URLs inside the project open with the system default application. Traversal, external paths and executable file restrictions remain enforced.

Validation: 121 unit tests, 10 targeted browser flows, TypeScript check; browser fit checked with fixed and responsive page fixtures. Website-specific layouts may still require a wider panel or the external browser.

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
