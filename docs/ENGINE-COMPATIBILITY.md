# Codex engine compatibility

FluxCode bundles an Apache-2.0 Codex `rust-v0.157.0` build with the dependency
upgrades and security backports recorded in `engine/security`. The exact binary
digests are pinned in `config/engine-release.toml`. This is a FluxCode build,
not an unmodified upstream executable.
Protocol bindings are generated with `app-server generate-ts --experimental`.
The experimental surface is pinned and covered by actual engine contract tests;
an engine update requires regenerating bindings and rerunning those tests.

## Responses effort selection

The public `turn/start.effort` field treats omission and null as inheritance.
Sending neither does **not** clear a previous selection. FluxCode instead sends
a complete default collaboration mode with `settings.reasoning_effort` set to
the selected native value, or null for Off. The Rust boundary validates the
selection and supplies its own mode and instructions.

Codex also falls back to model catalog defaults. `config/engine-models.json` is
derived from the pinned upstream `codex-rs/models-manager/models.json`, with
exactly two changes to each descriptor:

- `default_reasoning_level: null`, so Off delegates the default to the provider.
- `supports_reasoning_effort_updates: false`, so each request carries the current
  explicit choice rather than a cached baseline with history configuration updates.

All other capability metadata and prompts are preserved. Custom model IDs use
Codex's fallback descriptor, whose default reasoning level is already null.
The catalog is embedded in the host and written into its isolated engine home.
`scripts/prepare-model-catalog.mjs` reproduces the transformation from an upstream
file downloaded through the configured proxy. Upstream LICENSE/NOTICE apply.

Off omits **reasoning.effort**, not necessarily the entire `reasoning` object.
This uses the model's default effort; it does not turn reasoning off. The
[OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)
states that omitted effort defaults to `medium` for GPT-5.6, but defaults vary
by model. Reasoning summaries remain managed by Codex. Native `none` is an
explicit value and is never substituted for Off. Available native levels are
not a claim that every model supports every level; provider errors are shown
without silent fallback.

Run `node scripts/reasoning-smoke.mjs` for actual HTTP payload assertions against
the bundled engine, including known/custom models, native levels, and returning
to Off after an explicit selection. No production model account is needed.
