# Project Plan: Agentic Workflow Designer (working name TBD)

> **For the agent reading this:** this document is your brief. Read all of it before writing code.
> - Build **only the MVP (v1)** described here. v2 items are listed so you design *for* them, not so you build them.
> - Work milestone by milestone (section 11). At the end of each milestone, stop and summarize what was built, what deviates from this plan, and any open questions.
> - Where this plan is silent, choose the simplest option consistent with the principles in section 2, and record the choice in `DECISIONS.md` at the repo root.
> - Items marked **[default]** were chosen during planning without strong user input. Follow them, but they may change.
> - Use "the app" in prose and `app` as a placeholder in package names until a name is chosen.

---

## 1. Overview

Most agentic development platforms abstract away the development process, at the cost of code quality, token usage and memory usage. This project gives that control back to developers.

The app is a central hub and GUI for designing agentic development workflows: managing skills, tools, agents, patterns and workflows. Tokens are expensive and agents get worse as their context grows, so the core idea is that the developer designs the workflow and gives **each agent exactly what it needs to do its task, nothing more**.

Concretely, the developer:
1. Builds a library of **skills**, **tool presets** and **agents**.
2. Uses or creates **patterns** (reusable multi-agent structures such as maker-checker or fan-out/fan-in).
3. Creates a **project**, which is a visual **workflow graph** combining agents, files, decisions, human steps and patterns, with precise control over what flows between them and how success is judged.

## 2. Guiding principles

1. **Minimal context per agent.** Every design decision should make it easier to see and limit what each agent receives.
2. **Explicit over implicit.** Branching, success criteria, loop limits and data flow are visible on the canvas, never hidden.
3. **Treat everything like code.** All library entities and workflows are versioned in git, with branching and merging. Nothing updates silently.
4. **UX is the product.** The MVP exists to sell the idea. A feature that works but feels clumsy is not done.
5. **Design for execution.** v1 does not execute anything, but every saved workflow must contain all the information a v2 engine needs to run it (see section 12).

## 3. Scope

### 3.1 MVP (v1): design only

- Library management: skills, tool presets, agents, patterns (create, edit, delete, version, branch, merge).
- Project creation with a workflow canvas: all node types, edges, inspector panels, validation, context preview.
- Decision nodes with all three evaluator types, **configurable but never run**.
- Patterns as collapsible/expandable composite nodes, with forking and promotion back to the library.
- Versioning with update notifications and cascading propagation with preview.
- Seeded demo content so the first screen is never empty.

### 3.2 v2 (in project scope, explicitly NOT in the MVP)

- **The execution engine**: running workflows, calling LLMs, enforcing tool scopes and limits, running evaluators, executing summary context mode, run history and logs, token spend tracking.
- Workspace rollback via git checkpoints during runs.
- A language-agnostic contract for deterministic evaluators (any language, not just Python).
- A visual, drag-and-drop builder for deterministic evaluations (similar to Apple Shortcuts).
- Custom tools (e.g. MCP servers).

### 3.3 Non-goals for the MVP

Do **not** build any of the following, even partially:
- Any execution: no LLM calls, no running evaluator code, no running tool steps.
- Token estimation (v2 will track actual spend; estimates are deliberately excluded).
- Export of workflows to other formats or tools.
- User accounts, authentication, multi-user collaboration, cloud hosting.
- Custom tools / MCP integration.
- The Shortcuts-style deterministic builder.
- API key management.

## 4. Glossary

| Term | Meaning |
|---|---|
| **Skill** | A markdown instruction file in the Agent Skills format (`SKILL.md` with `name` and `description` frontmatter). |
| **Built-in tool** | A capability shipped with the app (read, write, shell, …). Cannot be deleted. |
| **Tool preset** | A built-in tool with a scope, e.g. "read `src/**` only" or "shell: `npm test` only". What agents actually get. |
| **Agent** | A reusable definition: prompt, skills, tool presets, and default model/effort/limits. |
| **Workflow** | A directed graph of nodes and edges describing how a task is completed. |
| **Project** | One workflow (1:1) plus a workspace repo and per-project overrides. |
| **Workspace** | The git repo on disk where the project's product lives and where v2 agents will work. |
| **Library store** | The app's own git repo holding all skills, agents, tool presets, patterns, workflow templates and projects. Not the same as a workspace. |
| **Pattern** | A reusable sub-graph with input/output boundary nodes and agent slots. Placed into workflows as a composite node. |
| **Slot** | A role placeholder inside a pattern (e.g. "Maker"), bound to a concrete agent when the pattern is inserted. |
| **Instance** | A use of a library entity inside a workflow (an agent node, a pattern node). Pins a specific version. |
| **Override** | A per-project change to an instance's model, effort or limits. Does not create a version or branch. |
| **Fork** | An instance whose content was edited inside a workflow. Becomes a branch of the source entity. |
| **Evaluator** | The logic a decision node uses to choose an exit: deterministic (code), agent, or human. |
| **Context mode** | Per-edge setting controlling how much of the upstream output the downstream node receives. |

## 5. Architecture

### 5.1 Shape

A **web UI served by a local backend** (Jupyter-style). The user runs one command, a local server starts, and the browser opens. All data, and in v2 all execution and API keys, stay on the user's machine.

### 5.2 Stack

TypeScript everywhere. No Python in the app's own code (user-written evaluator code is a separate matter; see 7.5).

- **Monorepo:** pnpm workspaces.
  - `packages/schema`: the single source of truth for all data types, defined with **Zod** and shared by frontend and backend.
  - `apps/server`: Node + **Fastify** (or Hono), REST API, git and SQLite access.
  - `apps/web`: **React** + **Vite**, **React Flow** (`@xyflow/react`) for the canvas, **Monaco** for code and markdown editing, **Tailwind** + **shadcn/ui** for components, **Zustand** for client state.
- **Git:** `simple-git` wrapping the real `git` binary. Check on startup that git is installed and show a clear error if it isn't.
- **Index:** SQLite (`better-sqlite3`, optionally Drizzle) for search and reference lookups. **Git is the source of truth; the index must be rebuildable from the library store at any time.**
- **Launch:** `pnpm dev` during development; a single `npx app` style command is the target for distribution.

### 5.3 Two git repos, never confused

1. **Library store** (`~/.app/library` **[default]**): the app's own data. Managed entirely by the app.
2. **Workspace repo**: chosen per project; the user's product codebase. In the MVP the app only **validates** it (exists, is a git repo) and stores its path. It does not read or write the user's code. If the chosen folder is not a git repo, offer to run `git init` there, with confirmation.

### 5.4 Library store layout [default]

One directory per entity, human-readable files, so git diffs are meaningful.

```
library/
  skills/<id>/SKILL.md              # plus optional supporting files
  tools/<id>.yaml                   # tool presets
  agents/<id>.yaml
  patterns/<id>/pattern.yaml        # graph semantics
  patterns/<id>/layout.json         # node positions only
  templates/<id>/workflow.yaml      # saved workflow templates
  templates/<id>/layout.json
  projects/<id>/project.yaml        # workspace path, overrides
  projects/<id>/workflow.yaml
  projects/<id>/layout.json
```

- **Layout is stored separately from semantics** so moving boxes around does not appear as a meaningful change in history or diffs.
- Every entity has a **stable id** (slug + short uuid) separate from its display name, so renames never break references.

## 6. Data model

All types live in `packages/schema`. Field lists below are minimums.

### 6.1 Skill
- `id`, `name`, `description` (frontmatter, per the Agent Skills standard), markdown body.
- Supporting files are allowed in the folder but the MVP UI only needs to edit `SKILL.md`.

### 6.2 Built-in tools and tool presets
Built-in catalog (fixed, not deletable):

| Built-in | Scope options in a preset |
|---|---|
| `read_file` | allowed path globs |
| `write_file` | allowed path globs |
| `edit_file` | allowed path globs |
| `search_files` (glob/grep) | allowed path globs |
| `shell` | command allowlist (exact commands or prefixes) |
| `web_search` | optional domain allow/deny list |
| `web_fetch` | optional domain allow/deny list |

- A **tool preset** = `id`, `name`, `description`, `builtin`, `scope`.
- Paths are relative to the project workspace.
- **Shell rule:** a shell preset without an allowlist is allowed but must be marked **unrestricted** with a prominent warning badge everywhere it appears (preset list, agent editor, canvas node), because unrestricted shell bypasses every other restriction.
- In the Tools tab, "create a tool" means creating a preset of a built-in.

### 6.3 Agent
- `id`, `name`, `description`, `prompt`.
- `skills`: references to skills (by id + version).
- `tools`: references to tool presets (by id + version).
- `defaults`: `model` (provider + model id), `effort` (low / medium / high), `limits`:
  - `maxIterations`
  - `maxTokens`
  - `maxWallTimeSeconds`
- The model list is a static, user-editable list in Settings **[default]**. No API calls are needed to populate it.

### 6.4 Project
- `id`, `name`, `description`, `workspacePath` (must be a git repo).
- `workflow` (the graph, see section 7).
- `overrides`: per agent instance, **only** `model`, `effort`, `limits`.
- **Rule:** model, effort and limits are project-specific and editable without any branching. Editing an instance's **prompt, skills or tools** forks it (creates a branch of the agent; see section 8).
- Overrides survive version updates: accepting a new version of an agent keeps the project's overrides.

### 6.5 References and versions
- Every reference from one entity to another is `{ kind, id, version }`, where `version` is a main version number (`v3`) or a branch name.
- Instances pin a version. Nothing ever floats to "latest" automatically.

## 7. Workflow graph semantics

These semantics are the contract the v2 engine will execute. Get them right in the schema even though nothing runs in v1.

### 7.1 Node types (closed list for v1)

| Node | Purpose | Key config |
|---|---|---|
| **Input** | Workflow entry (the initial prompt/task, optional attached files). Inside a pattern: a boundary port. | name, payload type, content (workflow) |
| **Output** | Workflow exit. Inside a pattern: a boundary port. | name, payload type |
| **Agent** | An agent instance. | agent ref, overrides |
| **Decision** | The only node that branches. Chooses one labeled exit using an evaluator. | evaluator, exit labels, loop caps |
| **Artifact** | A file flowing through the graph (md, json, xml, txt, code…). | workspace-relative path, file type |
| **Tool step** | A fixed action with no LLM, e.g. "run `npm test`". | tool preset + arguments |
| **Human input** | A person provides something (answers, files). Different from approval, which is a Decision with a human evaluator. | instructions, requested fields |
| **Shared store** | Named shared state several agents read and write (blackboard, discussion transcript). | name, format |
| **Pattern** | A pattern instance (composite node). | pattern ref, slot bindings |
| **Note** | Canvas comment. Never executed. | text |

"Code" is either an **Artifact** (code as a thing) or a **Tool step** (code as an action). There is no separate code node.

### 7.2 Edges

An edge says *what* flows and *how much of it* the receiver sees. Edges never carry conditions; only decision nodes branch.

| Property | Values | Notes |
|---|---|---|
| **Payload** | inferred from source: text, file, code/diff, none | `none` = pure sequencing ("start after") |
| **Context mode** | `full`, `reference`, `excerpt`, `diff`, `summary`, `outcome-only` | see 7.3 |
| **History** | `latest` / `all` | only shown on edges that are part of a loop |
| **Access** | `read` / `write` | only on edges to/from a Shared store |

Edge semantics to support:
- **Agent → Artifact** means the agent writes that file.
- **Artifact → Agent** means the agent receives that file under the edge's context mode.

### 7.3 Context modes

Context modes control only the incoming-edge part of an agent's input. An agent's full input is always: its prompt, plus its skills, plus its tool definitions, plus its incoming edges, each rendered by its context mode.

| Mode | Agent receives | Config |
|---|---|---|
| `full` | the whole upstream output | none |
| `reference` | a workspace path; reads it on demand | requires a read tool covering the path (validated) |
| `excerpt` | a deterministic slice | selector: markdown heading, JSON path, or line range |
| `diff` | only changes | base: workspace HEAD or previous loop iteration |
| `summary` | an LLM-condensed version | summarizer model, optional instruction. Configurable in v1; the LLM call happens only in v2 |
| `outcome-only` | the decision exit taken plus evaluator notes, no content | none |

The **history** toggle on loop edges decides whether a retrying agent sees only the latest feedback or all previous attempts.

### 7.4 Decision nodes and evaluators

A decision node receives input, applies an evaluator, and exits through exactly one labeled exit. It **passes its input through** on the chosen exit, together with the evaluator's notes (e.g. a failure reason). Success criteria for agents are expressed by placing a decision node after them; the agent itself has no success setting.

An **evaluator type dropdown** has three options:

1. **Deterministic (code)**
   - A code editor (Monaco) with a language selector. Python is the only option in the MVP, but keep the selector so other languages can be added.
   - The user can also drag and drop an existing code file.
   - **Never run in v1.** Show a clear "runs in v2" hint near the editor.
   - Draft contract for v2 (document it in the UI help text, don't implement it): the code receives the decision's input, exit code 0 means the first exit (e.g. pass), non-zero means the second (e.g. fail), optional JSON on stdout supplies notes or a custom exit label.
2. **Agent**
   - Pick an agent (typically a small classifier).
   - Write criteria text.
   - Define exit labels (e.g. `bug` / `feature` / `question`). This is how routers work.
3. **Human**
   - Write instructions for the reviewer.
   - Define exit labels (default `approve` / `reject`).
   - Choose whether the reviewer may attach feedback.

**Loops:**
- Every loop **must** pass through a decision exit with `maxIterations`, configured on that exit. Once the capped exits are taken out, nothing may still go round in a circle. A loop without any decision (e.g. agent → agent → back) is therefore not allowed: only decisions branch, so nothing could stop it. The UI and the server block saving (and merging) a workflow with an uncapped loop.
- An optional `onExhausted` exit (where to go when the cap is hit) **[default: stop and request human attention]**.

### 7.5 Joins

Any node with more than one incoming edge has a **join mode**. Edges that come back round a loop and reads from a shared store don't count (a loop-back re-runs its target with the latest of its other inputs; a store read is access, not a trigger), and shared stores never join:
- `all`: wait for every input (fan-in)
- `any`: proceed on first input
- `n-of-m`: proceed when N inputs arrived (quorum, ensemble voting)

### 7.6 Agent limits

Iterations, tokens and wall time are configured on the agent (defaults) and overridable per project. Behavior when a limit is exceeded is a v2 concern **[default: the run halts and requests human attention]**, but store the limits in v1.

### 7.7 Patterns as composite nodes

**Authoring (Patterns tab):**
- A pattern is edited on the same canvas as workflows.
- It has **Input** and **Output** boundary nodes; each becomes a port on the composite.
- Agent nodes inside a pattern are **slots**: a role name, an optional description, and an optional default agent.
- Patterns may contain other patterns (nesting is required; the hierarchy pattern depends on it).

**Using a pattern in a workflow:**
1. Drag a pattern onto the canvas.
2. A dialog asks the user to bind each slot to an agent.
3. External edges always connect to **ports**, never directly to internal nodes.

**Collapse / expand (view state only; the data model is identical either way):**
- **Collapsed:** one node showing the name, ports, slot bindings, version badge, and modified badge if forked.
- **Expanded:** a framed group showing internal nodes and edges. Ports sit on the frame edge, and external edges visibly route through them to the internal nodes they feed.
- Nested patterns expand one level at a time.
- Collapse/expand should animate smoothly. This is a showcase interaction.

**Forking and promotion:**
- Editing an instance's internals creates a fork: a branch of the pattern, pinned by that instance and marked "modified".
- A fork can be **promoted**:
  - **Merge to main:** creates a new main version, then runs the propagation flow from section 8.
  - **Save as new pattern.**
- If main changed since the fork, show both versions side by side before merging. Three-way merge is not required.

## 8. Versioning, branching and propagation

All library entities (skills, tool presets, agents, patterns, workflow templates) and projects are versioned in the library store.

### 8.1 Model [default implementation; deviate only with good reason and record it]

- **Editing is always on a branch.** Opening an entity for edit creates or reuses a draft branch. Save = commit on that branch.
- **Merge to main** creates a new main version (`v1`, `v2`, …), implemented as git tags such as `agent/<id>/v3`, with branches named such as `agent/<id>/<branch>`.
- The UI shows history, branches, and a diff between any two versions.

**Implementation warning:** the library store is one repo with many entities. The server must **not** switch the main working tree to edit a branch, because that would change every entity at once. Read other versions via git objects (`git show <ref>:<path>`) and write branches via `git worktree` or plumbing commands. Choose one approach and record it in `DECISIONS.md`.

### 8.2 Propagation (on merge to main)

When an entity is merged to main, the user gets a **cascade preview** before anything else changes:

1. Compute everything that references the entity, transitively. For example, skill → agents using it → patterns with those agents in slots → workflows and projects using those.
2. Show every affected instance in a list or tree, with what will change.
3. The user can **accept all**, **decline all**, or **accept or decline each case individually**.
4. Accepted instances move to the new version. Overrides are preserved.
5. **Forked instances are never auto-propagated.** They are listed but excluded by default.

### 8.3 Update notifications

When a user opens a project or template containing an instance pinned to an older version:
- A small icon appears on that node, e.g. "update available: v2 → v4".
- Clicking it shows what changed and lets the user update this one instance.
- Existing workflows never change automatically, the same way dependencies in a codebase don't upgrade themselves.

### 8.4 Built-ins and deletion

- The 10 built-in patterns and seeded demo content are ordinary editable, deletable entities.
- **Settings → Restore defaults** re-adds any missing built-in pattern without touching edited ones **[default]**.
- **Deleting an entity that is still referenced** by a versioned entity (a version on main): show the list of references and require confirmation. For the referencing entities, the user chooses, for all at once or for each one individually:
  - **Keep as local copy:** the referencing entity embeds a copy of the deleted entity's content and keeps working.
  - **Replace with a placeholder:** the reference is removed. A placeholder shows that a referenced entity (last known name and version) was deleted.
- **References that exist only on a draft branch** don't count: the entity is deleted without a prompt. A draft is not materialized yet, so a dangling reference on it is acceptable; the editor shows it as missing.

## 9. UI and UX

The UX quality bar is high: this MVP is a sales tool.

### 9.1 Navigation (tabs)

| Tab | Content |
|---|---|
| **Projects** | Home screen. Project list, "new project" (blank or from template), workflow templates. |
| **Agents** | List + editor (prompt in Monaco markdown, pick skills and tool presets, defaults). |
| **Skills** | List + markdown editor with frontmatter fields. |
| **Tools** | Built-in catalog (read-only) + presets (create/edit/delete with scope editor). |
| **Patterns** | Library of patterns + pattern canvas editor. |
| **Settings** | Model list, default model/effort/limits, restore defaults, library store location. |

Every entity editor shows the version and branch state, plus access to history and diff.

### 9.2 Creating a project

1. Name, description, workspace path (validated as a git repo, with `git init` offered).
2. Start blank or from a template.
3. Land on the workflow canvas.

### 9.3 Canvas

- Add nodes from a palette and from a quick-add command palette (`Cmd/Ctrl+K`).
- Drag to connect; invalid connections are prevented with an explanation (e.g. a Note cannot be connected).
- **Inspector side panel** for the selected node or edge. It shows all configuration from section 7, including context mode and its settings for edges, and overrides for agent nodes (clearly separated from fields that would fork).
- Undo/redo, multi-select, copy/paste, minimap, zoom-to-fit. Saving is explicit (Save / Ctrl+S, commits to the draft branch) with an unsaved-changes guard, like every other editor. Autosave is deferred to v2.
- Distinct visual language:
  - Decision nodes as diamonds.
  - Back-edges curved with an iteration-cap badge.
  - Context mode shown as a small label or icon on each edge.
  - Unrestricted-shell and modified/update-available badges on nodes.

### 9.4 Context preview

Select an agent node and open **Context preview** to see exactly what that agent would receive:
- its prompt
- each skill (name, description, body)
- each tool preset with its scope
- each incoming edge with its context mode explained in plain words, e.g. "PLAN.md — only section `## Tasks`" or "test report — summary, latest attempt only"

**No token estimates.** This feature is the core demonstration of the product's value; make it clear and good-looking.

### 9.5 Live validation

Show warnings and errors on the canvas (node/edge highlight) and in a collapsible problems panel. An uncapped loop blocks saving; **any error blocks merging** (a version on main must be complete); warnings block neither. At minimum:
- A back-edge without `maxIterations` (blocks save).
- An agent writes an Artifact but has no write tool covering its path.
- A `reference` context mode where the receiving agent has no read tool covering the path.
- An unconnected required pattern port, or an unbound slot.
- A Decision exit with no outgoing edge, or an evaluator with no exits defined.
- A node unreachable from the workflow Input.
- An unrestricted shell preset in use (warning, not error).

### 9.6 Seeded demo content

On first launch the library contains:
- A few skills, e.g. "write unit tests", "code review checklist".
- Tool presets, e.g. "read src", "write tests", "run tests (shell: `npm test`)", "web search".
- Agents: Planner, Executor, Tester, Reviewer, Router.
- All 10 built-in patterns (section 10).
- Two example projects with a demo workspace repo the app creates in its data folder:
  1. Prompt → Planner → PLAN.md → Executor → code → Tester → Decision ("tests pass?", deterministic) with a back-edge to the Executor (max 3, summary, latest only) → Output.
  2. A router workflow: ticket → Decision (agent evaluator: bug / feature / question) → different agents or patterns per branch, including a Maker-Checker instance.

## 10. Built-in pattern library

Each pattern lists its slots and ports. Internal shapes use the node and edge types from section 7.

| Pattern | Slots | Shape |
|---|---|---|
| **Pipeline** | Step 1…N | `in → S1 → S2 → … → SN → out` |
| **Router** | Router (agent evaluator), Branch 1…N | `in → ◇Router◇ → one branch → join(any) → out` |
| **Fan-out / fan-in** | Worker 1…N, Aggregator | `in → all workers in parallel → join(all) → Aggregator → out` |
| **Supervisor** | Supervisor, Worker 1…N | `in → Supervisor → ◇delegate?◇ → chosen worker → back to Supervisor` (loop, capped); exit `done → out` |
| **Hierarchy** | Top supervisor; workers are nested Supervisor pattern instances | Supervisor whose delegation targets are themselves Supervisor patterns |
| **Handoff** | Agent 1…N | The *active* agent decides mid-task whom to hand off to: `agent → ◇handoff: A/B/C/finish◇`. Unlike Router, the decision repeats after every agent. Capped. |
| **Maker-checker** | Maker, Checker | `in → Maker → Checker → ◇approved?◇ → yes: out / no: back to Maker` (summary feedback, capped) |
| **Ensemble** | Member 1…N, optional Aggregator | Same input to all members in parallel → join(all or n-of-m) → Aggregator agent or deterministic vote → out |
| **Moderated discussion** | Moderator, Participant 1…N | Shared store holds the transcript (all read, each writes). `Moderator → ◇next speaker / conclude◇ → participant → back to Moderator`. Capped. `conclude → out` |
| **Blackboard** | Controller, Specialist 1…N | Shared store holds the evolving solution. `Controller → ◇which specialist / done◇ → specialist (reads/writes store) → back to Controller`. Capped. |

For N-slot patterns, the insert dialog lets the user choose N **[default: 2–3 initially, adjustable]**.

## 11. Milestones (MVP)

Stop and report at the end of each milestone.

### M0: Foundation
pnpm monorepo, `packages/schema` with Zod types for every entity in sections 6–7, Fastify server, library store initialization, git wrapper, SQLite index rebuild, React app shell with tab navigation.
**Done when:** the app starts with one command; entities can be created, read, updated and deleted via the API, are stored as files and committed in git, and the index can be deleted and rebuilt from git.

### M1: Library tabs
Skills, Tools (catalog + presets with scope editors and the shell warning), Agents, Settings (model list).
**Done when:** a user can create a skill, a scoped preset and an agent that uses both, entirely in the UI.

### M2: Versioning
Draft branches, commits, merge to main with version numbers, history, diff view, branch indicator in every editor.
**Done when:** editing an agent happens on a branch, merging creates `v2`, and history and diffs are viewable.

### M3: Projects and canvas
Project creation (workspace validation, `git init` offer), canvas with all node types except Pattern, edges with all properties, inspector, overrides vs fork distinction, layout persisted separately, undo/redo.
**Done when:** demo workflow 1 from section 9.6 can be built by hand, saved, reloaded, and looks identical.

### M4: Decisions, validation, context preview
Decision node with the three evaluators (Monaco Python editor + file drop, nothing executed), exit labels, loop caps, join modes, every validation rule in 9.5, context preview panel.
**Done when:** a back-edge without a cap blocks saving, every validation rule can be triggered and resolved, and context preview correctly reflects each context mode.

### M5: Patterns
Pattern editor (boundary nodes, slots, nesting), the 10 built-ins, insert with slot binding, collapse/expand with animation, ports on the frame, forking with the modified badge, promotion (merge or save-as-new).
**Done when:** Maker-Checker can be inserted, bound, expanded, collapsed, forked, edited and promoted back to the library as a new version.

### M6: Propagation and updates
Transitive reference computation, cascade preview with accept all / decline all / per-case, forks excluded, overrides preserved, update-available icons and per-instance update, deletion-with-references flow, restore defaults.
**Done when:** changing a skill used by two agents in three projects shows the full cascade, and each choice produces the expected pinned versions.

### M7: Polish and demo
Seeded demo content and demo workspace, empty states, keyboard shortcuts, visual consistency, dark mode, performance on a 100-node workflow.
**Done when:** a first-time user lands on a populated, good-looking app and can open, understand and modify both example projects without explanation.

## 12. Design-for-v2 checklist

Before finishing the MVP, confirm a v2 engine could execute a saved workflow **without any schema change**:

- [ ] Every agent instance resolves to a pinned prompt, skill set, tool scopes, model, effort and limits.
- [ ] Every edge has a payload type and a fully specified context mode.
- [ ] Every decision has an evaluator, exit labels, and caps on every back-edge.
- [ ] Every join has a mode.
- [ ] Artifacts have workspace-relative paths; tool steps have a preset plus arguments.
- [ ] Deterministic evaluator code is stored with its language.
- [ ] The workspace is a git repo (v2 will use it for checkpoints and rollback).

## 13. Decisions log (made during planning)

- 1 project = 1 workflow. Several projects may point at the same workspace repo.
- The workspace must be a git repo; rollback safety in v2 depends on it.
- Only decision nodes branch. Edges carry payload and context mode only.
- Evaluators: deterministic (code), agent, human. All configurable in v1, none executed.
- Deterministic evaluators are Python in the MVP; multi-language support via a language-agnostic contract comes in v2.
- Context modes: full, reference, excerpt, diff, summary, outcome-only, plus a history toggle on loops.
- Patterns are composite nodes with boundary-node ports and slots; collapse/expand is view state only.
- Everything is versioned in git. Instances pin versions. Updates are opt-in, via the cascade preview or per-instance icons.
- Model, effort and limits are per-project overrides without branching; prompt, skills and tools changes fork.
- No token estimates, no export, no execution in the MVP.
- Stack: TypeScript end to end (React, React Flow, Monaco, Tailwind/shadcn, Fastify, simple-git, SQLite).
