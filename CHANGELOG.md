# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-11-12

### Fixed

- The oversized-delta fallback no longer travels under the delta header. It sent the whole current
  profile while still promising "every other line of that block is still current" — the precise
  opposite of what a full profile means, because a full profile is what survives and everything not
  restated is gone. Cleared stores were the damaging case: `sectionsFrom` skips empty stores, so
  wiping `USER.md` produced a snapshot that reported the deleted profile as intact, and the model
  kept acting on — and offering to restore — memories the user had just removed.
- A restated profile now declares itself `=== MEMORY UPDATE — FULL REPLACEMENT (this session) ===`,
  states that it replaces the frozen block in full, tells the model not to carry unlisted lines
  forward, and names **every** store: an empty one reads `[empty — 0/N chars]` followed by "nothing
  is saved in this store any more", which is the difference between a wipe and a typo.

## [0.3.0] - 2026-11-12

### Changed

- An oversized snapshot no longer degrades to a pointer at `memory read`. A whole-store `rewrite`
  produced a ~3.6k-char line diff, blew past `deltaCharLimit`, and left the model with a note telling
  it to go read the profile — which costs the same text anyway, plus a round trip. The snapshot now
  carries the current full profile (still append-only, still bounded by the store budgets) with a line
  explaining that the diff was dropped.

## [0.2.0] - 2026-11-12

### Added

- `injectMode` with four delivery modes. The new default, `hybrid`, freezes the profile block per
  session and delivers later edits as an append-only `memory:update` runtime-context snapshot, so a
  memory write no longer rewrites the head system message (node 0) and no longer forces a full
  prefix-cache miss on routes without `systemPromptUpdate: 'in-history'` — that is every local
  `llama.cpp` / `strata` route.
- `section` (the previous behaviour), `context` (live profile as runtime context only) and `off`
  (nothing injected) are selectable, so the old prompt bytes are still one config line away.
- `deltaCharLimit` — an oversized per-session delta degrades to a single line pointing the model at
  `memory` action `read` instead of flooding history.
- Per-session baselines (LRU-capped at 64) resolved from the assembly's session id, so concurrent
  sessions freeze independently.
- `README.th.md` (Thai) alongside the English README.

### Changed

- `injectProfile: false` is now an alias for `injectMode: off`; the option keeps working.
- Profile files are read at most once per change signature (mtime + size) and reused across the
  frozen block, the live block and delta computation.
- `{{` in learned text is broken apart at render time and the frozen section registers with
  `interpolate: false`, so a memory bullet can never fail prompt assembly as an unknown variable
  reference.
- The `memory` tool result now states how the write will reach the model in the active mode.
- English README rewritten around the cache-invalidation problem; Thai README kept as a mirror.

### Fixed

- A memory bullet containing `{{name}}` used to throw on every later prompt assembly (contexts are
  always interpolated and have no opt-out).

### Testing

- `npm test` runs the smoke suite against a mock Cordis context through an ESM resolve hook that
  stubs the harness-provided `@deepseek-ai/dsh-tools`; no `node_modules` junctions required.
- The suite is hermetic: `memory_history` runs against a synthetic zstd session log built in a temp
  directory. Reading real logs is opt-in via `DSH_MEMORY_TEST_HISTORY=1`.
- Coverage: byte-identical frozen head across writes, delta-only snapshots, independent baselines per
  session, empty stores, duplicate and budget handling, all four modes, unknown modes failing
  loudly, brace sanitization, history filtering (non-user sources, angle-bracket injections,
  assistant turns, current session, workspace filter).

## [0.1.0] - 2026-10-17

### Added

- `USER.md` / `MEMORY.md` stores under `$DSH_HOME/memory` with per-store character budgets.
- `memory` tool (`read` / `add` / `patch` / `remove` / `rewrite`) with duplicate detection.
- `memory_history` tool importing user turns from `$DSH_HOME/sessions/**/*.jsonl[.zstd]`, decoding
  concatenated zstd frames with `node:zlib`.
- Live profile injected as a system-prompt section (`memory:profile`, order 150).
