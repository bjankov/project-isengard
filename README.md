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

## Check
```sh
pnpm check        # typecheck + lint + tests
```

## Layout
- `packages/schema`: Zod types shared by server and web (single source of truth)
- `apps/server`: Fastify API, library store (git), SQLite index
- `apps/web`: React + Vite app
