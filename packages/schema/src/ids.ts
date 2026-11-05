import { z } from 'zod';

/** Library entity kinds stored in the library store. */
export const EntityKind = z.enum(['skill', 'tool', 'agent', 'pattern', 'template', 'project']);
export type EntityKind = z.infer<typeof EntityKind>;
export const ENTITY_KINDS = EntityKind.options;

const ID_SUFFIX_LENGTH = 6;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Stable entity id: a slug of the name at creation time plus a short random suffix,
 * e.g. `planner-k3x9qa`. Never changes on rename.
 */
export const EntityId = z
  .string()
  .regex(/^(?:[a-z0-9]+-)+[a-z0-9]{6}$/, 'expected "<slug>-<6 chars>", e.g. "planner-k3x9qa"')
  .max(80);
export type EntityId = z.infer<typeof EntityId>;

export function slugify(name: string, maxLength = 40): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'entity';
}

export function makeEntityId(name: string): EntityId {
  const bytes = new Uint8Array(ID_SUFFIX_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let suffix = '';
  for (const b of bytes) suffix += ID_ALPHABET[b % ID_ALPHABET.length];
  return `${slugify(name)}-${suffix}`;
}

/** A main version (`v3`) or a branch name. */
export const MainVersion = z.string().regex(/^v[1-9][0-9]*$/);
export const BranchName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'invalid branch name')
  .refine((b) => !/^v[0-9]+$/.test(b), 'branch names must not look like main versions');
export const Version = z.union([MainVersion, BranchName]);
export type Version = z.infer<typeof Version>;

/** A pinned reference to a library entity. Nothing ever floats to "latest". */
export const Ref = z.object({
  kind: EntityKind,
  id: EntityId,
  version: Version,
});
export type Ref = z.infer<typeof Ref>;

function refOf<K extends EntityKind>(kind: K) {
  return z.object({ kind: z.literal(kind), id: EntityId, version: Version });
}
export const SkillRef = refOf('skill');
export type SkillRef = z.infer<typeof SkillRef>;
export const ToolRef = refOf('tool');
export type ToolRef = z.infer<typeof ToolRef>;
export const AgentRef = refOf('agent');
export type AgentRef = z.infer<typeof AgentRef>;
export const PatternRef = refOf('pattern');
export type PatternRef = z.infer<typeof PatternRef>;
export const TemplateRef = refOf('template');
export type TemplateRef = z.infer<typeof TemplateRef>;

/**
 * Stable string key of a pinned reference, `<kind>/<id>@<version>`, e.g.
 * `skill/write-tests-k3x9qa@v2`. Keys local copies and deleted placeholders.
 */
export const RefKey = z
  .string()
  .regex(
    /^(skill|tool|agent|pattern|template|project)\/[a-z0-9-]+@[A-Za-z0-9._-]+$/,
    'expected "<kind>/<id>@<version>"',
  );
export type RefKey = z.infer<typeof RefKey>;

export function refKey(ref: Pick<Ref, 'kind' | 'id' | 'version'>): RefKey {
  return `${ref.kind}/${ref.id}@${ref.version}`;
}

export function parseRefKey(key: string): Ref | undefined {
  const m = /^([a-z]+)\/([a-z0-9-]+)@(.+)$/.exec(key);
  if (!m) return undefined;
  const parsed = Ref.safeParse({ kind: m[1], id: m[2], version: m[3] });
  return parsed.success ? parsed.data : undefined;
}

/** Common display fields of every library entity. */
export const EntityMeta = z.object({
  id: EntityId,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).default(''),
});

/** Ids local to a graph (node ids, edge ids, exit ids, port ids). */
export const LocalId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'local ids may contain letters, digits, "_" and "-"');
export type LocalId = z.infer<typeof LocalId>;

const PATH_SEGMENT = '[A-Za-z0-9_-]+(?:@[1-9][0-9]*)?';

/**
 * A node inside pattern instances, as a path of node ids from the outermost graph:
 * `review-k2f8/maker`, or `team-a1b2/worker@2` for the 2nd copy of a repeated node. A plain
 * `LocalId` is a path of one segment. Used for slot bindings (relative to the pattern) and
 * project overrides (relative to the workflow).
 */
export const NodePath = z
  .string()
  .max(400)
  .regex(
    new RegExp(`^${PATH_SEGMENT}(?:/${PATH_SEGMENT})*$`),
    'expected node ids joined by "/", e.g. "review-k2f8/maker" or "team-a1b2/worker@2"',
  );
export type NodePath = z.infer<typeof NodePath>;

/** Path of the `copy`-th copy (1-based) of a node in a repeat group, e.g. `worker@2`. */
export function copyId(id: string, copy: number): string {
  return `${id}@${String(copy)}`;
}

/** Path of a node inside an instance: `<instance path>/<inner id>`. */
export function joinPath(prefix: string, id: string): string {
  return prefix ? `${prefix}/${id}` : id;
}
