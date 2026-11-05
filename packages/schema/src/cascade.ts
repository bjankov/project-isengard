/**
 * Cascade preview and propagation (PLAN.md 8.2): when an entity gets a new main version,
 * everything that pins an older version of it, transitively, can be moved to the new version.
 *
 * The server computes the cases; the client shows them as a tree and picks which to accept.
 * Both use `enabledCases` to decide which accepted cases actually apply: a case moves its
 * referrer to the target's new version, so it only applies when the target itself gets that
 * version (it is a root, or one of its own cases is accepted).
 */
import type { CommitInfo } from './api.js';
import type { EntityKind } from './ids.js';
import type { LocationRole } from './references.js';
import type { WorkflowProblem } from './workflow/validate.js';

/** `agent/<id>` for an entity on main, `agent/<id>#<branch>` for a fork branch of it. */
export function entityKey(kind: EntityKind, id: string, branch?: string): string {
  return branch ? `${kind}/${id}#${branch}` : `${kind}/${id}`;
}

export interface CascadeEntity {
  /** `entityKey` of the entity (with the branch for forks). */
  key: string;
  kind: EntityKind;
  id: string;
  name: string;
  /** For a fork: the fork branch whose content pins the target. */
  branch?: string;
  /** Current main version. */
  version: string | null;
  /** The main version accepting one of its cases creates (not for forks). */
  next?: string;
  /** Whether it has an unmerged draft (the update is applied to the draft too). */
  hasDraft: boolean;
  /** A root of the cascade: the entity that got the new version. */
  root?: boolean;
  /**
   * Errors that accepting every default case would add (they would block merging). Such an
   * update is refused until the cases are declined or the cause is fixed.
   */
  problems: WorkflowProblem[];
}

export interface CascadeCase {
  /** Unique: `<referrer key>:<location key>`. */
  id: string;
  /** `CascadeEntity.key` of the entity that pins the target. */
  referrer: string;
  /** Where inside the referrer (see `RefLocation.key`). */
  location: string;
  role: LocationRole;
  /** Human label of the location, e.g. `Node “Executor”`. */
  label: string;
  /** `CascadeEntity.key` of the pinned entity (always on main). */
  target: string;
  /** Pinned now: an older main version, or a fork branch name for `pins-fork`. */
  from: string;
  /** The target's new version. */
  to: string;
  /**
   * `in-fork`: the referrer is a fork (a branch pinned by a project); accepting commits to the
   * fork branch. `pins-fork`: the location pins a fork of the target; accepting re-pins it to
   * the new main version and drops the customization. Forks are excluded by default.
   */
  fork?: 'in-fork' | 'pins-fork';
  /** For `pins-fork`: the fork branch no longer exists (accepting is the only fix). */
  danglingFork?: boolean;
}

/** `POST /api/cascade/preview`. */
export interface CascadePreview {
  roots: string[];
  entities: CascadeEntity[];
  cases: CascadeCase[];
}

export interface CascadeRoot {
  kind: EntityKind;
  id: string;
}

/** Body of `POST /api/cascade/preview`. */
export interface CascadePreviewRequest {
  roots: CascadeRoot[];
}

/** Body of `POST /api/cascade/apply`. */
export interface CascadeApplyRequest {
  roots: CascadeRoot[];
  /** Case ids to accept. Cases that don't apply (their target isn't updated) are refused. */
  accept: string[];
}

export interface CascadeUpdated {
  kind: EntityKind;
  id: string;
  /** The new main version, or undefined for a fork branch update. */
  version?: string;
  branch?: string;
}

/** `POST /api/cascade/apply`. */
export interface CascadeApplyResponse {
  updated: CascadeUpdated[];
  /** The last commit on main, or null when only fork branches changed (or nothing). */
  commit: CommitInfo | null;
}

/** Cases accepted unless the user says otherwise: everything but forks (PLAN.md 8.2). */
export function defaultAccepted(preview: Pick<CascadePreview, 'cases'>): Set<string> {
  return new Set(preview.cases.filter((c) => !c.fork || c.danglingFork).map((c) => c.id));
}

/**
 * The accepted cases that apply: a case applies when its target is a root, or when an
 * applying case updates the target (only main referrers produce new versions).
 */
export function enabledCases(
  preview: Pick<CascadePreview, 'roots' | 'cases'>,
  accepted: ReadonlySet<string>,
): Set<string> {
  const updated = new Set(preview.roots);
  const enabled = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of preview.cases) {
      if (enabled.has(c.id) || !accepted.has(c.id) || !updated.has(c.target)) continue;
      enabled.add(c.id);
      changed = true;
      if (c.fork !== 'in-fork') updated.add(c.referrer);
    }
  }
  return enabled;
}

/** Whether the case can be chosen at all, given the current choices. */
export function caseAvailable(
  preview: Pick<CascadePreview, 'roots' | 'cases'>,
  c: CascadeCase,
  enabled: ReadonlySet<string>,
): boolean {
  if (preview.roots.includes(c.target)) return true;
  return preview.cases.some(
    (o) => o.referrer === c.target && o.fork !== 'in-fork' && enabled.has(o.id),
  );
}
