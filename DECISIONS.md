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
