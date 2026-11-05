# Decisions

Decisions made during implementation where `PLAN.md` was silent or left a choice open.
Format: date, milestone, decision, reason.

## 2026-11-03 (M0)

### Tooling
- **Fastify** (not Hono) for the server. Reason: named first in PLAN.md 5.2, mature plugin ecosystem, `inject()` makes API tests easy.
- **TypeScript pinned to 6.0.** Reason: TS 7 (native) is not yet supported by `typescript-eslint`.
- **No TS build step for workspace packages.** `@app/schema` exports its `src/index.ts` directly. Each package typechecks with `tsc --noEmit`. The server runs with `tsx`, and the web app goes through Vite. Reason: simplest setup, no build ordering or stale `dist`. Revisit when packaging `npx app`.
- **Vitest** for tests (one root config), **ESLint** with `typescript-eslint` strict and `react-hooks`, **Prettier**. `pnpm check` runs typecheck, lint and tests.
- pnpm was installed with `npm install -g pnpm --prefix ~/.local` because Fedora's Node build has no corepack. `packageManager` is pinned in `package.json`.

### Library store and git
- **Location:** `~/.app/library` by default. The env var `APP_HOME` overrides the base folder (used by tests and isolated dev runs).
- **M0 writes commit straight to `main`** in the library store's working tree. Reason: draft branches belong to M2. **The worktree-vs-plumbing choice from PLAN.md 8.1 is deliberately deferred to M2.**
- **Reads always go through git objects at a ref** (`git ls-tree` / `git show main:<path>`), never through the working tree. Reason: M2 can read other versions and branches with the same code.
- **One commit per create, update or delete.** Messages look like `Create agent planner-k3x9qa (Planner)`. An update that changes nothing makes no commit, and the API returns `commit: null`.
- **Git operations are serialized** through an in-process queue. If a write fails, the touched paths are rolled back to `HEAD`.
- **Commit identity:** the user's git identity if configured, otherwise a repo-local fallback `app <app@localhost>`.
- **Commit and tag signing are disabled in the library repo only** (repo-local `commit.gpgsign=false`, `tag.gpgsign=false`). Reason: the app commits on every save (autosave later), and global signing with a hardware key blocked every write waiting for a touch. The user's global config and their own repos are not touched. Confirmed by the user on 2026-11-03.
- On first start the store gets a `README.md`, a `.gitkeep` per kind folder, and an `Initialize library store` commit.

### File layout details (PLAN.md 5.4)
- **The entity id is never written inside files.** It is the file or folder name (`agents/<id>.yaml`, `skills/<id>/SKILL.md`). Reason: a single source of truth, so the two can't disagree.
- `pattern.yaml` and `templates/<id>/workflow.yaml` hold `name`, `description`, `nodes`, `edges`. Projects split into `project.yaml` (`name`, `description`, `workspacePath`, `overrides`) and `workflow.yaml` (`nodes`, `edges`). `layout.json` holds view state only.
- YAML is written without line folding, with keys in schema order, so diffs stay stable.

### SQLite index
- Stored at `~/.app/index.db`, **outside** the library repo. Reason: it's derived data.
- Tables: `entities` (kind, id, name, description) and `refs` (from → `{kind, id, version}`), plus `meta` holding the library HEAD the index was built from and an index schema version.
- **Rebuilt automatically** on startup when the file is missing, its schema version changed, or its recorded HEAD differs from the library HEAD (e.g. after a manual commit). Also rebuilt on demand with `POST /api/index/rebuild`, which deletes and recreates the file. Entities that fail validation are reported in `invalid` and left out of the index; they don't fail the rebuild.
- Listing and search (`?q=`) come from the index. Single-entity reads come from git.

### API
- Generic REST: `GET|POST /api/<kinds>`, `GET|PUT|DELETE /api/<kinds>/<id>`, `GET /api/<kinds>/<id>/references`, `GET /api/health`, `POST /api/index/rebuild`. `PUT` replaces the whole entity. An `id` in the body is ignored; the server assigns ids. Errors use `{ error, message, issues? }`.
- API on `127.0.0.1:4317` (`PORT`). Vite dev server proxies `/api`. Set `APP_NO_OPEN=1` to stop the browser from opening.

### Schema (`packages/schema`)
- **Entity id** = `<slug>-<6 random [a-z0-9]>`, e.g. `planner-k3x9qa`.
- **`Ref.version`** is `v<n>` or a branch name. Branch names may not look like `v<n>` and contain no `/`; the server will namespace git branches as `<kind>/<id>/<branch>` in M2.
- **Skill name and description follow the Agent Skills format.** The name uses lowercase letters, digits and single hyphens, at most 64 chars. The description is required, at most 1024 chars. The standard also says the name should match the folder name, but our folders are ids, so that rule is not enforced. Extra frontmatter fields are currently dropped on save.
- **Tool preset scopes are strict per built-in.**
  - Path built-ins: one or more workspace-relative globs. Absolute paths and `..` are rejected.
  - `shell`: a list of `{match: exact|prefix, command}`. An empty list means unrestricted, detected with `isUnrestrictedShell()`, so no separate flag can drift out of sync.
  - Web built-ins: optional `allow`/`deny` domain lists.
- **Built-in tool catalog** is a constant in the schema, not stored in the library.
- **Agent nodes** have a `binding`: `{kind: 'agent', agent: Ref}` in workflows, or `{kind: 'slot', role, description, defaultAgent?}` in patterns. Agent evaluators on decisions use the same binding type, because the Router pattern's router is a slot. Pattern-node `bindings` are keyed by the slot's node id inside the pattern. A nested pattern binds an inner slot to a new slot of the outer pattern. The rule that workflows use only concrete agents and patterns only slots is left to validation (M4/M5).
- **Decision exits** are ordered (for deterministic evaluators, exit code 0 picks the first). An exit's `id` is the edge's `source.port`. `maxIterations` and `onExhausted` (`halt` | `{exit}`) live on the exit.
- **Join mode** is an optional field on every node. Requiring it for nodes with more than one incoming edge is a validation rule (M4).
- **Edge `payload`** is stored, even though the editor infers it from the source. Reason: v2 needs every edge fully specified (PLAN.md 12).
- **Context mode configs:**
  - `excerpt` selector: `heading` | `jsonPath` | `lines`
  - `diff` base: `workspace-head` | `previous-iteration`
  - `summary`: `model` and an optional `instruction`
- **Tool step arguments** are a string map (e.g. `{command: "npm test"}`). Shapes per built-in can be tightened in M3.
- **Project overrides** are keyed by agent-node id and strictly limited to `model`, `effort`, `limits` (partial).
- **Expanded pattern nodes** are stored in `layout.json` (`expanded: [...]`), since collapse/expand is view state.
- `WorkflowGraph` checks structural integrity in the schema: unique node and edge ids, and edges must point at existing nodes. Workflow rules (PLAN.md 9.5) are validation, not schema.
- The `Settings` schema (model list, agent defaults) is defined now. Storing settings and their API come in M1.

### Web
- **react-router** for tab routing (approved). shadcn/ui is set up with `components.json`, the `@/` alias and the zinc theme. The UI shows the placeholder name "Workflow Designer" until a name is chosen.

## 2026-11-03 (M1)

### Agreed at planning (approved by the user)
- **References pin `v1` until M2.** M2 will tag each entity's current state on `main` as `v1` when it first runs, so "merging creates v2" stays correct.
- **Settings live in `library/settings.yaml`** and are committed like everything else.
  - Written with defaults when a library is initialized, or when an existing library has none (commit `Add default settings`).
  - The library location is shown read-only. Change it with `APP_HOME`.
- **Default model list:** `anthropic` Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1. Agent defaults: Sonnet 5.5, medium effort, 20 iterations, 200k tokens, 600 s.
- **Deleting a referenced entity is blocked.** `DELETE` returns `409` with the referencing entities, and the UI lists them with links. M6 replaces this with the full flow (show references, convert to local copies).
- **Models removed from Settings while agents still use them:** allowed. The agent editor shows a "not in model list" warning.
- **No version or branch indicator in editors yet.** That is M2.
- **Libraries:** Monaco (`monaco-editor`, `@monaco-editor/react`). `cmdk` and `sonner` came with their shadcn components. `@playwright/test` is a dev dependency. No react-hook-form or TanStack Query.

### Made during implementation
- **The index caches each full entity as JSON** (index schema v2; old indexes rebuild automatically). `GET /api/<kind>?full=1` returns complete entities from the index, so lists can show scopes, models and badges without reading git per item. Single reads still come from git.
- **The web client caches complete entity lists per kind in Zustand.** Editors start from the cached entity and update the cache from the save response.
- **Monaco is bundled locally**: the editor core, markdown and python syntax, and one generic editor worker. It is lazy-loaded, so the rest of the UI doesn't wait for it (about 2.7 MB, in its own chunk).
- **Validation runs in the browser with the shared Zod schemas** and again on the server. Field errors appear after the first save attempt, then update live.
- **Editors mount only once their data is ready** (`useEditorSource`), so their state initializes directly, without effects.
- **The unsaved-changes guard** uses react-router's `useBlocker` plus `beforeunload`. Navigation after a save or delete passes `state: { skipGuard: true }` to go through.
- **Ctrl/Cmd+S saves** in every editor and in Settings.
- **Skill names are normalized as you type** to the Agent Skills format: lowercase, spaces become hyphens, invalid characters dropped.
- **Tool presets:**
  - The built-in is fixed after creation, because each built-in has a different scope shape.
  - A new shell preset starts with one empty command row, so going unrestricted takes a deliberate removal.
  - A new path preset starts with one empty glob.
  - Path presets need at least one glob.
- **Settings reject duplicate models** (same provider and model id).
- **Toasts sit bottom-left.** Bottom-right toasts covered the right-aligned pickers, and hovering a toast pauses its dismissal.
- **The sonner theme is fixed to light** (no `next-themes`) until dark mode in M7.
- **E2E tests use the installed Chrome** (`channel: 'chrome'`, no browser download). Each run gets a fresh temp `APP_HOME`, with the API on :4417 and the web app on :5299.
- The `shadcn add` alias bug happened again. It installed the unrelated `cn` and `next-themes` packages. Both were removed and the imports fixed by hand.

## 2026-11-04 (M1, follow-up)

### Advanced skill frontmatter (requested by the user)
- **The Skill schema models every optional field in the Agent Skills format:**
  - `license`
  - `compatibility` (at most 500 characters)
  - `metadata` (string → string)
  - `allowedTools`, written to the file as the space-delimited `allowed-tools`
- **Any other frontmatter key is kept as written** in `extraFrontmatter`. It may not redefine a standard key. Hand-written or imported skills no longer lose fields when edited in the app.
- **Reading metadata:** scalar values (`version: 2`) are read as strings, because the standard defines metadata as string → string. `allowed-tools` is also accepted as a YAML list, and is always written back as a space-delimited string.
- **One SKILL.md converter** (`packages/schema/src/skill-md.ts`) turns skills into file text and back. Both the server and the web app use it, so the raw editor shows exactly what goes on disk. `yaml` became a dependency of `@app/schema` for this.
- **UI:**
  - Advanced options are hidden behind an **Advanced** button. It shows a count when advanced fields are set, so nothing is set invisibly. The choice is remembered per browser (`localStorage`).
  - When on, the editor widens and an advanced panel appears beside name and description.
  - A **Form | SKILL.md** switch edits the raw file, which is the standard format for skills.
  - Invalid YAML (raw file or the other-fields box) blocks saving and switching back to the form.
- **Change detection ignores key order**, so switching between the form and the raw file never shows false unsaved changes.
- **`allowed-tools` is informational only.** Agents get tool access from their presets alone. How the two should interact is an open v2 question (`V2_BACKLOG.md`).

### Process
- **`V2_BACKLOG.md` collects everything deferred to v2.** CLAUDE.md now says to add to it whenever something is deferred.
- **Deferred to v2:** drag-to-reorder an agent's skills and tools. It has no functional effect in v1, and the order is already stored.
- **Bundle size:** no action, by the user's decision.

## 2026-11-04 (M2)

### Versioning mechanism
- **Plumbing, not `git worktree`** (the PLAN.md 8.1 choice). Every commit is built on a temporary index (`read-tree`, `hash-object`, `update-index`, `write-tree`, `commit-tree`). Refs move with one atomic `git update-ref --stdin` transaction.
  - Reasons:
    - nothing is ever checked out, so editing one entity can never touch another
    - no per-branch checkouts to create and clean up
    - a merge, its version tag and deleting the draft happen together or not at all
- **All writes use plumbing,** including creates, deletes and settings on `main`. After `main` moves, only the touched paths of the working tree are synced. The library folder stays a readable mirror of `main`, and `git status` stays clean.
- **Main versions are lightweight tags** `<kind>/<id>/v<n>`. An entity's current version is its highest tag. **Branches** are `<kind>/<id>/<branch>`.

### Drafts and merging
- **Every library kind is versioned this way,** including patterns, templates and projects. Whether project canvas autosave (M3) should commit to a draft is left to M3.
- **Creating an entity commits it to `main` and tags `v1`.** Only edits go through a draft. Reason: new entities can be referenced right away, and the done-when ("merging creates v2") follows naturally.
- **One automatic `draft` branch per entity.** The first save creates it from the current `main`; later saves add commits to it. A save that changes nothing makes no commit and creates no branch. Named branches arrive with forks in M5; the API and history already handle any branch name.
- **Merge** gives `main` the entity's files exactly as they are on the draft:
  - it is a two-parent merge commit, `Merge agent <id> (<name>) as v3`
  - other entities on `main` are untouched, so a draft started before another entity was merged is not a conflict
  - the next version is tagged and the draft is deleted
- **Merge conflicts:** a merge is refused (`409 merge_conflict`) when `main`'s copy of the entity changed since the draft started. With one draft per entity this only happens through edits made outside the app. `force: true` merges anyway, replacing `main`'s copy.
- **Merging a draft identical to `main`** is refused (`400 bad_request`); the UI offers Discard instead.
- **Deleting an entity also deletes its branches.** Version tags stay, so old versions remain in git history.
- **Existing entities are tagged `v1` on startup.** This covers entities from M0/M1 and files added by hand. It keeps the `v1` pins from M1 valid.
- **Settings are not versioned.** They commit straight to `main`; PLAN.md 8 does not list them.

### Reads and the index
- **Reads accept `?ref=`:** `main` (the default), a version (`v2`), a branch (`draft`) or a commit hash. History and diff use the same resolution.
- **The index reflects `main` only.** Lists show `main`'s content plus each entity's version and a draft flag. These come from the git refs on each request and are not stored in the index.
- **Deleting is checked against references on `main` only.** A reference that exists only on a draft does not block deleting its target. M6 owns the deletion-with-references flow.
- **History** lists main versions (from the tags) and each branch's unmerged commits. A version's date and message come from the commit on `main` that last changed the entity (`git log --first-parent`), so a migrated `v1` shows its real last edit.
- **Diff** returns the raw files (YAML or SKILL.md) that differ, before and after. The raw text is what is stored and versioned.

### M2 follow-up (2026-11-04)
- **Deleting referenced entities (PLAN.md 8.4 updated, built in M6):**
  - only references from versions on `main` count; references that exist only on a draft never block or prompt
  - the user confirms, then chooses for the referencing entities, for all at once or for each one: keep as a local copy, or replace with a "deleted" placeholder showing the last known name and version
  - Reason: user decision. A draft is not materialized, so a dangling reference there is acceptable.
  - Until M6, deleting an entity referenced from `main` stays blocked.
- **Merge notes:** merging takes an optional one-line note ("What changed?", at most 200 characters, whitespace collapsed).
  - It is stored as the body of the merge commit, so it lives in git with no extra file.
  - The history shows it under the version instead of the generic "Merged from the draft".
  - M6 update notifications can list the notes between two versions as a changelog.
- **No canvas autosave in v1 (PLAN.md 9.3 updated).** The canvas saves explicitly (Save / Ctrl+S, to the draft branch) with the unsaved-changes guard, like every other editor. Reason: user decision. It keeps editors consistent and git history clean, and saving is already safe because `main` only changes on merge. Autosave is in `V2_BACKLOG.md`.

## 2026-11-04 (M3)

### Scope agreed at planning
- **Decision nodes in M3:**
  - built here: the evaluator type, a plain code box (deterministic), agent + criteria, human instructions + feedback toggle, and the exits list (label, max loops)
  - left for M4: the Python Monaco editor with file drop, `onExhausted`, join modes and every validation rule, including "a back-edge without a cap blocks saving"
- **Agent forks (lite):**
  - **Customize for this project** creates the branch `fork-<project id>-<node id>` at the pinned version, and the node pins that branch. It shows "modified".
  - **Edit fork** opens the normal agent editor with `?branch=`; Save commits to the fork branch only.
  - Not built yet: promoting forks (merge, or save as a new agent) and deleting them, both M5/M6.
  - Reason: agreed at planning.
- **Templates:**
  - **Save as template** copies a project's workflow and layout (not overrides or workspace) into a new template, and New project can start from one.
  - There is no template editor.
  - A template made from a project with forks keeps pinning those fork branches.

### Workspace
- **Rules:**
  - the path must be absolute (`~` is expanded) and point at an existing folder that is the root of a git repo
  - for a folder inside a repo, the UI offers the repo root
  - for a plain folder, it offers `git init` after confirmation
  - the library store, and folders containing it, are refused
  - the path is stored expanded
- **When it's checked:** when a project is created and whenever its path changes, not on every save. A workspace that disappears later doesn't block saving the project.
- **Folder suggestions** come from `GET /api/workspace/suggest`, which lists folders only (hidden ones only when typed) and marks git repos.

### Canvas
- **Connections:**
  - **refused:** anything into an Input, out of an Output, to or from a Note, a node to itself, a decision without choosing an exit, and duplicates
  - the reason is shown as a toast, including when dropping on a node without a handle
- **Payload inference:**
  - Input → its payload type; Artifact → file; a Decision exit → its input's payload; everything else → text
  - edges into a shared store default to write access, edges out of one to read
- **Loops:** loop edges are found with strongly connected components. An edge "in a loop" gets the history toggle; the edge that closes a loop (a back-edge, from a depth-first walk starting at the Inputs) is drawn curved under the nodes with its cap badge. History left unset means "latest only", the PLAN.md default.
- **Placing nodes:**
  - quick-add (`Ctrl/Cmd+K`) and palette clicks add the new node after the single selected node and connect it (from a decision's first unconnected exit); otherwise it goes to the view's center
  - new nodes never overlap others, and the view pans to them
  - the palette also supports drag and drop
- **View:** pan and zoom are not saved; a project opens zoomed to fit. Only node positions (and note sizes) go to `layout.json`.
- **Undo/redo:** a per-session history of project snapshots, 200 steps. Typing in one field, or dragging, counts as one step. It survives saves and is cleared on reload.
- **Copy/paste:** copying keeps the nodes, the edges between them and their agent overrides for the session, so they can be pasted into another project.
- **Blank projects** start with an unconnected Input and Output.
- React Flow node types are prefixed `wf-` so React Flow's built-in `input`/`output` styles never apply.

### M3 follow-up: creating the workspace folder (2026-11-04)
- **New project creates its workspace folder by default** (user request).
  - The dialog has **New folder** (default) and **Existing repo**.
  - New folder takes a location and a folder name. The name follows the project name, slugified, until edited.
  - The full path is shown and checked before anything is created: nothing may exist there yet, it must not be inside the library store, and missing parent folders are created. A new repo nested inside another git repo is allowed, with a warning.
- **The folder is created in the same request as the project** (`POST /api/projects?createWorkspace=1`). The server validates the project first, then creates the folder and runs `git init`, then creates the project. A rejected project never leaves a folder behind.
- **The last location is remembered per browser** (`localStorage`), defaulting to `~/`. Reason: a convenience, not data worth versioning in Settings.
- `git init` is the only thing run in the new folder. No files or commits are added.

## 2026-11-05 (M4)

### Agreed at planning (user decisions)
- **Loops:** every loop must pass through a decision exit with Max loops. Once the capped exits are taken out, nothing may still go round in a circle.
  - A loop without any decision (agent → agent → back) is not allowed, because nothing could stop it.
  - Uncapped loops block **saving and merging**, in the UI and on the server.
  - The user first asked for agent → agent loops capped on the agent, then withdrew that: a decision can use an agent as its evaluator, so a decision covers that case. All 10 built-in patterns already loop through a decision. In four of them (Supervisor, Handoff, Moderated discussion, Blackboard) the edge that closes the loop runs agent → agent, and the cap sits on the decision exit inside the loop. The rule handles that correctly.
  - PLAN.md 7.4 updated.
- **Errors block merging; only uncapped loops block saving.** Work in progress can always be saved, but a version on `main` must be complete. Warnings block neither. The server checks both (`400 workflow` with `problems`). Merging runs every rule, including those that need the library (tool coverage, missing references). PLAN.md 9.5 updated.
- **Join inputs:**
  - loop-back edges and reads from a shared store don't count as join inputs: a loop-back re-runs its target with the latest of its other inputs, and a store read is access, not a trigger
  - shared stores never need a join
  - there is no automatic default: a second input shows an error with a one-click **Wait for all inputs** fix
  - PLAN.md 7.5 updated; v2 semantics added to `V2_BACKLOG.md`
- **The pattern rule** (unconnected port, unbound slot) moves to M5, when patterns can be placed.
- **Glob coverage** uses `picomatch` (the one new dependency, in `@app/schema`).
  - A literal path is covered when a tool glob matches it.
  - A glob path (e.g. an artifact `src/**`) is covered only when containment is clear: the same glob, `**`, or a `dir/**` above it.
  - Anything else counts as not covered, and the message lists the tool's globs.

### Validation
- **One pure function, `validateWorkflow(graph, resolver?)`** in `packages/schema`, used by the canvas (on every change) and by the server.
  - Without a resolver it runs the graph rules only; that is what the server uses on save.
  - The resolver supplies pinned agents and tool presets. While one is still loading (`undefined`), the rules that need it are skipped instead of guessing.
- **Rules:**
  - the PLAN.md 9.5 list (except patterns)
  - `no-input`, `join-too-large`, `single-exit` (warning), `exhausted-exit` (the `onExhausted` exit no longer exists), `evaluator-incomplete` (warning: no code, criteria or reviewer instructions yet), `missing-ref` (pinned agent or preset no longer exists)
  - `reference-not-file`: reference mode from something that isn't a workspace file
- **Which edge a reference or write checks:**
  - reference mode traces back through decisions to the content they pass through; an Artifact's path or an Input's attached files are what must be readable
  - the read tool is `read_file`; writes need `write_file` or `edit_file`
  - evaluator agents count as receivers for reference mode
- **Problems have stable ids, the affected nodes and edges, the place to jump to, and an optional fix** (`join-all`, `cap-exit` at 3 loops), applied with `applyFix`.

### UI
- **Problems bar** under the canvas:
  - error and warning counts, and what is blocked
  - expands to the list; clicking a problem selects it and zooms to it
  - fixes are buttons
- **On the canvas:**
  - red or amber outlines and a corner marker on nodes (the messages show as a tooltip)
  - red edges for errors
  - the `max N` badge sits on the capped exit edge, `no cap` on the edge reported for an uncapped loop
  - a join chip (`join all`, `join 2 of 3`, red `join?`) on nodes with several inputs
- **The inspector** lists the selected item's problems at the top. Nodes with several inputs get a Join field (Wait for all / Any one / Some, with N).
- **Merge** is disabled with an explanation while there are errors. Saving with an uncapped loop is refused with a toast, and the problem is selected.
- **Decision editor:**
  - Monaco Python editor with a language select (Python only) and an Expand dialog
  - **Load file…** and drag and drop of `.py` files, at most 256 KB; `sourceFileName` is kept and shown
  - Monaco would take the drop and insert the path, so the drop is caught in the capture phase
- **Exits** can be reordered (the first is exit code 0). A capped exit has **When the cap is hit**: stop and ask a human (`halt`, the default) or take another exit. Clearing a cap clears it.
- **Switching the evaluator type** swaps the exits only while they are the old type's untouched defaults and unconnected: deterministic `pass/fail`, human `approve/reject`; agent keeps the current ones.
- **Context preview** opens from the agent inspector, or with `P` on a selected agent node, as a side panel:
  - header: version or fork, model, effort and limits, with project overrides highlighted
  - 1 prompt, 2 skills (expandable bodies), 3 tools with scopes, 4 inputs
  - each input is one line in plain words from `describe-context.ts` (unit tested); loop inputs show their history, and related problems show inline
  - no file contents (the app doesn't read workspaces) and no token figures
- **The e2e reload check** in the M3 demo test now compares screenshots with a small tolerance (≤ 200 pixels, ≤ 64/255 each), because problem outlines and long thin edges antialias slightly differently depending on when they render. Node positions and problem markers are still compared exactly through the DOM.

### M4 review answers (2026-11-05, user decisions)
- Projects from M3 with an uncapped loop stay unsaveable until capped (the fix is offered). No migration.
- Unclear glob coverage stays an **error**, not a "can't confirm" warning. To revisit later.
- Moving toasts away from the problems bar is polish for M7.
- A context preview for evaluator agents in decisions is deferred (not scheduled yet).

## 2026-11-05 (M5)

### Before the milestone
- **better-sqlite3 is no longer in `onlyBuiltDependencies`.** Version 13 ships prebuilt binaries for every platform and has no install script. Listing it made pnpm run an implicit `node-gyp rebuild` (the package contains `binding.gyp`), which fails when `node-gyp` isn't installed. pnpm now prints an "Ignored build scripts" warning on install; it is harmless, and `pnpm approve-builds` must not be used for it.
- **Server tests resolve their temp folder with `realpathSync`.** On macOS `/var` links to `/private/var`, and git reports repo roots in resolved form, so the `inside-repo` test failed there (development was on Fedora until now). The app's behaviour is unchanged: the "Use <repo root>" suggestion shows the resolved path when the typed path goes through a symlink. User decision: fix only the test for now; the display issue is in `V2_BACKLOG.md` to revisit before release.

### Agreed at planning (user decisions)
- **"Choose N" uses repeat groups.** A pattern marks groups of nodes as repeatable (`repeat: [{id, label, nodes, mode, min, max, default}]` in `pattern.yaml`); an instance stores its chosen N per group (`repeat` on the pattern node). Choosing N never forks.
- **Joins on pattern ports:** `portJoins` on the instance, one join mode per input port.
- **Fork internals are edited in the pattern editor** on the fork branch (like **Edit fork** for agents), not inside the expanded frame. Expanded stays view state only.
- **Overrides for agents inside instances** are keyed by node path (`review-k2f8/maker`).
- **Every input port is required; output ports are optional.** No per-port setting in v1.
- **Agent fork promotion is built in M5** too (merge to main as the next version, or save as a new agent), with the same flow as pattern forks. User decision.

### Schema
- **Node paths** (`NodePath`) name nodes inside instances: node ids joined by `/`, with `@k` for the k-th copy of a repeated node (`team@1/worker@2`). The first segment is always the node of the outer graph. They key slot bindings (relative to the pattern) and project overrides (relative to the workflow).
- **Repeat group semantics** (`expandRepeats`):
  - edges inside the group are copied per copy
  - `parallel` (default): edges into and out of the group connect every copy (fan-out, fan-in); a decision exit leading into the group becomes one exit per copy (`worker@2`, "Worker 2") with the same cap
  - `chain`: copy 1 gets the group's inputs, the last copy feeds its outputs, and copy k hands over to copy k+1 like the group's input edges describe (Pipeline)
  - copied slots are numbered ("Worker 2"); counts are clamped to `min`..`max`
- **Slots of nested patterns are slots of the outer pattern** under the nested node's path (`team@1/worker@2`). Inside a pattern, a nested instance's `slot` binding only renames a slot (role, description, default agent); concrete agents there are an error.
- **Validation flattens instances** (`flattenWorkflow`, `checkWorkflow`): every instance is replaced by its repeat-expanded nodes with the bound agents filled in, so loops, joins, reachability and tool coverage work across pattern boundaries without new rule code. Problems are mapped back onto the instance (message prefixed "In <pattern>:"), with the inner paths kept for expanded views; fixes inside a pattern are dropped (they're fixed in the pattern), except a missing port join, fixed on the instance.
- **A pattern is checked as it will be used:** in the pattern editor, repeat groups are expanded to their default size and problems on copies are mapped back to the template nodes. Otherwise the Router template ("one exit") would warn.
- **New rules:** `slot-in-workflow`, `agent-in-pattern`, `unbound-slot`, `port-unconnected`, `unknown-port` (an edge to a port that doesn't exist or points the wrong way), `pattern-cycle` (blocks saving, like an endless loop), `repeat-invalid`, and `missing-ref` for patterns. An instance counts as unreachable only when all of it is.
- **Reading a shared store doesn't form a loop** (`analyzeLoops`). An agent that writes the store and reads it back is not looping: a read is access to state, not a trigger. Same reasoning as the M4 join rule (PLAN.md 7.5). Found because Moderated discussion and Blackboard did this.
- **Built-in patterns** are data in `packages/schema` (`BUILTIN_PATTERNS`) with fixed ids `<slug>-builtn`, so Restore defaults (M6) can recognise them. Routing decisions that follow an agent's choice (Supervisor, Hierarchy, Handoff, discussion, Blackboard) are deterministic: the agent ends its reply with `{"next": "<label>"}` and a few lines of Python print that exit. Router uses an agent evaluator (a slot), Maker-checker a deterministic verdict check. Loop caps: 5 per worker exit, 8 per discussion or blackboard turn exit, 3 for Maker-checker. No default agents: the demo agents arrive in M7.

### Server
- **The built-ins are seeded on startup, once:** each built-in that never existed in the library (no entity, version or branch with its id) is added, all in one commit (`Add the built-in patterns`) tagged `v1`. Deleting an entity keeps its version tags, so a deleted built-in is not brought back; that is Restore defaults (M6). No separate "seeded" marker is needed.
- **Patterns are checked like workflows,** in pattern mode: saving is refused for an uncapped loop or a pattern containing itself, merging for any error. Save and merge load every pinned pattern recursively, so the checks see inside instances; merge also loads the agents and presets bound inside them.
- **`repeat` is written to `pattern.yaml`** after the graph. Templates don't have it.
- **Fork promotion needs no new endpoint:** merging a named branch (`POST …/merge {branch}`) already creates the next version and deletes the branch. **Save as new** is a create from the fork's content plus `DELETE …/branches/<fork>`. Re-pinning the instance is done by the editor.

### Pattern editor (web)
- **One canvas for projects and patterns** (`WorkflowEditor`, was `ProjectEditor`). It edits a `WorkflowDoc`, the same shape for both: a pattern's doc has empty overrides and workspace, a project's has no repeat groups. `toDoc`/`fromDoc` convert from and to the stored entity, so nothing extra is saved and unsaved-change detection stays exact.
- **Project-only:** overrides, the workspace field, Save as template and the context preview (agents in a pattern are slots, so there is nothing concrete to preview).
- **In a pattern, agent nodes are slots.** The palette shows **Slot**, which adds a slot with the role "Agent". In quick-add, picking an agent adds a slot named after it with that agent as its default. A slot's inspector has role, "what this role does" and an optional default agent. A decision's agent evaluator is a slot too ("Evaluating role", default "Router").
- **Repeat groups:** a node joins or leaves a group from its **Repeat** field ("Exists once", an existing group, or "New repeat group…", named after the node, parallel, 1–9, default 2). The pattern panel (nothing selected) lists the groups with name, mode ("In parallel" / "One after another"), min, default and max. Removing a node removes it from its group, and an empty group is removed.
- **On the canvas:** Input and Output nodes of a pattern carry a `port` chip, repeated nodes a `×2 Workers` chip, slots a dashed outline and a `slot` chip. Pattern instances (e.g. the Team inside Hierarchy) render collapsed, with a handle per port, their version (or `modified`) and, in a project, how many slots are bound. Inserting, binding and expanding them is the next step.
- **Patterns tab:** cards like Projects (name, `built-in` badge, version, draft badge, the roles and port counts). **New pattern** asks for a name and description and starts with Input → one slot → Output. The canvas is at `/patterns/:id`; `?branch=` opens a fork.
- The placeholder page is gone: Patterns was the last tab using it.

### Inserting patterns
- **Insert:** the palette's **Pattern…** entry (click or drag) and a **Patterns** group in quick-add. A dialog picks the pattern (skipped from quick-add), chooses N per repeat group (clamped to its range), and binds each slot to an agent, pre-selected from the slot's default. Inserting with unbound slots is allowed: the instance shows `0/2 slots bound` and merging is blocked until they are bound.
- **New instances pin the pattern's current version, and bindings pin the agent's current version** (the M2 rule for new references).
- **Placement follows the other nodes:** after the selected node, connected from its first free exit or output port into the instance's first input port.
- **Inside a pattern there is no binding step:** a nested instance's slots stay open (they are the outer pattern's slots). A pattern can't be inserted into itself (it isn't offered).
- **The instance inspector** shows the pinned pattern (with Open), "How many" per repeat group, a binding per slot (changing it never forks), and a Join per input port with several inputs. Lowering N drops the bindings of copies that no longer exist.
- **Joins of an instance are per input port** (`portJoins`): the node-level join rule skips pattern nodes, and a collapsed instance shows `join?` next to a port that needs one.

### Expand and collapse
- **Expanded state is per browser (`localStorage`), not in `layout.json`.** This changes the M0 decision. Stored in the layout, expanding would count as an unsaved change, and looking inside a built-in pattern would create a draft. Expanding is view state only (PLAN.md 7.7), so it is never saved. `Layout.expanded` stays in the schema, unused.
- **An expanded instance is a frame** (a React Flow parent node) holding its pattern's nodes, laid out from the pattern's own `layout.json`: copies of repeated nodes stack downwards, and what was below them moves down. Slots show the bound agents (from the flattened graph). The internals are read-only: not draggable, selectable or connectable. Editing them is Customize (fork).
- **Ports sit on the frame:** the pattern's Input and Output nodes are drawn as pills on the frame's left and right edges, and external edges attach to them, so they visibly route through the ports to the nodes inside.
- **Nested instances expand one level at a time;** collapsing a frame also collapses what was expanded inside it.
- **Room is made, not saved:** while a frame is open, top-level nodes to its right move right and nodes below it move down. Dragging such a node saves its real (unshifted) position.
- **Animation runs in JavaScript** (`requestAnimationFrame`, about 260 ms, ease in-out), not CSS: the frame size, the room around it and the contents' opacity are interpolated, so edges stay attached while things move. Reduced-motion users get no animation.
- **Expand or collapse** with the button in the instance's header, or by double-clicking it.
- **Quick-add matches patterns by name only** and lists them after tool steps. Their descriptions are prose that fuzzily matched unrelated searches (found by an M3 browser test).
- **A collapsed instance keeps handles for the ports its edges use** while its pattern is still loading, so edges don't detach (this caused a burst of React Flow warnings on every load).

### Forks and promotion
- **Pattern instances fork like agents (M3):** **Customize for this project** (or "…for this pattern" for a nested instance) creates `fork-<container id>-<node id>` at the pinned version and pins it; slot bindings, counts and port joins are kept. **Edit fork** opens the pattern editor on that branch (`?branch=&back=`), headed "Pattern · project fork" with a back link and a banner; Delete is hidden there. **Use library version** pins the current main version again (the fork branch stays, unused).
- **Promotion is in the node's inspector, for agent and pattern forks alike** (`PromoteFork`):
  - **Merge to main:** an optional note, then `POST …/merge {branch}`. If main changed since the fork started, a dialog shows main and the fork side by side (the files, as for M2 conflicts) with **Merge anyway**; no line-by-line merge (PLAN.md 7.7). The node then pins the new version.
  - **Save as new:** a name (default "<name> (custom)"), then the fork's content is created as a new entity (`v1`) and the fork branch is deleted. The node then pins the new entity. The original is unchanged.
- **Promoting saves the project (or pattern) right away,** so it never pins a branch that no longer exists. To avoid saving unrelated edits by surprise, promotion is disabled while there are unsaved changes ("Save first").
- **Other users of the promoted entity are not touched:** they keep their pinned version. The cascade preview that offers to move them is M6.
