# Context management

Settings → Context & compaction exposes two optional token budgets. Empty fields
use the engine/model defaults. Saving reconnects the engine; active work must finish
or be stopped first. Existing TOML files without `[context]` remain compatible.

```toml
[context]
window_tokens = 200000
auto_compact_tokens = 160000
```

These map to upstream `model_context_window` and
`model_auto_compact_token_limit`. Values must be integers from 1024 through
100000000; when both are set, the threshold must be below the window. Clearing
fields removes the TOML keys. No model-specific capacity is invented; the setting
does not expand provider capacity. These are connection-wide settings. Choose
budgets supported by every model used on that connection, or leave defaults.

The status bar shows the latest engine-reported context, separately from
cumulative billed usage. The engine reserves headroom: the pinned engine reports
190000 usable tokens for a 200000 configured window. Counts are not live estimates.

Manual compaction uses `thread/compact/start`. Its immediate response acknowledges
scheduling, not completion. Turn/item notifications control progress and completion.
The GUI preserves history and drafts, prevents duplicate manual requests, and lets
users stop an active compaction. Interrupted compaction is marked unfinished.
Automatic compaction runs inside Codex at its configured threshold. Both can
summarize away earlier details; neither is a lossless transcript replacement.

Validation:
- Rust config tests: migration/defaults, bounds, invalid thresholds, TOML round trip,
  removal of overrides and preserved comments.
- Domain/UI tests: lifecycle, interruption, retained history/drafts, rejection,
  context-vs-cumulative counts, restart persistence and translated settings.
- `node scripts/context-smoke.mjs`: actual bundled engine; manual compaction,
  automatic threshold-triggered compaction, continuation and invalid-thread rejection.
- `node scripts/native-smoke.mjs`: desktop settings → Rust TOML → native compaction.

The fixtures do not call a production model or establish compatibility with every
Responses provider. No installer containing these changes has been released yet.

References:
- https://developers.openai.com/codex/config-reference/
- https://developers.openai.com/codex/app-server/
