import type { z } from 'zod';
import type { ENTITY_SCHEMAS, EntityByKind, EntitySummary } from './entities.js';
import type { EntityKind, Ref } from './ids.js';

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

export interface EntityMutationResponse<K extends EntityKind> {
  entity: EntityByKind[K];
  /** Null when an update changed nothing (no commit was made). */
  commit: CommitInfo | null;
}

export interface DeleteResponse {
  commit: CommitInfo;
}

export interface ListResponse {
  items: EntitySummary[];
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
  error: 'not_found' | 'validation' | 'conflict' | 'internal';
  message: string;
  issues?: { path: (string | number)[]; message: string }[];
}
