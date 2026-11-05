# Agentic Workflow Designer (working name)

A local GUI for designing agentic development workflows. See `PLAN.md` for the spec,
`PROGRESS.md` for status and `DECISIONS.md` for implementation decisions.

## Requirements
- Node 22+
- pnpm 10 (`npm install -g pnpm`)
- git

## Run
```sh
pnpm install
pnpm dev          # API on :4317, web app on :5173 (opens the browser)
```
`pnpm install` says "Ignored build scripts: better-sqlite3": that's expected, it ships prebuilt
binaries. Don't approve its build (that needs `node-gyp`).

Data lives in `~/.app` (`library/` is a git repo, `index.db` is a rebuildable index).
Set `APP_HOME=/some/dir` to use another folder, `APP_NO_OPEN=1` to not open the browser.

## Versions
Library entities are versioned in the library repo:
- Creating an entity makes `v1` on `main`.
- Saving an edit commits to the entity's draft branch (`agent/<id>/draft`); `main` is unchanged.
- **Merge as vN** in the editor publishes the draft to `main` and tags `agent/<id>/vN`.
- The clock button in the editor header opens the history, where any two versions or draft saves
  can be compared side by side.

`~/.app/library` always shows `main`. Inspect versions with git, e.g.
`git -C ~/.app/library log --oneline --graph --all`.

## Projects
**Projects → New project**: give it a name and the path of the git repo it works on (the app
offers `git init` if needed). The canvas opens:
- add nodes from the palette (drag or click) or with `Ctrl/Cmd+K`; with one node selected, the
  new node is added after it and connected
- drag between handles to connect; click a node or edge to configure it on the right
- `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` undo and redo, `Ctrl/Cmd+C`/`V` copy and paste, `Delete`
  removes the selection, `Ctrl/Cmd+S` saves (to the project's draft)
- **Problems** (the bar under the canvas): the workflow is checked as you edit. Nodes and edges
  with errors are outlined red, warnings amber; click a problem to jump to it, and some have a
  one-click fix. A loop without a cap blocks saving; any error blocks merging.
- **Context preview** (select an agent, press `P`): exactly what that agent receives: its prompt,
  skills, tools with their scopes, and each input as its edge's context mode delivers it
- decisions: the evaluator (code, agent or human), its exits in order, and what happens when a
  loop's cap is hit; deterministic code is Python in a code editor (drop a `.py` file on it).
  Nothing is ever run in this version.

## Patterns
Reusable multi-agent structures (maker-checker, fan-out, router…). The library starts with the
10 built-ins (they're ordinary patterns: edit or delete them).
- **Patterns tab**: open one, or **New pattern**. It is edited on the same canvas as a workflow:
  Input and Output nodes are its ports, agent nodes are **Slots** (a role, optionally with a
  default agent), and a node's **Repeat** field makes it one of N copies (e.g. Worker 1…N).
  The pattern panel (click the empty canvas) sets each repeat group's range and whether copies
  run in parallel or one after another. Patterns can contain other patterns.
- **In a project**: **Pattern…** in the palette (or `Ctrl/Cmd+K`) inserts one: choose how many
  copies, and bind each slot to an agent. Connect to its ports. The expand button (or a
  double-click) opens it in place, read-only, with its ports on the frame; agents inside can
  get project overrides there.
- **Customize for this project** forks the instance: **Edit fork** changes what's inside, just
  for this node (marked **modified**). Promote the fork from the inspector: **Merge to main**
  (the pattern's next version) or **Save as new pattern**. Agent forks are promoted the same way.

## Check
```sh
pnpm check        # typecheck + lint + unit/API tests
pnpm test:e2e     # browser tests (Playwright, uses your installed Google Chrome)
```

## Layout
- `packages/schema`: Zod types shared by server and web (single source of truth)
- `apps/server`: Fastify API, library store (git), SQLite index
- `apps/web`: React + Vite app
