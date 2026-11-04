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

## Check
```sh
pnpm check        # typecheck + lint + unit/API tests
pnpm test:e2e     # browser tests (Playwright, uses your installed Google Chrome)
```

## Layout
- `packages/schema`: Zod types shared by server and web (single source of truth)
- `apps/server`: Fastify API, library store (git), SQLite index
- `apps/web`: React + Vite app
