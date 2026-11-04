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
