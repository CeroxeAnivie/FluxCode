# Verification

## Current Windows working tree — 2026-09-25

The most recent complete pre-release baseline passed 97 Rust tests, 89 frontend
unit tests and 75 Playwright browser workflows. TypeScript, Prettier and strict
Rust Clippy also passed. Focus, localization and startup-diagnostic changes made
after this baseline require a final rerun before publication.

Real Windows Tauri/WebView2 checks passed for backup creation, validation,
damaged-backup rejection, a current-state safety snapshot and restart recovery.
The backup test verified that SQLite snapshots contain committed WAL data but
leave no WAL/SHM sidecars. A separate native test confirmed window size,
position and maximized state across process restarts, and corrected a partly
off-screen saved position at 150% display scaling. These checks use isolated
application data and a local Responses fixture, not a production provider.

The current release installer is **not yet accepted**. The full source rebuild,
resource inspection, install/upgrade/uninstall on a clean Windows account,
multiple real-provider compatibility, long-run fault testing and publisher
signing remain open. The package hash in the historical section below belongs
to an earlier build and must not be used to identify this working tree.

The 2026-09-25 dependency review is in `SECURITY-REVIEW.md`: production npm
audit returned no known advisories; the all-platform Rust OSV query covered
574 packages and retains five Windows-reachable maintenance notices. The
third-party inventory contains 815 packages, with upstream license supplements
for all 11 Windows Rust packages lacking standalone local license files.

## Historical record — 2026-09-24

## Windows local workflow verification

The latest working tree passes 42 frontend unit tests, 32 Rust tests, 26 Playwright
flows, TypeScript production build, Rust formatting and Clippy with warnings denied.
The native Windows fixture passes single-instance activation, real engine task fork,
model discovery, credentials, model/effort retention, TOML hot reload and recovery,
deferred reconnect with preserved PTY, stale writes, resume and shutdown. Local JSON
logs parse correctly and exclude the fixture credential.

Updates are deliberately a disabled placeholder. There is no updater plugin,
endpoint, polling, download or install action. Both browser and native tests verify
the disabled control. Model services and explicitly invoked tools may still network.

Additional verified workflows include CodeMirror undo/save/conflict resolution,
virtualized 2,000-message history, command palette navigation, multiple terminals per
project, task forks and remembered panel widths. Windows Job Object tests verify a
live owned process exits within five seconds of closing the job. This is not a
long-duration reliability or clean-machine installation certification.

The production npm audit reports zero known advisories across 195 dependencies.
The refreshed notices inventory contains 795 entries; the earlier Rust advisory
report and license-reconciliation limitations remain documented in SECURITY-REVIEW.
The historical installer details below are not the latest build's checksum.

## Current configuration/channel implementation

The working tree now includes authoritative TOML appearance settings, notify-based
configuration monitoring, valid-snapshot recovery, version-checked connection and
channel saves, transactional engine replacement, and deferred reconnection while
tasks or terminals are running. Channel setup starts with Base URL and key, then
fetches and filters models without requiring a model in advance. HTTP(S) Markdown
links use the default browser through a validated native command.

Current checks: 36 frontend tests, 30 Rust tests, 16 browser workflow tests;
TypeScript, formatting, Clippy, and Windows native debug build. The native GUI
fixture additionally exercises external rename saves, language/theme/font updates,
invalid-config recovery, retained PTY output during deferred reconnect, and stale
save rejection while preserving the old engine. Link markup and native dispatch
contracts are checked; browser dispatch is not an embedded browser implementation.

Browser workflows run an isolated test-mode production build, eliminating dev-server
on-demand transformation/HMR interference without increasing timeouts or retries.
See `configuration.md`, `LIVE-ACCEPTANCE-2026-09-24.md`, and `SECURITY-REVIEW.md`.

The package hash below belongs to the initial package, **not** these current changes.

## Initial package baseline

## Passed

- TypeScript strict typecheck and Vite production build.
- 18 frontend domain/persistence tests.
- 12 Rust configuration, policy, filesystem and instruction-ownership tests.
- 6 Playwright workflow tests: layout/files/diffs/terminal, task streaming and
  restore, cancellation/failure draft retention, minimum-size layout/settings.
- Real bundled Codex 0.156.1 smoke test: initialize, full-access policy, native
  exec_command call, actual file creation, tool result fed back to a local mock
  Responses service, streamed final response, resume, terminal success/failure,
  and archive. No production API is called.
- Real Tauri/WebView2 native integration: GUI → Rust IPC → bundled engine → local
  Responses service, streaming, terminal, OS credential save/delete, TOML persistence,
  user/environment file separation, reload/resume and application shutdown.
- Real Responses wire contract: known/custom models, Off, none, minimal, low, medium, high, xhigh and max; clearing a prior effort is verified.
- Native GUI verifies Off → High → reload/resume → Off; UI checks cover remembered selections, locked running controls and 18px typography at a 960px window.
- Rust Clippy `--all-targets -- -D warnings` and Prettier checks.
- Strict UTF-8 decoding of project text files, including generated bindings;
  Chinese content reread successfully with no U+FFFD replacement characters.
- Windows x86_64 optimized build and NSIS installer generation.
- Installer resource manifest verified: bundled engine, Apache LICENSE/NOTICE,
  third-party notices, supplemental license texts and MPL source archives.
- Production JavaScript verified to exclude test transport and fixture models.
- Embedded engine SHA-256 verified against pinned GitHub release.

## Package

`FluxCode_0.1.0_x64-setup.exe` — 75,917,579 bytes.

SHA-256: `6b3f1e55a460e6b3432d068c9351ceb03c8ee33d7b03f0a8b60e13f07df75b24`

## Limits and remaining release work

The installer is unsigned. Clean-machine install/upgrade/uninstall acceptance and
real-provider/API-account acceptance have not been performed. macOS/Linux packages
have not been built or verified. The terminal panel is for bounded commands, not
interactive TUI programs. File previews are read-only. Unsupported interactive
server requests fail explicitly; the agent is instructed to ask normal chat questions.

The npm production audit reported no advisories. The Rust audit retains five
unmaintained `rust-unic` dependency notices through `urlpattern`/Tauri; see
`SECURITY-REVIEW.md`. These are not suppressed and require upstream tracking.
The bundled engine has its own upstream dependency/security lifecycle.

The Windows linker emits an informational import-library creation message as a
Rust linker warning; there were no compiler or Clippy source warnings.

## Unreleased context-management verification (2026-09-24)

The package/hash above describes the earlier installer, not the current working tree.
Context management is now implemented locally and verified with 26 frontend unit
tests, 16 Rust tests, 11 browser integration tests, TypeScript, Clippy and a production
frontend build. The actual bundled engine passed manual compaction, continuation,
automatic threshold triggering and invalid-thread rejection against a local Responses
fixture. Native Tauri/WebView2 testing additionally verified the GUI → Rust → engine
path and persisted context settings. Chinese is the default even on an English system;
the new context settings were inspected in the English/light and Chinese/dark UI.

A first browser regression run hit a first-page navigation timeout; the subsequent
full runs passed without relaxing assertions or timeouts. Native automation now waits
for the app heading before accessing storage, avoiding WebView2's initial blank page.

These checks do not establish production-provider acceptance, release signing or
completion of the remaining product ledger. See `context-management.md`.

## UI modernization — 2026-09-24

- All application select controls share pinned Radix Select: keyboard navigation,
  typeahead, focus restoration, disabled states and dialog top-layer placement.
  Native form validation is retained for empty required values.
- Channel discovery uses a searchable native radio group, styled as selectable
  model rows; no OS listbox. Selection continues to update the model ID field.
- Shared control tokens unify secondary actions, checkboxes, radios, disclosure
  affordances, form fields, dialog surfaces, focus rings and theme colors.
- Large-type settings retain the fixed save footer and bounded scroll area.
  English option labels refresh on language changes, including Radix typeahead.
- Command detail rendering now correctly handles absent directory/exit/duration
  metadata and displays zero exit codes and durations without template artifacts.
- Verification: 38 frontend tests, 18 Playwright flows, TypeScript and formatting;
  Windows debug native GUI smoke includes discovery, model/effort persistence,
  configuration hot reload and recovery, terminal preservation and shutdown.
- Screenshots cover light/dark, English/Chinese and 960×720 at 18px. Existing Linux
  security/release findings in SECURITY-REVIEW.md are unaffected by this UI work.

## Windows interaction follow-up

- Editor draft writes coalesce at 300 ms idle with a one-second continuous-typing
  bound. Blur, page hide, editor close and native close flush pending data. Storage
  failure is visible, retains pending text for retry, and blocks explicit editor
  closure. A previous valid local generation supports corruption recovery.
- Browser-normalized edits preserve the original Windows CRLF convention. Ctrl+S
  also saves the merge editor. File-save success is separate from draft cleanup;
  cleanup failure must not present a false disk conflict.
- Terminal controls retain their own key bindings. Windows maximize/restore labels
  and icons follow actual window state, verified in native desktop automation.
- Staged and unstaged differences have separate views. Text modifications support
  staging/unstaging whole hunks with snapshot validation and Git atomic index writes.
  New/deleted/renamed/mode-changing files retain file-level staging. Real Git tests
  verify other hunks and working-tree contents remain intact and stale diffs fail.
- Reconnection invalidates old history hydration results; an old request cannot
  overwrite restored history or clear a newer request's bookkeeping.
- Verification: 47 frontend tests, 33 Rust tests, 29 browser flows, native smoke,
  Clippy, formatting and production compilation. The final draft-cleanup fix has
  an additional targeted passing browser test. No new dependencies were added.
- Full-tree git diff whitespace checks flag verbatim upstream license text in the
  generated notices; application/source diff whitespace checks pass.

Remaining: full visual rebase/conflict workflow, extended
soak/fault testing, complete accessibility audit and signed clean-machine release.
Draft batching intentionally has a bounded unsaved interval on abrupt process loss;
this is not a guarantee of zero keystroke loss under power failure.

## Unreleased backup and line-staging follow-up

- Rust backup tests cover SQLite WAL snapshots, `quick_check` validation, damaged
  manifests and payloads, copied-payload verification, interrupted restore retry,
  and refusal to create empty data after an orphaned restore stage.
- Backup settings expose the application-owned backup directory, snapshot list,
  verify, delete and guarded restore actions. A native restore fault matrix remains
  open; the browser and unit tests do not establish clean-machine acceptance.
- Individual Git diff lines can be selected from the gutter for staging or
  unstaging. Real temporary repositories cover replacement edits, mixed index and
  worktree state, stale diffs, CRLF, Unicode paths and missing final newline.
- The targeted line-selection browser test and the existing 37 browser regressions
  passed. Frontend build, TypeScript, 53 unit tests and strict Rust Clippy passed
  at the last full check. Changes after those checks require a fresh full run.

## Right browser panel (2026-09-25)

`scripts/native-browser-smoke.mjs` runs the project executable with isolated data
and a declared local HTTP fixture. It verifies two WebViews in one native window,
remote IPC rejection, navigation, back, resize, popup reuse, blocked internal
redirects, close and focus return. Proxy settings come only from process environment.
Playwright additionally checks Markdown routing, width persistence, dialog hiding,
English labels, narrow layout, failed creation retry and Chinese composition Enter.
The panel uses WebView2 through Tauri's pinned child-WebView API, not an iframe.
Native screenshots of the main renderer omit child-WebView pixels; they are not
complete desktop screenshots. These checks do not establish the full DPI matrix,
clean-machine signing, every website's compatibility or overall checklist completion.

Follow-up: the 99-flow browser suite passed before the file-panel switch fix.
After that fix, six targeted browser/editor/layout flows passed; the editor stays
mounted while the browser is visible, retaining unsaved text and its undo stack.
The Windows debug application was rebuilt after the fix. TypeScript, formatting,
translation coverage and strict UTF-8 checks passed for the changed files.

## Draft storage recovery (2026-09-25)

The workspace now keeps a persistent retry/export banner after local-storage or
native mirror failures. Editor draft failures also offer export without clearing
unsaved text. Explicit close remains blocked until persistence succeeds. Browser
fault tests verify quota failure, retained text, canceled export, retry and reload.
`native-storage-fault-smoke.mjs` makes the real Windows mirror read-only, verifies
that the previous file survives, that close is prevented, that an alternate export
succeeds, and that clearing read-only plus retry restores persistence across reload.
Document exports use a synced same-directory temporary file and atomic replacement;
Rust tests cover Unicode, size rejection, a missing directory and a Windows
exclusive file lock with successful retry. A physically full or disconnected disk
has not been exercised; those portions of the fault-injection matrix remain open.

# Task activity overview (2026-09-25)

- Latest verification: `pnpm typecheck`, 30 Vitest files / 104 frontend tests, 110 Rust library tests plus the binary startup test, and a fresh `pnpm tauri build --debug --no-bundle` all passed. The rebuilt Windows native smoke passed after the workspace lifecycle changes. This smoke does not exercise system suspend/resume.
- Performance fixture rerun collected measurements with 2,500 tasks, 1,500 files, 12 directory levels, 2,000 history items, 8,000-line editing and 500 streamed deltas. Latest measurements are in `work/performance-*/baseline.json`; catalog startup was 2,348.9 ms, task filtering 159.7 ms, history load 304.7 ms, task switch 232 ms and final stream paint 94.5 ms. Startup currently exceeds the 1.5 s target and remains a measured limitation.

- Targeted interaction regression coverage includes first-run setup, channel import, first message, Enter/Shift+Enter behavior, settings save/cancel protection, empty-state clearing, busy-state duplicate prevention, form error retention, retry/cancel consistency and destructive-action confirmation. These selected paths are covered by the workspace and channel Playwright suite; the native smoke also exercises the first-run-to-message flow. They do not establish a complete all-module usability review.

- Targeted accessibility regression: diagnostic copy success and failure are announced in the selected language. Two browser tests exercise keyboard activation, clipboard success/failure and absence of a nested alert in Chinese and English. These tests passed on 2026-09-25; full keyboard and screen-reader acceptance remains open. An earlier test with an unconditional assertion was removed and is not acceptance evidence.

- Complete browser regression after the task activity/concurrency changes: 106 flows passed. Subsequent targeted storage checks covered catalog write failure, recovery export, blocked unload, retry and restored task visibility.

## Workspace lifecycle

Workspace management supports searching names/paths, renaming, closing and reopening existing project directories. Closing preserves the catalog, conversation history and per-workspace drafts, pauses pending queue entries and rejects running tasks. Existing terminal processes remain alive, as explained in the dialog. Closed workspaces are excluded from sidebar batch selection; history navigation explicitly reopens their workspace.

Git worktree creation exposes an open action. The resulting independent workspace records its source workspace and displays that relationship. Existing version-1 catalogs remain compatible through optional `closed` and `worktreeParentId` metadata. Five catalog boundary/compatibility tests pass. Three focused workspace flows plus the existing batch organization regression pass.

- Real Windows desktop fixture acceptance passed in `work/native-1790312632140`: bundled engine messaging, model discovery, context compaction, effort selection, completed-task overview navigation, PTY, TOML reload, fork, single instance and process-restart history recovery. Fixture initialization now uses the native UI-state generation contract instead of bypassing the durable mirror.
- Host and renderer now both associate busy state with the exact turn ID. The Rust regression verifies delayed completion cannot release a newer turn or another thread; both targeted engine tests passed. A browser regression verifies disconnect surfaces uncertain execution, permits reconnect/history recovery and sends the original request only once.

- Follow-up concurrency fixes: stale turn completion/errors/deltas cannot modify a newer active turn. Pending agent answers and service form inputs survive task switches in memory and are removed when requests resolve; they are never saved to browser storage.
- Added Playwright coverage for two concurrent tasks, waiting-input navigation, exact request routing, retained form drafts, an unchecked required boolean, and clearing an optional numeric field. Both flows passed; all 102 unit tests passed before the additional form change, and type checking passed after it.

- Added a searchable overview of active, waiting-input, queued, paused, failed and completed tasks, with direct navigation and target-specific interruption.
- Domain tests cover status ordering, archived exclusion, empty catalogs, missing projects, failed queues and interrupted turns.
- Two Playwright flows passed: background-task interruption remains scoped to its thread, failure can be retried, and a 75-task list supports incremental display, project search, English labels and keyboard focus restoration.
- Type checking and localization checks passed. These checks use the declared local bridge fixture; they do not claim real-provider parallel execution acceptance.

## Foreground recovery follow-up (2026-09-25)

Idle connection probes ignore results after effect disposal or engine-generation changes. Terminal foreground recovery now fits the renderer and sends the corresponding PTY resize; pending animation frames are canceled on teardown. TypeScript and three targeted browser flows passed (idle reconnect and Chinese/English diagnostic feedback). Real operating-system suspend with running tasks and queue reconciliation remains unverified.

## Portable long-path acceptance (2026-09-25)

The rebuilt release passed `native-data-move-smoke.mjs` in `work/native-data-move-1790318323086`: case-only rename, move to a 289-character Unicode directory, original history hydration, continued Responses turns, and SQLite rollout-path verification. Native Windows startup uses a verified short executable alias before COM initialization, and the engine uses its verified short working-directory alias. Both aliases address the original files; no data is moved to an external cache. The launcher owns its child process through a kill-on-close job. Volumes without usable short aliases receive an explicit shorter-directory recovery message; arbitrary filesystem path lengths are not promised.

The PTY foreground regression also passed: dimensions are sent to the same process ID and hidden terminals do not receive zero-sized resizes. This is not an operating-system suspend acceptance test.

## README evidence review (2026-09-25)

Reviewed the actual `docs/images/desktop.png` against README claims: it shows the empty project workspace, input/model controls and file list, not an open terminal. Corrected its alternative text accordingly. The hero is branding artwork, not a product concept screen. Documented long-path limitations, retained release/clean-machine caveats, verified local README links and strictly decoded changed documents as UTF-8. The image does not establish usability, DPI or accessibility acceptance.

## Current full regression (2026-09-25)

TypeScript, 104 frontend unit tests, all 114 Playwright flows, 111 Rust library tests, the startup binary test, strict Clippy, release and debug desktop builds passed. The first release compiler attempt exited with a native access violation; a clean retry of the same command succeeded without relaxing checks.

## Native channel management acceptance (2026-09-25)

The rebuilt debug desktop passed the complete native smoke with `scripts/lib/channel-acceptance.mjs`: bulk TOML preview/import, independently credentialed copy, model-directory detection, added/removed model preview, apply, read-only providers.toml failure with byte-for-byte original preservation and retry, concurrent host write rejection with retained import text, reload and successful retry. The active connection is checked unchanged after management failures. Test credentials are removed and the initial profile list restored. The remaining native smoke passed messaging, PTY, configuration reload, credential operations, workspaces and restart/history recovery. This uses a declared local HTTP fixture, not a production provider.

## Packaged resource verification (2026-09-25)

The unsigned NSIS installer built successfully (102,504,867 bytes; SHA-256 `b391ef6ea01b8da96c77407ca30fc4a35c3f2e318fe84dad950baca02e3e9f29`). `verify-release.mjs` extracted its payload and matched the executable to the current build, allowing only Tauri's observed `UNK` to `NSS` three-byte bundle marker patch. All 16 engine/legal resources matched their source hashes, including source-availability materials. The verifier now uses content rather than executable timestamps: Tauri restores the executable after packing, which makes the previous timestamp check produce a false failure. Three Node regressions reject stale/truncated/extra bytes and missing/ambiguous/incorrect markers. Evidence is in `work/release-verification-VnzoJE`.

All 867 generated TypeScript protocol files matched a fresh generation from the pinned executable. The real engine code-mode tool/filesystem loop and native effort wire matrix passed against local fixtures. These checks do not validate clean-machine install/uninstall or sign the installer.

## Connection and request-lifecycle follow-up (2026-09-25)

Subsequent source changes add focus/network/visibility and delayed-timer resume signals; ordinary timer ticks perform no network work. Three fake-clock tests cover disposal, hidden windows and timer gaps. Foreground probes now include active tasks, invalidate failed connection state, protect the new engine from old probe results, and hold queued work for explicit retry. Thirteen targeted connection/queue/diagnostic/terminal browser tests passed.

Service forms are now correlated with their exact turn in both renderer and host. A delayed old completion cannot dismiss a new form; standalone MCP requests remain until explicitly resolved. Disconnected request IDs and transient answer drafts are cleared, and late acknowledgements cannot dismiss new-connection requests that reuse the same ID. The targeted engine regressions and interaction browser flows passed. TypeScript and 107 frontend unit tests passed after the resume-signal change.

These changes postdate the installer hash above. That installer is evidence for its recorded build, not a claim that the latest source is packaged. Real OS suspend/resume and the comprehensive concurrent-task acceptance remain open.

## Native directory-permission fault (2026-09-25)

`node scripts/native-storage-fault-smoke.mjs --permission-denied` passed on the latest debug build using a new isolated directory. An ACL denied adding files/subdirectories for the current account; the previous mirror bytes remained intact, the in-memory draft survived, window close was prevented, alternate export succeeded outside the denied directory, and restoring permission allowed retry and reload. The test removes its own deny entry during cleanup. Evidence directory: `work/native-storage-fault-1790320342529`.

The current process is not elevated, so a real isolated VHD disk-full/detach test was not performed. No system volume was filled or modified. Physical disk-full/removal acceptance remains open.

## Focused implementation follow-up (2026-09-25)

- Fixed missed turn completion recovery: final output, running state, queue settlement and obsolete question cleanup. Unknown outcomes are never replayed automatically.
- Added overlapping-directory task notice and existing worktree navigation.
- Fixed modal dismissal stealing focus from a newly focused composer.
- Localized startup errors from saved TOML, including the system-language choice.
- Scoped checks passed: TypeScript; 13 conversation/recovery/queue unit checks; 5 workspace/localization checks; 3 browser flows (modal focus, Enter/terminal shortcuts, missed failure recovery); 2 Rust startup checks. No full regression or external environment matrix was rerun.
- Master checklist uses implementation completion, with environment acceptance separately listed in DEFERRED-VALIDATION.md. Current source changes are newer than the previously recorded installer.

## Multiwindow and resource-control closure (2026-09-25)

- Three window-state tests and six engine tests passed, including shared capacity,
  duplicate task reservations, cancelled waiter cleanup, reserved stop capacity,
  correlated completion and waiting for actual terminal release before close.
- Six runtime-counter/localization tests, TypeScript production build and strict
  Clippy (`--all-targets -- -D warnings`) passed. The Windows debug desktop was rebuilt.
- The real WebView2 multiwindow flow passed with four local Responses requests:
  shared conversation updates, independent drafts, close/reopen restoration,
  isolated project working directories, single instance, hidden-main coordination,
  owner-only terminal termination, another window's command surviving that close,
  explicit command cancellation releasing capacity and final process exit.
  Evidence: `work/native-multiwindow-1790325413758`.
- Resource assertions use the lightweight native counter command. Full diagnostic
  export also scans bundled assets and is not used as a short-deadline resource poll.
- The desktop checklist marks multiwindow state ownership, compatible single
  instance and concurrency/resource lifecycle complete. Environment-dependent
  acceptance remains separate; this entry does not claim the entire checklist or
  a newly signed installer is complete.

## Final local follow-up (2026-09-25)

Native theme passed on the Windows dark desktop, including deliberate opposite browser media preference, explicit overrides and reload (`work/native-theme-1790326018282`). Three native-theme lifecycle unit tests and localization checks passed. Large-directory/file preview and offscreen sidebar keyboard regressions passed (8 focused browser flows). Directory rows are virtualized and large previews reuse CodeMirror.

Six declared local engine faults (401, 429, 503, invalid SSE, truncated stream, idle deadline) each failed explicitly after one request (`work/network-fault-1790326363923`). Production overrides now disable both request and stream retries, protected by a Rust configuration test. Real DNS/proxy chains are not claimed as tested.

The native multiwindow flow additionally passed forced host termination and restart, restoring draft/index/engine conversation history without replay (`work/native-multiwindow-1790326891369/result.json`). This is scoped host-crash evidence, not every storage fault or indefinite soak.

Final Windows installer verification passed: 102,582,732 bytes; SHA-256 recorded in RELEASE-CHECKSUMS.txt. Packaged executable matches the current optimized build, all 16 engine/legal resources match, and production test transport is disabled. Source checks: 34 Vitest files / 116 tests passed; full configured Prettier check passed. Installer is unsigned; clean-machine and external acceptance remain deferred.
