# CLAUDE.md

## Project
The full specification is in `PLAN.md`. It is the source of truth for scope, data model, semantics and milestones. Progress lives in `PROGRESS.md`, and decisions made during implementation live in `DECISIONS.md`. Create either file if it doesn't exist.

## How we work: one milestone per session

### 1. Start of session
- Read `PLAN.md`, `PROGRESS.md` and `DECISIONS.md` before doing anything else.
- Confirm which milestone we are on. If I haven't said, propose the next unfinished one and wait for my answer.
- Propose an implementation plan for **that milestone only**:
  - files and packages you will create or change
  - order of work
  - libraries you intend to add
  - anything in `PLAN.md` that is ambiguous for this milestone
- **Wait for my approval before writing code.**

### 2. During the milestone
- Work on a branch named `milestone/M<n>`. Commit small, logical steps with clear messages. Never commit to `main`.
- Stay inside the milestone. Do not start work belonging to later milestones, and never build anything listed under non-goals in `PLAN.md`.
- If `PLAN.md` is silent on a detail:
  1. Pick the simplest option consistent with its guiding principles.
  2. Log it in `DECISIONS.md` with the date, the milestone, the decision, and the reason.
- If a decision is significant or hard to reverse, ask me first instead.
- If something in `PLAN.md` seems wrong or unworkable, stop and tell me. Propose a change to `PLAN.md`; don't silently diverge from it.
- `packages/schema` is the single source of truth for data types. Never duplicate types elsewhere.

### 3. Before saying the milestone is done
- Check every "done when" criterion for this milestone in `PLAN.md`, one by one.
- Run type checking, linting and tests, and fix any failures.
- For UI work, start the app and confirm it actually works and looks right.
- Do not claim something works if you haven't verified it. Say what you couldn't verify.

### 4. End of milestone
Update `PROGRESS.md` using this format:

```
## M<n>: <name> (<date>)
Status: done | partially done
Built: <short list>
How to try it: <commands and what to click>
Deviations from PLAN.md: <list or "none">
Open issues / questions: <list or "none">
```

Then reply with:
- a short summary
- how to try it
- deviations from `PLAN.md`
- questions for me

**Then stop.** Do not begin the next milestone. I will review, merge the branch, and start a fresh session for the next one.

## Conventions
- TypeScript in strict mode, pnpm workspaces, stack as listed in `PLAN.md` section 5.2.
- Ask before adding major dependencies not named in `PLAN.md`.
- Keep this file short. Detailed specs belong in `PLAN.md`, not here.
