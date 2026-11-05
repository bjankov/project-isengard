import type { z } from 'zod';
import type { ENTITY_SCHEMAS, EntityByKind, EntitySummary, Settings } from './entities.js';
import type { EntityKind, Ref } from './ids.js';
import type { EntityVersionSummary, VersionStatus } from './versioning.js';
import type { WorkflowProblem } from './workflow/validate.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Body of `POST /api/<kind>` and `PUT /api/<kind>/<id>`: the entity without its id. */
export type EntityInput<K extends EntityKind> = DistributiveOmit<
  z.input<(typeof ENTITY_SCHEMAS)[K]>,
  'id'
>;

export interface CommitInfo {
  hash: string;
  message: string;
}

/**
 * `POST /api/<kind>` (creates `v1` on main) and `PUT /api/<kind>/<id>` (commits to the draft
 * branch). `entity` is what was saved.
 */
export interface EntityMutationResponse<K extends EntityKind> {
  entity: EntityByKind[K];
  /** Null when an update changed nothing (no commit was made). */
  commit: CommitInfo | null;
  status: VersionStatus;
}

/** `POST /api/<kind>/<id>/merge`. `entity` is the new main version. */
export interface MergeResponse<K extends EntityKind> {
  entity: EntityByKind[K];
  commit: CommitInfo;
  /** The version the merge created, e.g. `v2`. */
  version: string;
  status: VersionStatus;
}

/** `DELETE /api/<kind>/<id>/branches/<branch>`. */
export interface DiscardBranchResponse {
  status: VersionStatus;
}

export interface DeleteResponse {
  commit: CommitInfo;
}

export type EntityListItem = EntitySummary & EntityVersionSummary;

export interface ListResponse {
  items: EntityListItem[];
}

/** `GET /api/<kind>?full=1`: complete entities (as on main) instead of summaries. */
export interface FullListResponse<K extends EntityKind> {
  items: EntityByKind[K][];
  /** Version state per entity id. */
  versions: Record<string, EntityVersionSummary>;
}

export interface SettingsResponse {
  settings: Settings;
  /** Where the library store lives on disk (read-only in the UI). */
  libraryDir: string;
}

export interface SettingsMutationResponse {
  settings: Settings;
  commit: CommitInfo | null;
}

export interface ReferencedErrorBody {
  error: 'conflict';
  message: string;
  /** Entities that still reference the one being deleted. */
  references: (EntitySummary & { version: string })[];
}

/**
 * What happens to an entity that pins one being deleted (PLAN.md 8.4): it keeps a local copy
 * of the deleted entity and keeps working, or the reference becomes a placeholder.
 */
export type DeleteResolution = 'copy' | 'placeholder';

/** Body of `POST /api/<kind>/<id>/delete`: delete an entity that is still referenced. */
export interface DeleteRequest {
  /** For every referencing entity not listed in `each`. */
  all?: DeleteResolution;
  /** Per referencing entity, keyed `<kind>/<id>`. */
  each?: Record<string, DeleteResolution>;
}

/** `POST /api/<kind>/<id>/delete`. */
export interface DeleteWithReferencesResponse {
  commit: CommitInfo;
  /** Referencing entities that got a new main version (with the copy or placeholder). */
  updated: { kind: EntityKind; id: string; version: string }[];
}

export interface ReferencesResponse {
  /** Entities this entity references. */
  outgoing: Ref[];
  /** Entities that reference this entity (any version). */
  incoming: { kind: EntityKind; id: string; version: string }[];
}

export interface HealthResponse {
  ok: true;
  gitVersion: string;
  libraryDir: string;
  indexPath: string;
  libraryHead: string;
}

export interface RebuildResponse {
  entities: number;
  references: number;
  head: string;
  /** Entities whose files exist but do not validate; left out of the index. */
  invalid: { kind: EntityKind; id: string; message: string }[];
}

export interface ApiErrorBody {
  /**
   * `merge_conflict` (409): main changed since the branch started; retry with `force` to
   * overwrite. `bad_request` (400): e.g. merging a branch with no changes. `workflow` (400): the
   * workflow has problems that block saving (uncapped loops) or merging (any error), in
   * `problems`.
   */
  error:
    | 'not_found'
    | 'validation'
    | 'bad_request'
    | 'conflict'
    | 'merge_conflict'
    | 'workflow'
    | 'internal';
  message: string;
  issues?: { path: (string | number)[]; message: string }[];
  problems?: WorkflowProblem[];
}

/**
 * Result of checking a workspace folder (`POST /api/workspace/check`).
 * - `ok`: an existing folder that is the root of a git repo
 * - `inside-repo`: a folder inside a git repo; `repoRoot` is the repo's root
 * - `not-a-repo`: an existing folder that is not in a git repo (`git init` can be offered)
 */
export type WorkspaceStatus =
  | 'ok'
  | 'not-absolute'
  | 'not-found'
  | 'not-a-directory'
  | 'not-a-repo'
  | 'inside-repo'
  | 'is-library'
  /** For a new folder: something already exists at the path. */
  | 'exists';

export interface WorkspaceCheck {
  /** The path as checked: `~` expanded, normalized, no trailing slash. */
  path: string;
  status: WorkspaceStatus;
  /** Root of the enclosing repo for `inside-repo`. */
  repoRoot?: string;
  /** Explanation for anything but `ok`. */
  message?: string;
  /** Something worth knowing even when `ok`, e.g. a new repo nested inside another one. */
  warning?: string;
}

/** `GET /api/workspace/suggest?path=`: folders matching a partly typed path. */
export interface WorkspaceSuggestions {
  items: { path: string; isGitRepo: boolean }[];
}
