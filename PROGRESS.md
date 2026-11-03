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
- `PLAN.md` and `CLAUDE.md` are in `.gitignore`, so they are not committed. Is that intended?
