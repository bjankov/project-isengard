# Progress

## M0: Foundation (2026-11-03)
Status: done
Built:
- pnpm monorepo: `packages/schema`, `apps/server`, `apps/web`; TypeScript strict, ESLint, Prettier, Vitest.
- `packages/schema`: Zod types for every entity in PLAN.md sections 6 and 7:
  - skills, tool presets plus the built-in catalog, agents with defaults and limits, projects with overrides, patterns, templates, settings
  - workflow nodes (all 10 types), edges, all six context modes, decisions with all three evaluators, exits, loop caps, joins
  - layout, refs, API shapes, and `collectRefs()`
- `apps/server` (Fastify):
  - git check on startup, with a clear error when git is missing
  - library store initialized as a git repo at `~/.app/library` (or `$APP_HOME/library`)
  - generic CRUD API where every change is a commit and files follow the PLAN.md 5.4 layout
  - SQLite index (`~/.app/index.db`) for listing, search and references, rebuilt from git when missing or stale, or on demand
- `apps/web`: Vite, React, Tailwind, shadcn/ui, Zustand and react-router. App shell with the six tabs (placeholder pages) and a live server and library status indicator.
- 47 tests, including end-to-end API tests for create, read, update and delete of every kind, git commits, file layout, layout separation, and index delete/rebuild.

How to try it:
- `pnpm install`, then `pnpm dev`. This starts the API on :4317 and the web app on :5173, which opens in the browser. Use `APP_HOME=/some/dir pnpm dev` to keep test data away from `~/.app`.
- Click through the tabs. The dot in the top right shows "Library connected"; hover it to see the library path and HEAD.
- API examples:
  - `curl -X POST localhost:5173/api/skills -H 'content-type: application/json' -d '{"name":"my-skill","description":"Does a thing","body":"# Hi"}'`
  - then `curl localhost:5173/api/skills`, and `git -C ~/.app/library log --stat`
- Index: stop the app, delete `~/.app/index.db`, start it again, and the lists are identical. Or call `curl -X POST localhost:5173/api/index/rebuild`.
- Checks: `pnpm check` (typecheck, lint, tests).

Deviations from PLAN.md:
- None in behaviour. The choices PLAN.md left open are recorded in DECISIONS.md. The notable ones: M0 commits straight to the library's `main` (branching is M2); git signing is disabled in the library repo only.

Open issues / questions:
- How N-slot patterns ("choose N", PLAN.md 10) are represented is deferred to M5. It may add schema fields.
- The PLAN.md 8.1 choice between worktree and plumbing for branch writes is deferred to M2.
- The `shadcn add` CLI didn't resolve the `@/lib/utils` alias and installed an unrelated `cn` npm package. I removed it and fixed the imports by hand. Check the imports after each `shadcn add` (M1).
- Extra `SKILL.md` frontmatter fields (e.g. `license`) are dropped on save. Decide in M1 whether to preserve them.
- `npx app` distribution (a single command without pnpm) is not built yet. PLAN.md lists it as the target, and `pnpm dev` is the one command for now.

## M1: Library tabs (2026-11-03)
Status: done
Built:
- **Skills tab:**
  - list with search
  - editor: name (Agent Skills format, normalized as you type), description with a 1024-character counter, markdown body in Monaco
  - "used by" list
- **Tools tab:**
  - read-only built-in catalog
  - presets: create (pick a built-in, then fill its scope), edit and delete
  - scope editors for path globs, shell allowlists (exact or prefix) and domain allow/deny lists
  - live plain-language scope summary
  - unrestricted shell flagged in the preset list, the editor header and an inline warning
- **Agents tab:**
  - name, description and prompt (Monaco)
  - searchable skill and tool pickers; selected tools show their scopes and the unrestricted badge
  - model, effort and limits, pre-filled from Settings
- **Settings tab:** editable model list, defaults for new agents, library location (read-only).
- **Server:**
  - `settings.yaml` in the library plus `GET`/`PUT /api/settings`
  - `?full=1` lists
  - `409` when deleting a referenced entity, with a dialog listing who uses it
- **Shared UX:** Zod field validation, Ctrl/Cmd+S, unsaved-changes guard, toasts that show the commit hash.
- **Tests:** 57 unit/API tests, plus 3 Playwright e2e tests (`pnpm test:e2e`, using the installed Chrome) covering the done-when flow, validation, the unsaved-changes guard and settings.

How to try it:
1. Run `pnpm dev`. The app opens at http://localhost:5173.
2. **Skills** → New skill. Type a name (spaces become hyphens), a description and some markdown, then Save (or Ctrl+S).
3. **Tools** → New preset → Shell.
   - Remove the command row and watch the unrestricted warning appear.
   - Add `npm test` back, then Save.
4. **Tools** → New preset → Read file, glob `src/**`, then Save.
5. **Agents** → New agent. Add the skill and both presets, then Save. The list shows the model, and the editor shows each scope.
6. Try deleting the skill. It is refused with a list of the agents using it.
7. **Settings**: add a model, make it the default, Save. New agents start with it.
8. `git -C ~/.app/library log --stat` shows one commit per save.
9. `pnpm check` runs the unit/API tests; `pnpm test:e2e` runs the browser tests.

Deviations from PLAN.md:
- **Deleting a referenced entity is blocked** for now. PLAN.md 8.4 says it should be allowed with confirmation, converting references to local copies; that is M6. Agreed at planning.

Open issues / questions:
- **Testing approach:** UI behavior is covered by the e2e tests, not component unit tests.
- **E2E prerequisite:** the e2e tests need Google Chrome installed.

### M1 follow-up (2026-11-04)
Built:
- **Skill editor, Advanced button:** reveals license, compatibility, metadata, allowed-tools and other fields (YAML) in a wider layout. It shows a count when such fields are set while hidden.
- **Form | SKILL.md switch:** edit the raw file; the form and the file stay in sync.
- **Preservation:** existing advanced and unknown frontmatter in hand-written skills is kept on save.
- **`V2_BACKLOG.md`:** lists everything deferred to v2.

How to try it:
1. Open a skill and click **Advanced**. Set a license, metadata and allowed tools, then Save.
2. Switch to **SKILL.md** to see and edit the file. Switch back to **Form**.
3. `git -C ~/.app/library show HEAD` shows the written file.

Tests: 65 unit/API tests; 5 e2e tests (2 new, for advanced fields, raw editing and invalid YAML).

Deviations from PLAN.md: none.

## M2: Versioning (2026-11-04)
Status: done

Built:
- **Versions as git tags** `<kind>/<id>/v<n>`. Creating an entity makes `v1` on `main`. Entities from before M2 (and files added by hand) are tagged `v1` on startup.
- **Drafts:** every save in the Skills, Tools and Agents editors commits to the entity's `draft` branch. `main` and the library folder stay unchanged until you merge. Reopening an entity opens its draft.
- **Merge as vN:**
  - publishes the draft to `main` as a merge commit with the next version tag, and closes the draft
  - only that entity changes
  - if `main`'s copy changed since the draft started (only possible through edits outside the app), a dialog shows `main` against the draft and offers **Merge anyway**
- **Discard draft:** goes back to the current version.
- **Branch indicator in every editor header:** the version (`v3`) plus `main`, `new draft` (unsaved changes, no draft yet) or `draft · N saves`.
- **History panel:** versions on `main` and unmerged draft saves. Pick any two (or click an entry to compare it with the one below it) for a side-by-side Monaco diff of the stored files.
- **Lists:** a `draft` badge marks entities with unmerged changes. In the agent editor, each skill and tool shows the version it pins. New references pin the current version, not `v1`.
- **API:**
  - `GET /api/<kind>/<id>?ref=` (main, `v2`, `draft` or a commit)
  - `GET …/versions`, `GET …/history`, `GET …/diff?from=&to=`
  - `POST …/merge`, `DELETE …/branches/<branch>`
  - list responses include each entity's version and draft flag
- **Git plumbing for every write** (temporary index, `commit-tree`, atomic `update-ref`), so the working tree is never switched. Recorded in DECISIONS.md.

How to try it:
1. `pnpm dev`, then open **Agents** and create an agent. The header shows `v1 · main`.
2. Change its description. The indicator says `new draft`. Save: it now says `draft · 1 save`, and the list shows a `draft` badge. `git -C ~/.app/library log --oneline --graph --all` shows `main` unchanged and the commit on `agent/<id>/draft`.
3. Click **Merge as v2**. The header shows `v2 · main` and `git -C ~/.app/library tag` lists `agent/<id>/v2`.
4. Click the clock button: the history shows v2 and v1, with the diff. Edit and save again, then compare the draft with v2, or pick any two entries in the Compare boxes.
5. **Discard draft** reverts the editor to v2.
6. Add a skill to an agent: its card shows the pinned version (the skill's current one).
7. `pnpm check` (78 unit/API tests) and `pnpm test:e2e` (8 browser tests, 3 new for M2).

Deviations from PLAN.md:
- **Opening for edit does not create the draft branch; the first Save does.** PLAN.md 8.1 says "opening an entity for edit creates or reuses a draft branch". Creating it on Save avoids empty branches for entities that are only viewed. Agreed at planning.
- **New entities go straight to `main` as `v1`.** Only edits go through a draft. Agreed at planning.

Open issues / questions:
- **References that exist only on a draft don't block deleting their target.** Deletion is checked against `main`. If an agent's draft adds a skill and that skill is deleted before the merge, the merged agent points at a deleted skill. M6 (deletion with references) is the natural place to handle this.
- **Projects (M3) and versioning:** all kinds, including projects, currently save to a draft. M3 should decide whether canvas autosave commits to the draft on every change.
- **Version descriptions are generic** ("Created", "Merged from the draft"). There is no per-version note or changelog. Say if you want a short message when merging.
- **Discarded draft commits** stay in the git object store until `git gc` removes them. Nothing in the app shows them again.

### M2 follow-up (2026-11-04)
Built:
- **Merge notes:** **Merge as vN** opens a small popover with an optional "What changed?" line. The note is stored in the merge commit and shown under the version in the history.
- **PLAN.md 8.4 updated** with the new rules for deleting referenced entities: only versions on `main` count; confirm, then keep as local copy or replace with a placeholder, for all at once or per entity. The work itself belongs to M6.

How to try it: edit an agent, Save, click **Merge as v2**, type a note and merge. Open the history: v2 shows the note. `git -C ~/.app/library log -1 main` shows it as the commit body.

Tests: 79 unit/API tests, 8 e2e tests (the M2 e2e tests now merge with a note).

Deviations from PLAN.md: none (PLAN.md 8.4 changed by agreement).

## M3: Projects and canvas (2026-11-04)
Status: done

Built:
- **Projects tab:**
  - project cards with version and draft badge, and workflow templates
  - **New project**: name, description, workspace path (checked as you type, folder suggestions, `git init` offered with confirmation), start blank or from a template
- **Canvas** (React Flow):
  - every node type except Pattern; decisions are diamonds with one handle per exit
  - palette (click or drag) and `Ctrl/Cmd+K` quick-add; with one node selected, the new node is added after it and connected
  - refused connections say why
  - edges show their context mode; loop-back edges are curved with a `max N` / `no cap` badge
  - undo/redo, copy/paste (with overrides), delete, select all, minimap, zoom to fit, explicit Save (`Ctrl/Cmd+S`) with the unsaved-changes guard
  - versioning header (draft, Merge, History) like the library editors
- **Inspector:**
  - the project (name, description, workspace)
  - every node type, and edges: payload (inferred, can be changed), context mode with its settings, history on loop edges, access on shared-store edges, the loop cap of a decision exit
- **Agent nodes:**
  - **Project overrides** (model, effort, limits) show the inherited values and never fork
  - **Agent definition** (prompt, skills, tools) is read-only, with **Customize for this project**, which forks the agent onto a project branch; **Edit fork** opens it in the agent editor
- **Templates:** **Save as template** on a project; New project can start from a template.
- **Layout:** positions saved to `layout.json`, separate from the graph. A project opens zoomed to fit.
- **API:**
  - `POST /api/workspace/check`, `/init`; `GET /api/workspace/suggest`
  - `POST /api/<kind>/<id>/branches`; `PUT …?branch=`
  - projects must point at a git repo root

How to try it:
1. `pnpm dev`. Create agents named Planner, Executor and Tester in **Agents** if you don't have them.
2. **Projects → New project**: type a folder path. If it isn't a git repo, click **Initialize git here**. Create.
3. Click the **Task** node, press `Ctrl/Cmd+K`, type "Planner", Enter. Repeat for "Artifact" (set Path to `PLAN.md`), "Executor", "Artifact" (`src/**`, file type Code), "Tester", "Decision" (Question "tests pass?").
4. Drag from the decision's **pass** handle to **Result**, and from **fail** to **Executor**. Click the loop edge's label: set Max loops 3, Context mode Summary.
5. Click the Executor: set Effort to High under **Project overrides**. Try **Customize for this project** to fork it.
6. `Ctrl/Cmd+S`, reload: everything is where you left it. Try `Ctrl/Cmd+Z`, copy/paste and Delete.
7. `pnpm check` (103 unit/API tests), `pnpm test:e2e` (13 browser tests, 5 new: demo workflow 1 built by hand and identical after reload, editing interactions, forks, templates, every node type).

Deviations from PLAN.md:
- **Decision nodes are partly done:** evaluator type, basic evaluator fields, exits and loop caps. The Monaco Python editor with file drop, `onExhausted`, join modes and validation (including blocking a save with an uncapped loop) are M4. Agreed at planning.
- **Agent forks can be created and edited, not promoted or deleted.** That's M5/M6. Agreed at planning.

Open issues / questions:
- **Project cards show `main`, not the draft.** All canvas work goes to the draft, so a new project's card still says "2 nodes" until you merge. This follows the M2 rule that lists show `main`, but for projects it may be confusing. Should project cards show the draft's state instead?
- **Long chains look small when zoomed to fit,** since quick-add builds left to right. There is no automatic layout; M7 (polish) could add a "tidy up" action.
- **Forks are created right away.** If you fork and then discard your unsaved project changes, the fork branch stays in the library unused. It's invisible in the UI and harmless.
- **Templates made from projects with forks** keep pinning those projects' fork branches.
- **Performance with 100 nodes** isn't measured yet (M7).

### M3 follow-up (2026-11-04)
Built:
- **New project creates its workspace folder.** **New folder** is the default: choose a location (remembered) and a folder name (follows the project name). The dialog shows the full path, and creating the project makes the folder and runs `git init`. **Existing repo** keeps the previous flow, including the `git init` offer.
- `POST /api/workspace/check-new`, and `POST /api/projects?createWorkspace=1`, which validates the project before creating the folder.

How to try it: **Projects → New project**, type a name, keep **New folder**, set a location (e.g. `~/code/`), Create. `ls -a <location>/<folder>` shows `.git`.

Tests: 105 unit/API tests (2 new), 13 e2e tests (the demo workflow test now uses a new folder; the template test covers an existing folder with `git init`).

Deviations from PLAN.md: none. PLAN.md 9.2 asks for a workspace path "validated as a git repo, with git init offered"; creating the folder is an addition.
