/**
 * Versioning of library entities (PLAN.md 8.1).
 *
 * - Main versions are git tags `<kind>/<id>/v<n>`. An entity's current version is its highest tag.
 * - Edits are commits on a branch `<kind>/<id>/<branch>`. In M2 every entity has at most one
 *   branch, the automatic `draft`.
 * - Merging a branch writes the entity's files onto `main` and tags the next version.
 */
import type { EntityKind } from './ids.js';
import { MainVersion } from './ids.js';

/** The branch every editor saves to. */
export const DRAFT_BRANCH = 'draft';

/** `v3` → 3; undefined for anything that is not a main version. */
export function versionNumber(version: string): number | undefined {
  return MainVersion.safeParse(version).success ? Number(version.slice(1)) : undefined;
}

export function versionName(n: number): string {
  return `v${n}`;
}

/** Git tag name of a main version, e.g. `agent/reviewer-a1b2c3/v3`. */
export function versionTagName(kind: EntityKind, id: string, version: string): string {
  return `${kind}/${id}/${version}`;
}

/** Git branch name of an entity branch, e.g. `agent/reviewer-a1b2c3/draft`. */
export function entityBranchName(kind: EntityKind, id: string, branch: string): string {
  return `${kind}/${id}/${branch}`;
}

/** Version state shown in lists. */
export interface EntityVersionSummary {
  /** Highest main version, e.g. `v3`. Null only for entities that were never tagged. */
  version: string | null;
  /** Whether the entity has an unmerged draft branch. */
  hasDraft: boolean;
}

export interface BranchInfo {
  /** Short branch name, e.g. `draft`. */
  name: string;
  /** Commit the branch points to. */
  head: string;
  /** Date of that commit (ISO 8601). */
  date: string;
  /** Commits on the branch that are not on main. */
  commits: number;
  /** Whether the entity's files on the branch differ from main. */
  changed: boolean;
}

/** `GET /api/<kind>/<id>/versions`; also returned by every versioning mutation. */
export interface VersionStatus {
  /** Highest main version, e.g. `v3`. */
  current: string | null;
  /** All main versions, newest first. */
  versions: string[];
  branches: BranchInfo[];
}

/** The draft branch of a status, if there is one. */
export function draftOf(status: VersionStatus | undefined): BranchInfo | undefined {
  return status?.branches.find((b) => b.name === DRAFT_BRANCH);
}

export interface HistoryCommit {
  hash: string;
  /** ISO 8601. */
  date: string;
  message: string;
}

export interface VersionInfo {
  version: string;
  /** Commit the version tag points to. */
  commit: string;
  /** When this version's content was last changed (ISO 8601). */
  date: string;
  /** Message of the commit that produced this version's content. */
  message: string;
  /** The note written when merging ("What changed?"), if any. */
  note?: string;
}

/** `GET /api/<kind>/<id>/history`. */
export interface HistoryResponse {
  /** Newest first. */
  versions: VersionInfo[];
  /** Each branch with its commits that are not on main, newest first. */
  branches: (BranchInfo & { log: HistoryCommit[] })[];
}

export interface FileDiff {
  /** Path inside the library store, e.g. `agents/reviewer-a1b2c3.yaml`. */
  path: string;
  /** Null when the file does not exist on that side. */
  before: string | null;
  after: string | null;
}

/**
 * `GET /api/<kind>/<id>/diff?from=&to=`. `from` and `to` are `main`, a version (`v2`),
 * a branch name (`draft`) or a commit hash. Only files that differ are listed.
 */
export interface DiffResponse {
  from: string;
  to: string;
  files: FileDiff[];
}

/** Longest merge note, in characters. */
export const MERGE_NOTE_MAX = 200;

/** Body of `POST /api/<kind>/<id>/merge`. */
export interface MergeRequest {
  /** Branch to merge; defaults to the draft. */
  branch?: string;
  /** Merge even though main changed since the branch started. */
  force?: boolean;
  /**
   * Optional one-line note on what changed (at most `MERGE_NOTE_MAX` characters). Stored as
   * the body of the merge commit and shown in the history.
   */
  note?: string;
}

/** Normalize a merge note to one trimmed line; undefined when empty. */
export function normalizeMergeNote(note: string | undefined): string | undefined {
  const line = (note ?? '').replace(/\s+/g, ' ').trim();
  return line === '' ? undefined : line;
}
