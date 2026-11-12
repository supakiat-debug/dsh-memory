# dsh-memory

Persistent, budgeted user memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).
It keeps a small profile of *you* — preferences, language, style, environment facts — in two plain
Markdown files, hands it to the model on every step, and does it **without breaking the prompt
prefix cache** when that profile changes.

**English** · [ไทย](README.th.md)

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![node](https://img.shields.io/badge/node-%E2%89%A522.15-brightgreen)
![dsh](https://img.shields.io/badge/dsh-0.1.7--rc.2-informational)

---

## Why this plugin exists

An LLM is stateless: every model step re-sends the whole system prompt, so "re-reading memory" is
not the cost. The expensive part is **invalidating the prefix / KV cache**.

The obvious implementation registers the profile as a system-prompt *section*. That text becomes
part of the head system message (node 0). On any route that does not declare
`systemPromptUpdate: 'in-history'` — which is every `openai-completions` route, i.e. every local
`llama.cpp` / `strata` server — editing one bullet **replaces node 0**, so the request differs from
its very first token and the whole context is re-prefilled. On a local GPU that is seconds per edit,
per session, forever. Moving the section later in the prompt does not help: the system message
precedes the entire history, so any change there misses everything after it.

`dsh-memory` fixes this the same way tool results already work — **append, don't rewrite**:

```
head system message (node 0)   →  profile, FROZEN when the session first assembles
history                        →  … conversation …
last user-role message         →  memory:update snapshot, only the lines that changed
```

The harness materializes a runtime-context snapshot only when its rendered text differs from the
one it retained, so an untouched session contributes **zero tokens**, and a session that edits
memory appends a few lines instead of rewriting the head.

## What you get

- Two human-editable stores under `$DSH_HOME/memory/`:
  - `USER.md` — who the user is: language, tone, formatting tastes, recurring tasks.
  - `MEMORY.md` — environment facts, conventions, hard-won lessons.
- `memory` tool — `read` / `add` / `patch` / `remove` / `rewrite`, with a hard character budget per
  store so the profile cannot silently balloon, and duplicate detection on `add`.
- `memory_history` tool — imports recent conversations from the durable session logs
  (`$DSH_HOME/sessions/**/*.jsonl[.zstd]`, multi-frame zstd decoded with `node:zlib`) as a text
  digest of user turns, skipping system reminders, runtime-context snapshots, and the current
  session. The agent analyzes that digest itself and distils durable findings into `memory`.
- Four delivery modes (see below); `hybrid` is the cache-friendly default.

## Delivery modes (`injectMode`)

| Mode | Where the profile lives | Cost when memory changes |
| --- | --- | --- |
| `hybrid` (default) | Frozen in the system prompt **per session** + `memory:update` snapshot appended to history | A few appended lines; prefix cache survives |
| `section` | Live in the system prompt | Node 0 is rewritten → full re-prefill |
| `context` | Live as a runtime-context snapshot only | Snapshot is re-appended; head untouched |
| `off` | Nowhere — the model pulls with `memory` action `read` | Nothing, but you lose passive style-matching |

Notes:

- In `hybrid` the frozen block says so in its own text and states that the newest snapshot wins, so
  the model never treats a stale head line as current.
- Snapshots are grouped per store and per direction: `[USER PROFILE — added this session]`,
  `[AGENT NOTES — no longer current]`. Only lines that actually moved are listed.
- If a session's total delta exceeds `deltaCharLimit`, it degrades to one line pointing the model at
  `memory` action `read` instead of flooding history.
- `injectProfile: false` still works and is an alias for `off`.
- Learned text is never treated as a prompt template: the section registers with
  `interpolate: false` and every rendered block has `{{` broken apart, so a bullet containing
  `{{example}}` cannot fail assembly of the whole prompt.

## Requirements

- DSH (the `dsh` CLI / harness) — developed against `0.1.7-rc.2`.
- Node.js ≥ 22.15 (`zlib.zstdDecompressSync` for compressed session logs).
- Nothing else; `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` come from the harness.

## Install

1. Add the plugin to a DSH profile, e.g. `~/.dsh/profiles/web/package.json`:

   ```jsonc
   {
     "dependencies": {
       "dsh-memory": "github:supakiat-debug/dsh-memory"   // or "link:C:/path/to/dsh-memory"
     },
     "dsh": {
       "profile": {
         "bundles": ["dsh-memory"]
       }
     }
   }
   ```

2. Resolve it with the harness **not running** (the lockfile is held while `dsh web` runs):

   ```sh
   dsh plugin --profile web install
   ```

3. Restart the harness (`dsh web`). Plugins are loaded at boot only — after every code or config
   change, restart.

4. Verify the plugin row landed (the package ships a bundle patch that inserts the `user-memory`
   row automatically):

   ```sh
   dsh --profile web --dump-config | grep user-memory          # Windows: Select-String user-memory
   ```

5. Verify in chat: a new session must show the profile block containing `FROZEN`, and after the
   agent writes memory a `MEMORY UPDATE` block must appear at the end of the conversation (the Web
   UI shows it as a context section named `memory:update`).

## Configuration

Set in `cordis.patch.yml` (or the profile's plugin config) under `user-memory`:

| Field | Default | Meaning |
| --- | --- | --- |
| `memoryDir` | `$DSH_HOME/memory` | Where `USER.md` / `MEMORY.md` live |
| `sessionsRoot` | `$DSH_HOME/sessions` | Session logs scanned by `memory_history` |
| `userCharLimit` | `1375` | Character budget for `USER.md` |
| `memoryCharLimit` | `2200` | Character budget for `MEMORY.md` |
| `injectMode` | `hybrid` | `hybrid` \| `section` \| `context` \| `off` |
| `injectProfile` | `true` | Legacy kill switch; `false` = `off` |
| `deltaCharLimit` | `1400` | Cap for one appended snapshot before it degrades to a pointer |
| `historyDefaultSessions` | `10` | Sessions read by `memory_history` unless overridden |
| `historyMaxChars` | `60000` | Default digest size cap |

```yaml
- insert:
    - id: user-memory
      name: dsh-memory
      config:
        injectMode: hybrid
        deltaCharLimit: 1400
```

## Usage

1. Open a session — the current profile is frozen as that session's head block.
2. During the session the agent stores findings with `memory`; each write shows up as a
   `MEMORY UPDATE` snapshot at the end of the conversation. Lines no snapshot mentions are still
   current.
3. The next session freezes the updated files automatically. Baselines are kept per session
   (LRU-capped at 64) and are process-local, so a harness restart re-freezes everything.
4. To bootstrap the profile from history, just ask: *"analyze my history and build my profile"* →
   the agent calls `memory_history`, reads the digest, then writes compact bullets with `memory`
   (target `user`).
5. `USER.md` and `MEMORY.md` are yours to edit by hand — one bullet per line, budget shown by
   `memory` action `read`.

## Cache behaviour cheat sheet

| Event | Head re-prefill? | Appended tokens? |
| --- | --- | --- |
| Step with no memory change | No | 0 |
| `memory` write during a session | No | delta only (≤ `deltaCharLimit`) |
| New session after edits | Yes, once (new baseline) | 0 |
| `injectMode: section` + any write | Yes, every write | 0 |

## Development

```sh
npm test                         # node --import ./test-register.mjs test-smoke.mjs
DSH_MEMORY_TEST_HISTORY=1 npm test   # additionally exercise memory_history against your own logs
```

The suite is hermetic: `memory_history` is tested against a synthetic zstd session log created in a
temp directory, so it never reads real conversations unless you opt in with the env var above. CI
(`.github/workflows/ci.yml`) runs it on Node 22.15, 22.x and 24.x against the committed lockfile.

The smoke test runs the plugin against a mock Cordis context. A tiny ESM resolve hook
(`test-hooks.mjs` + `test-register.mjs`) stubs the harness-provided peer dependency
`@deepseek-ai/dsh-tools`, so no `node_modules` trickery is needed. It covers: the frozen head
staying byte-identical across writes, snapshots containing only the delta, per-session baselines
being independent, empty stores, duplicate/limit handling, every `injectMode`, unknown modes
failing loudly, and `{{…}}` never surviving into rendered prompt text.

## How it hooks into the harness

- `systemPrompt.section()` — ordered text contributions to the head system message.
- `systemPrompt.context()` — ordered dynamic runtime contexts, joined into one user-role snapshot
  that the loop appends only when its text changed. `memory:update` uses order `130`, after the
  sandbox (110), approval (115) and subagent (120) contexts.
- `dsh-agent-loop` — `SystemPromptProjection` replaces node 0 on routes without in-history system
  prompt updates; `RuntimeContextProjection` appends. That asymmetry is the whole design.
- `dsh-time-context` — prior art for a pre-step snapshot that only appears when due.

## Limitations

- Baselines live in memory, so a harness restart re-freezes (that is also how you force a fresh
  baseline mid-day).
- Snapshots are line-based: editing a bullet shows as one added and one superseded line.
- `memory_history` reads every workspace's logs under `sessionsRoot`; point it elsewhere or filter
  with the `workspace` argument if you keep several machines in one directory.
- `off` mode is the only mode that does not inject anything — expect the agent to ask or to call
  `memory read` when it needs the profile.

## Credits

Ideas borrowed from OpenClaw (workspace `USER.md` / `MEMORY.md`) and Hermes Agent (memory budgets,
background review, history import).

## License

MIT — see [LICENSE](LICENSE).
