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

## M4: Decisions, validation, context preview (2026-11-05)
Status: done

Built:
- **Live validation** (`validateWorkflow` in `packages/schema`, shared by the canvas and the server):
  - **every PLAN.md 9.5 rule except patterns:** uncapped loops, an agent writing an artifact without a covering write tool, `reference` mode without a covering read tool (or from something that isn't a file), unconnected decision exits, decisions without exits, nodes not reachable from an Input, unrestricted shells
  - **plus:** a missing join mode, n-of-m larger than the inputs, a missing `onExhausted` exit, missing agents or presets, a missing Input, a single exit, an incomplete evaluator
- **Loops:** every loop must go through a decision exit with Max loops. Loops without a decision are refused.
- **What blocks what:** an uncapped loop blocks **saving**; any error blocks **merging**. Both are enforced in the UI and by the server.
- **Problems on the canvas:**
  - red or amber outlines, corner markers and red edges
  - a problems bar under the canvas (counts, what is blocked, click to jump, one-click fixes "Cap at 3 loops" and "Wait for all inputs")
  - each item's problems at the top of the inspector
- **Decisions:**
  - Monaco Python editor with a language select, **Load file…** and drag and drop of `.py` files, and an Expand dialog
  - the v2 contract explained in the hint
  - exits in order (exit code 0 takes the first)
  - **When the cap is hit:** stop and ask a human, or take another exit
  - human decisions start with approve / reject
- **Joins:** a Join field (Wait for all / Any one / Some N) and a join chip on nodes with several inputs. Loop-backs and shared-store reads don't count as inputs.
- **Context preview** (agent inspector button, or `P`):
  - the agent's version, model, effort and limits (overrides highlighted)
  - its prompt, its skills with their bodies, its tools with their scopes
  - every input in plain words, according to its context mode and loop history, with related problems
- **API:** `400 {error: "workflow", problems}` for refused saves and merges.

How to try it:
1. Run `pnpm dev` and open a project with a loop, for example demo workflow 1 built as in M3.
2. Click the loop edge's `max 3` label and clear **Max loops**. The loop turns red and the badge says `no cap`. Press `Ctrl/Cmd+S`: saving is refused. In **Problems** under the canvas, click **Cap at 3 loops**.
3. Click the PLAN.md → Executor edge and set **Context mode** to Reference. Unless the Executor has a Read file preset covering `PLAN.md`, an error appears. Save works, but **Merge** is disabled and explains why. Set the mode back to Full, save, and merge.
4. Connect the Task to the Executor. **join?** appears; click **Wait for all inputs**.
5. Click the decision. Drop a `.py` file on the code editor, reorder the exits, and set **When the cap is hit**.
6. Select an agent and press `P` for the context preview. Change an incoming edge's context mode and look again.
7. Run the checks:
   - `pnpm check`: 133 unit and API tests, 28 of them new
   - `pnpm test:e2e`: 16 browser tests, 3 new: every rule triggered and resolved with Save and Merge blocked, decision code from a file with exits, the context preview for all six modes

Deviations from PLAN.md:
- **The pattern rule** (unconnected port, unbound slot) is not built. Patterns can't be placed until M5, so it moves there. Agreed at planning.
- **PLAN.md changed by agreement:**
  - 7.4: every loop must pass through a capped decision exit; loops without a decision are not allowed
  - 7.5: which inputs count for a join
  - 9.5: errors block merging

Open issues / questions (answered by the user on 2026-11-05):
- **Projects saved in M3 with an uncapped loop** open, but can't be saved until the loop is capped; the problem and its fix are shown. **Answer: OK as is.**
- **Glob coverage is conservative.** An artifact path that is itself a glob counts as covered only when containment is clear; anything else is an error. **Answer: keep it an error for now; revisit later.**
- **Toasts sit bottom-left, so they briefly cover the left end of the problems bar.** **Answer: polish, later (M7).**
- **Context preview covers agent nodes only.** An evaluator agent in a decision has no preview yet. **Answer: later.**
- Templates are checked on the server like projects (uncapped loops block creating one), but there is no template editor to show their problems.

## M5: Patterns (2026-11-05)
Status: done

Built:
- **Before the milestone:** `pnpm install` no longer tries to build better-sqlite3 from source (it ships prebuilt binaries). The server tests pass on macOS (temp folder resolved through `/var` → `/private/var`).
- **Schema:**
  - pattern instances: slot bindings by path, N per repeat group, a join per input port
  - patterns: repeat groups (`parallel` or `chain`, min/default/max)
  - overrides keyed by node path, for agents inside instances
  - `flattenWorkflow` / `checkWorkflow`: instances are expanded into plain nodes, so every rule works across pattern boundaries; problems are shown on the instance
  - new rules: unbound slot, unconnected input port, unknown port, a pattern containing itself, slot in a workflow, concrete agent in a pattern, invalid repeat group, missing pattern
  - the 10 built-in patterns as data (PLAN.md 10), each checked clean at several sizes
  - a store read is no longer a loop (as for joins)
- **Server:** the built-ins are seeded once per library (a deleted one stays deleted); save and merge checks load pinned patterns, recursively, and check patterns themselves.
- **One canvas for projects and patterns.** In a pattern: Slots (role, description, default agent), slot evaluators, a Repeat field per node, repeat groups in the pattern panel, port chips.
- **Patterns tab:** cards with built-in, version and draft badges; New pattern; the editor with draft, merge and history like every other entity.
- **Insert:** Pattern… in the palette (click or drag) or quick-add; choose N, bind slots (defaults pre-selected); placed and connected through its ports. Instance inspector: version, how many, bindings, a join per port, Open.
- **Expand and collapse** (button or double-click): a frame with the pattern's nodes (copies stacked, bound agents shown), ports as pills on the frame edges with external edges routed through them, nested patterns one level at a time, neighbours moved aside, animated. View state only, never saved. Agents inside take project overrides.
- **Forks and promotion:** Customize / Edit fork / Use library version for pattern instances (like agents); promotion of pattern and agent forks: **Merge to main** (with a note; main and the fork side by side if main moved on) or **Save as new**; the node is re-pinned and the project saved.
- **Tests:** 160 unit/API tests (27 new) and 20 browser tests (4 new, in `e2e/patterns.spec.ts`).

How to try it:
1. `pnpm install`, then `pnpm dev`. On first start the library gets the 10 built-in patterns.
2. **Patterns** shows them. Open **Hierarchy**: click the expand button on **Team** to see a nested Supervisor with its two workers. Nothing changes by looking.
3. Create two agents in **Agents** (e.g. Coder and Critic), then a project in **Projects**.
4. On the canvas, select **Task**, click **Pattern…** in the palette, pick **Maker-checker**, bind Maker and Checker, **Insert**. Connect its **Result** port to the project's Result. Save.
5. Click the expand button on the instance: the maker, checker and decision with the loop, ports on the frame. Click the Coder inside it and set Effort to High (a project override; nothing forks). Save, then collapse.
6. Select the instance → **Customize for this project** → **Fork pattern** (it shows **modified**). Save, then **Edit fork**: change something (e.g. rename the Checker slot), Save, **← Back to the project**.
7. Select the instance → **Merge to main** → a note → **Merge as v2**. The instance pins v2 and the project is saved; **Patterns → Maker-checker** shows v2 in its history with the note.
8. **Patterns → New pattern**: select its slot, set **Repeat** to "New repeat group…", add a second Slot from the palette. The problems bar shows the joins the copies need; fix them, Save, **Merge as v2**, and insert it into a project with 3 copies.
9. `pnpm check`, `pnpm test:e2e`.

Deviations from PLAN.md:
- **Expanded state is per browser, not in `layout.json`** (changes the M0 decision). Stored in the layout, expanding would count as an unsaved change and create drafts of built-ins just by looking. PLAN.md 7.7 calls it view state only.
- **Additions agreed at planning:** repeat groups for "choose N" (PLAN.md 10), joins per input port, overrides for agents inside instances, and agent fork promotion.
- **Other additions:** store reads don't form loops (Moderated discussion and Blackboard needed it); `chain` repeat groups (Pipeline needed it).

Open issues / questions (answered by the user on 2026-11-05):
- **Built-in layouts:** Moderated discussion and Blackboard have crossing store edges on the canvas. Cosmetic; M7? **Answer: yes, fix it (M7).**
- **Templates made from a project with a fork** pin that fork branch; promoting the fork deletes the branch, so the template then pins a missing version (shown as missing). This belongs with M6's references and deletion work. **Answer: yes, in M6.**
- **Context preview** covers agents in the project's own graph, not agents inside a pattern instance. Wanted for M6/M7? **Answer: v2; a pattern may stay a bit of a black box until then.**
- **Use library version** on a fork leaves the fork branch unused in the library (as for agent forks in M3). Deleting forks is M6. **Answer: leave it for M6.**
- **Inside a pattern editor, a nested instance's fork** is named after the outer pattern and promoted the same way; it works but isn't covered by a browser test.
- **One `ResizeObserver` warning** in the whole browser run, as before M5 (harmless browser noise).

## M6: Propagation and updates (2026-11-05)
Status: done

Built:
- **Cascade preview (PLAN.md 8.2):**
  - **What it finds:** after a merge (or a fork's Merge to main), everything on `main` that pins an older version, transitively: skill → agents → patterns, templates and projects.
  - **The dialog** shows a tree with **Accept all**, **Decline all** and a checkbox per case. A case is one node, slot binding or skill or tool entry. Declining an agent disables what depends on it.
  - **Forks** are listed but unchecked.
  - **Updates that would add errors** are flagged and unchecked.
  - **Applying:** each accepted entity gets its next version on `main` in one transaction, with a "Uses skill … v2" note in History. Overrides are kept, and drafts get the same re-pins.
  - **The editor header** shows "N users on older versions" to reopen it later.
- **Update badges (PLAN.md 8.3):**
  - "v2 → v4" on agent, pattern, tool-step and evaluator nodes, on slot bindings and the pinned pattern in the inspector, and on an agent's skills and tools
  - the popover shows the merge notes in between, **Compare** and **Update to vN** (this instance only)
  - a pin of a fork that no longer exists offers **Use vN**
- **Deleting referenced entities (PLAN.md 8.4):**
  - the dialog lists who uses the entity, with **Local copy** or **Placeholder** for each (or for all)
  - each of them gets a new version that embeds the deleted entity's content or marks it deleted
  - the cascade then offers the new versions to what pins the old ones
  - the canvas shows **local copy** and "Deleted: …" and resolves copies like library entities; merging with a placeholder is blocked
- **Templates open on the canvas** (Projects → template card → **Open**), so their instances get update badges too.
- **Fork housekeeping:**
  - each project, template or pattern owns its forks; Save as template copies them
  - unused forks are deleted on save, merge, discard or delete
  - this covers the M5 leftovers: templates pinning promoted forks, and branches left by "Use library version"
- **Settings → Restore defaults** adds back deleted built-in patterns (as their next version).
- **Agents can't be merged while they pin a deleted skill or tool** (the M2 open issue).
- **Tests:**
  - 182 unit/API tests (11 new server tests, 11 new schema tests)
  - copy and paste carries local copies; the project a fork is promoted from is left out of the cascade (follow-up)
  - 24 browser tests (4 new, in `e2e/propagation.spec.ts`)

How to try it:
1. `pnpm install`, then `pnpm dev`.
2. Create a skill (**Skills**), two agents using it (**Agents**), and three projects using those agents (**Projects** → New project, add the agents from the palette). Set an override (e.g. Effort High) on one node. Save each project.
3. Open the skill, change its description, Save, **Merge as v2**. **Update what uses it?** opens with both agents and, under them, the three projects' nodes.
4. Uncheck one project's node, and see the count change. Uncheck an agent, and its projects' rows are disabled. **Apply**.
5. Open the projects:
   - the accepted ones pin the agents' v2, with the override still set
   - the declined one shows a blue **v1 → v2** badge on the node; click it to see what changed, then **Update to v2**, then Save
6. Open one agent: the header says how many users are still on older versions. Click it to reopen the preview.
7. Delete an agent that a project uses: choose **Local copy** and confirm. The project's node shows **local copy**, and Problems stays empty. Try **Placeholder** on another: the node says "Deleted: …" and merging is blocked.
8. **Projects → template → Open** shows a template on the canvas.
9. Delete a built-in pattern, then **Settings → Restore defaults**.
10. `pnpm check`, `pnpm test:e2e`.

Deviations from PLAN.md:
- **A placeholder keeps the reference in place** and marks it deleted, instead of removing it (PLAN.md 8.4 says "the reference is removed"). The effect is the same (it resolves to nothing and blocks merging), but nodes and their edges stay, and the editor can show the last known name. Agreed at planning as part of the local-copy design.
- **Additions:** update badges in the agent editor; templates on the canvas (needed for PLAN.md 8.3, agreed at planning); a new "agents can't merge with missing skills or tools" rule.

Open issues / questions (answered by the user on 2026-11-05):
- **Copy and paste between projects dropped local copies.** **Answer: the clipboard carries them.** Done: copied nodes take the local copies and placeholders they reach, and pasting adds them to the target workflow (covered by the browser test).
- **Promoting a fork whose project already pinned it on `main`** made the cascade offer that project a new `main` version. That wasn't a second `main`: the project's one `main` version still pinned the deleted fork, while its draft already pinned the promoted version. **Answer: too much of a headache.** Done: the project, template or pattern the fork is promoted from is left out of the cascade. Its draft already pins the new version, and its next merge publishes it.
- **The cascade can only offer what is on `main`.** A project draft that pins an old agent version, where the project's `main` doesn't, isn't listed; the canvas badge covers it when the project is opened. This follows the M2 rule that drafts don't count.
- **Flaky test, to hunt down later (user decision):** `pnpm test` occasionally reports one unhandled error, attributed to whichever `app.test.ts` test ran last. Every test still passes. It was seen 3 times in about 8 runs.
  - **Captured:** `Error: write EPIPE` at `apps/server/src/git.ts:180` (`child.stdin.end(opts.input ?? '')` in `LibraryGit.run`, from M2).
  - **Likely cause:** `run` always writes to the child's stdin, even for git commands that don't read it (`read-tree`, `ls-files`, `write-tree`…). If git exits before Node writes, the write fails with EPIPE. `child.stdin` has no `'error'` listener, so the error becomes an uncaught exception.
  - **Why it matters beyond tests:** in the running server, the same uncaught exception could crash the process.
  - **Probable fix (not applied):** ignore errors on `child.stdin` (`child.stdin.on('error', () => {})`); git's exit code still reports real failures. Optionally, only pipe stdin when there is input.
