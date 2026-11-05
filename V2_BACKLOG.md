# v2 backlog

Everything deliberately left out of the MVP (v1) and meant for v2, so nothing gets lost.
Add to this file whenever something is deferred. `PLAN.md` stays the source of truth for v1.

## From PLAN.md

### Execution engine (PLAN.md 3.2)
- Running workflows: calling LLMs, enforcing tool scopes and limits, running evaluators.
- Executing the `summary` context mode (the summarizer LLM call). v1 only stores its config.
- Run history and logs.
- Tracking actual token spend. Token *estimates* are a permanent non-goal, not v2 work.
- API keys: used by the engine and kept on the user's machine (PLAN.md 5.1). API key management is a v1 non-goal.

### Run semantics already decided in PLAN.md, to implement in v2
- **Agent limits exceeded** (iterations, tokens, wall time): the run halts and requests human attention (PLAN.md 7.6, [default]).
- **Loop cap reached without an `onExhausted` exit:** stop and request human attention (PLAN.md 7.4, [default]).
- **Deterministic evaluator contract** (PLAN.md 7.4, draft):
  - the code receives the decision's input
  - exit code 0 selects the first exit, and non-zero selects the second
  - optional JSON on stdout supplies notes or a custom exit label (the UI documents it as `{"notes": …}` and `{"exit": …}`)
- **Decision nodes** pass their input through on the chosen exit, together with the evaluator's notes.
- **Joins** `all` / `any` / `n-of-m` and the loop-edge `history` toggle (`latest` / `all`).
  - Loop-back edges and shared-store reads don't count as join inputs: an edge coming back round a loop re-runs its target with the latest of its other inputs (PLAN.md 7.5, agreed in M4).
- **`onExhausted`** on a capped decision exit: `halt` (stop and ask a human, the default) or take another exit of the same decision.

### Other v2 features (PLAN.md 3.2)
- Workspace rollback via git checkpoints during runs. The workspace is already required to be a git repo for this.
- A language-agnostic contract for deterministic evaluators (any language, not just Python).
- A visual drag-and-drop builder for deterministic evaluations (similar to Apple Shortcuts).
- Custom tools, e.g. MCP servers.

### Before finishing the MVP
- Go through the design-for-v2 checklist in PLAN.md section 12. It confirms a v2 engine can run a saved workflow without schema changes.

## Deferred during implementation

| Date | Milestone | Item | Notes |
|---|---|---|---|
| 2026-11-04 | M1 | Drag-to-reorder an agent's skills and tools | No functional effect in v1. In v2 the order decides how they appear in the agent's context. The order is already stored (arrays), so no schema change is needed. |
| 2026-11-04 | M1 | Skill folder names when handing skills to an agent runtime | The Agent Skills format expects the folder name to match `name`. Library folders are named by id (`<slug>-<suffix>`), so v2 should write correctly named folders when it gives skills to an agent. |
| 2026-11-04 | M2 | Canvas autosave | PLAN.md 9.3 originally had autosave of the draft branch. Dropped for v1 in favour of explicit Save, for consistency with every other editor and a clean git history. If added in v2, decide how often it commits (e.g. after a few idle seconds) and group autosaves in the history. |
| 2026-11-05 | M5 | Workspace repo root shown in symlink-resolved form | When a typed workspace path is inside a repo and goes through a symlink (macOS `/tmp`, `/var`; user links like `~/code` → `/Volumes/Dev/code`), "Use <repo root>" shows and stores git's resolved path (`/private/tmp/app`) instead of the typed form. Cosmetic: the check itself compares resolved paths and is correct. Fix before release by mapping git's root back to the typed path. Only the test was fixed for now. |

## Open questions for v2
- How should a skill's `allowed-tools` frontmatter interact with the agent's tool presets? Ignore it, warn when they disagree, or intersect the two? In v1, tool access comes only from presets.
- Order of skills and tools in the agent's input, and keeping it stable for prompt caching.
