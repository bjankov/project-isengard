import { mkdir } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import {
  BUILTIN_PATTERNS,
  BranchName,
  DRAFT_BRANCH,
  MERGE_NOTE_MAX,
  ENTITY_KINDS,
  Settings,
  collectRefs,
  entityBranchName,
  isReferrerKind,
  makeEntityId,
  normalizeMergeNote,
  pruneLocal,
  repinAll,
  safeParseEntity,
  versionName,
  versionNumber,
  versionTagName,
  type BranchInfo,
  type CommitInfo,
  type RestoredEntity,
  type DemoContent,
  type DiffResponse,
  type AnyEntity,
  type EntityByKind,
  type EntityKind,
  type EntityListItem,
  type EntitySummary,
  type EntityVersionSummary,
  type FileDiff,
  type HistoryResponse,
  type ReferencesResponse,
  type VersionStatus,
} from '@app/schema';
import type { ZodError } from 'zod';
import { LibraryIndex, type IndexEntry } from '../index/library-index.js';
import { LibraryGit, MAIN_REF, type RefOp, type TreeOp } from '../git.js';
import { DEFAULT_SETTINGS } from './default-settings.js';
import { LAYOUTS, fromYaml, toYaml, type KindLayout } from './layout.js';

const SETTINGS_PATH = 'settings.yaml';

/** An entity the app ships with: a built-in pattern or demo content. */
interface DefaultEntity {
  kind: EntityKind;
  entity: AnyEntity;
}

function demoEntities(demo: DemoContent): DefaultEntity[] {
  return [
    ...demo.skills.map((entity) => ({ kind: 'skill' as const, entity })),
    ...demo.tools.map((entity) => ({ kind: 'tool' as const, entity })),
    ...demo.agents.map((entity) => ({ kind: 'agent' as const, entity })),
    ...demo.projects.map((entity) => ({ kind: 'project' as const, entity })),
  ];
}

export class NotFoundError extends Error {
  /** `what`: e.g. `version "v9"`, for something missing from an existing entity. */
  constructor(kind: EntityKind, id: string, what?: string) {
    super(what ? `${kind} "${id}" has no ${what}` : `${kind} "${id}" not found`);
    this.name = 'NotFoundError';
  }
}

/** A request that cannot be done in the current state, e.g. merging a branch without changes. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** Main changed since the branch started, so merging would overwrite those changes. */
export class MergeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeConflictError';
  }
}

export class EntityValidationError extends Error {
  constructor(
    message: string,
    readonly zodError: ZodError,
  ) {
    super(message);
    this.name = 'EntityValidationError';
  }
}

/** Deleting an entity that other entities still reference. */
export class ReferencedError extends Error {
  constructor(
    kind: EntityKind,
    id: string,
    readonly references: (EntitySummary & { version: string })[],
  ) {
    const names = references.map((r) => `${r.kind} "${r.name}"`).join(', ');
    super(`${kind} "${id}" is still used by ${names}. Remove it from those first.`);
    this.name = 'ReferencedError';
  }
}

/** One commit on main in `applyBatch`: write an entity (and tag a version), or remove it. */
export interface MainStep {
  kind: EntityKind;
  id: string;
  /** Null removes the entity from main (its branches are not touched here). */
  entity: AnyEntity | null;
  message: string;
  /** Tag this main version (e.g. `v3`) on the commit. */
  version?: string;
}

/** One commit on an entity branch in `applyBatch`. */
export interface BranchStep {
  kind: EntityKind;
  id: string;
  branch: string;
  entity: AnyEntity;
  message: string;
  /**
   * Also make this main step's commit a parent, so the branch counts as up to date with that
   * main version (merging the branch later sees no conflict).
   */
  mainStep?: number;
}

export interface RebuildResult {
  entities: number;
  references: number;
  head: string;
  /** Entities whose files exist but do not validate. They are left out of the index. */
  invalid: { kind: EntityKind; id: string; message: string }[];
}

const LIBRARY_README = `# Library store

Managed by the app. Every entity is a human-readable file and every change is a commit.

- \`skills/<id>/SKILL.md\`: skills (Agent Skills format)
- \`tools/<id>.yaml\`: tool presets
- \`agents/<id>.yaml\`: agents
- \`patterns/<id>/pattern.yaml\` + \`layout.json\`: patterns
- \`templates/<id>/workflow.yaml\` + \`layout.json\`: workflow templates
- \`projects/<id>/project.yaml\` + \`workflow.yaml\` + \`layout.json\`: projects
- \`settings.yaml\`: model list and defaults for new agents

\`layout.json\` files hold node positions only, so moving boxes is not a semantic change.

## Versions and branches

- Edits are saved as commits on a branch per entity, e.g. \`agent/<id>/draft\`. \`main\` does
  not change while you edit.
- Merging a branch writes the entity onto \`main\` and tags the next version, e.g.
  \`agent/<id>/v3\`.
- This folder always shows \`main\`. Read other versions with
  \`git show agent/<id>/v2:agents/<id>.yaml\`.
`;

function layoutOf<K extends EntityKind>(kind: K): KindLayout<K> {
  return LAYOUTS[kind] as KindLayout<K>;
}

/** Creates, merges and deletes always change files, so a missing commit is a bug. */
function requireCommit(commit: CommitInfo | null, action: string): CommitInfo {
  if (!commit) throw new Error(`${action} produced no changes to commit`);
  return commit;
}

function describe<K extends EntityKind>(kind: K, entity: EntityByKind[K]): string {
  return `${kind} ${entity.id} (${entity.name})`;
}

/** Git refs of one entity. */
function entityRefs(kind: EntityKind, id: string) {
  return {
    tagPrefix: `refs/tags/${kind}/${id}`,
    branchPrefix: `refs/heads/${kind}/${id}`,
    tag: (version: string) => `refs/tags/${versionTagName(kind, id, version)}`,
    branch: (branch: string) => `refs/heads/${entityBranchName(kind, id, branch)}`,
  };
}

const ENTITY_REF = /^refs\/(tags|heads)\/([^/]+)\/([^/]+)\/([^/]+)$/;

/** Version numbers of tag refs, highest first. */
function versionsOf(tagRefs: { ref: string }[]): number[] {
  return tagRefs
    .map((t) => versionNumber(t.ref.slice(t.ref.lastIndexOf('/') + 1)))
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => b - a);
}

function filesOf(ops: TreeOp[]): string[] {
  return ops.map((o) => o.path);
}

/**
 * CRUD and versioning over the library store (PLAN.md 8.1).
 *
 * - Creating an entity commits it to `main` and tags `v1`.
 * - Updating commits to the entity's draft branch (created from `main` on the first save).
 * - Merging the draft writes the entity's files onto `main` as a merge commit and tags the
 *   next version.
 * - Deleting removes the entity from `main` and deletes its branches; tags stay.
 *
 * All commits are built with git plumbing, so `main`'s working tree is never switched. The
 * index reflects `main`.
 */
export class LibraryStore {
  private constructor(
    readonly git: LibraryGit,
    private index: LibraryIndex,
  ) {}

  /** Whether this library was created by `open` (the app's first launch with it). */
  firstLaunch = false;

  /**
   * Open (initializing if needed) the library store and bring the index up to date. A new
   * library also gets `demo`, the demo content (PLAN.md 9.6).
   */
  static async open(
    libraryDir: string,
    indexPath: string,
    opts: { demo?: DemoContent } = {},
  ): Promise<LibraryStore> {
    await mkdir(libraryDir, { recursive: true });
    const git = new LibraryGit(libraryDir);
    if (!git.isRepo()) await git.init();
    else await git.configure();
    const store = new LibraryStore(git, new LibraryIndex(indexPath));

    if (!(await git.head(MAIN_REF))) {
      store.firstLaunch = true;
      const ops: TreeOp[] = [{ op: 'write', path: 'README.md', content: LIBRARY_README }];
      for (const kind of ENTITY_KINDS)
        ops.push({ op: 'write', path: `${LAYOUTS[kind].dir}/.gitkeep`, content: '' });
      await store.commitToMain(ops, 'Initialize library store');
    }

    if (!(await git.readFile(SETTINGS_PATH))) {
      await store.commitToMain(
        [{ op: 'write', path: SETTINGS_PATH, content: toYaml(DEFAULT_SETTINGS) }],
        'Add default settings',
      );
    }

    await store.tagUnversionedEntities();
    await store.seedBuiltinPatterns();
    if (store.firstLaunch && opts.demo) {
      await store.addDefaults(
        demoEntities(opts.demo),
        { neverExisted: true },
        () => 'Add the demo content',
      );
    }
    if (store.index.head !== (await git.head(MAIN_REF))) await store.rebuildIndex();
    return store;
  }

  get indexPath(): string {
    return this.index.path;
  }

  close(): void {
    this.index.close();
  }

  // ---- Git helpers ----

  /**
   * Commit `ops` on top of `base` and move `ref` to the new commit, together with `refOps`
   * in one atomic transaction. Returns null (and moves nothing) when the tree is unchanged.
   */
  private async commitOn(opts: {
    ref: string;
    /** Commit the change is based on; undefined for the first commit of the repo. */
    base: string | undefined;
    /** Whether `ref` must be created (it does not exist yet). */
    createRef: boolean;
    ops: TreeOp[];
    message: string;
    extraParents?: string[];
    refOps?: (commit: string) => RefOp[];
  }): Promise<CommitInfo | null> {
    const { ref, base, ops, message } = opts;
    const tree = await this.git.writeTree(base, ops);
    if (base && tree === (await this.git.treeOf(base))) return null;
    const parents = [...(base ? [base] : []), ...(opts.extraParents ?? [])];
    const hash = await this.git.commitTree(tree, parents, message);
    const move: RefOp =
      opts.createRef || !base
        ? { op: 'create', ref, value: hash }
        : { op: 'update', ref, value: hash, old: base };
    await this.git.updateRefs([move, ...(opts.refOps?.(hash) ?? [])]);
    return { hash, message };
  }

  /** Commit `ops` to main and sync the touched paths of the working tree. */
  private async commitToMain(
    ops: TreeOp[],
    message: string,
    opts: { extraParents?: string[]; refOps?: (commit: string) => RefOp[] } = {},
  ): Promise<CommitInfo | null> {
    const base = await this.git.head(MAIN_REF);
    const commit = await this.commitOn({
      ref: MAIN_REF,
      base,
      createRef: !base,
      ops,
      message,
      ...opts,
    });
    if (commit) await this.git.syncWorkingTree(filesOf(ops));
    return commit;
  }

  /**
   * Tag `v1` at the current main for every entity on main that has no version yet: entities
   * from before versioning existed (M0/M1), or files added to the store by hand.
   */
  private async tagUnversionedEntities(): Promise<void> {
    const main = await this.git.head(MAIN_REF);
    if (!main) return;
    const tagged = new Set<string>();
    for (const { ref } of await this.git.listRefs('refs/tags')) {
      const m = ENTITY_REF.exec(ref);
      if (m && versionNumber(m[4] ?? '') !== undefined) tagged.add(`${m[2]}/${m[3]}`);
    }
    const ops: RefOp[] = [];
    for (const kind of ENTITY_KINDS) {
      const layout = layoutOf(kind);
      for (const child of await this.git.listDir(layout.dir)) {
        const id = layout.idFromChild(child);
        if (!id || child.startsWith('.') || tagged.has(`${kind}/${id}`)) continue;
        ops.push({ op: 'create', ref: entityRefs(kind, id).tag(versionName(1)), value: main });
      }
    }
    if (ops.length > 0) await this.git.updateRefs(ops);
  }

  /**
   * Add the built-in patterns (PLAN.md 10) that never existed in this library, in one commit
   * with `v1` tags. A built-in the user deleted keeps its version tags, so it is not added back
   * here; Settings → Restore defaults (M6) does that on request.
   */
  private async seedBuiltinPatterns(): Promise<void> {
    await this.addDefaults(
      BUILTIN_PATTERNS.map((entity) => ({ kind: 'pattern', entity })),
      { neverExisted: true },
      (added) =>
        added.length === BUILTIN_PATTERNS.length
          ? 'Add the built-in patterns'
          : `Add built-in patterns: ${added.map((a) => a.name).join(', ')}`,
    );
  }

  /**
   * Settings → Restore defaults (PLAN.md 8.4): add back every built-in pattern, and every demo
   * entity when `demo` is given, that is missing from main, under its old id and as its next
   * version (`v1` if it never existed). Entities that exist, edited or not, are not touched.
   */
  async restoreDefaults(demo?: DemoContent): Promise<{
    restored: RestoredEntity[];
    commit: CommitInfo | null;
  }> {
    return this.git.exclusive(async () => {
      const candidates: DefaultEntity[] = [
        ...BUILTIN_PATTERNS.map((entity) => ({ kind: 'pattern' as const, entity })),
        ...(demo ? demoEntities(demo) : []),
      ];
      return this.addDefaults(
        candidates,
        { neverExisted: false },
        (added) => `Restore defaults: ${added.map((a) => a.name).join(', ')}`,
      );
    });
  }

  /**
   * Add the `candidates` missing from main in one commit, each tagged with its next version.
   * `neverExisted`: skip entities that existed before (deleted ones stay deleted). References
   * between defaults are pinned to the current version of their target, the M2 rule for new
   * references. Callers hold the git lock (or run before the app serves requests).
   */
  private async addDefaults(
    candidates: DefaultEntity[],
    opts: { neverExisted: boolean },
    message: (added: RestoredEntity[]) => string,
  ): Promise<{ restored: RestoredEntity[]; commit: CommitInfo | null }> {
    const current = new Map<string, string>();
    const added: { kind: EntityKind; entity: AnyEntity; version: string }[] = [];
    for (const { kind, entity } of candidates) {
      const status = await this.statusOrNull(kind, entity.id);
      if (status?.current && (await this.exists(kind, entity.id))) {
        current.set(`${kind}/${entity.id}`, status.current);
        continue;
      }
      if (opts.neverExisted && (await this.idTaken(kind, entity.id))) continue;
      const tags = await this.git.listRefs(entityRefs(kind, entity.id).tagPrefix);
      const version = versionName((versionsOf(tags)[0] ?? 0) + 1);
      current.set(`${kind}/${entity.id}`, version);
      added.push({ kind, entity, version });
    }
    const restored = added.map((a) => ({
      kind: a.kind,
      id: a.entity.id,
      name: a.entity.name,
      version: a.version,
    }));
    if (added.length === 0) return { restored, commit: null };
    const entities = added.map((a) => ({
      kind: a.kind,
      entity: this.validate(
        a.kind,
        a.entity.id,
        repinAll(a.kind, a.entity, (r) => current.get(`${r.kind}/${r.id}`)),
      ),
    }));
    const text = message(restored);
    const commit = requireCommit(
      await this.commitToMain(
        entities.flatMap((e) => this.writeOps(e.kind, e.entity)),
        text,
        {
          refOps: (hash) =>
            added.map((a) => ({
              op: 'create' as const,
              ref: entityRefs(a.kind, a.entity.id).tag(a.version),
              value: hash,
            })),
        },
      ),
      text,
    );
    for (const e of entities) this.index.upsert(this.entryOf(e.kind, e.entity), commit.hash);
    return { restored, commit };
  }

  private async statusOrNull(kind: EntityKind, id: string): Promise<VersionStatus | null> {
    return (await this.exists(kind, id)) ? this.statusOf(kind, id) : null;
  }

  /**
   * Resolve a version spec to something git can read: `main` (or nothing), a version (`v2`),
   * a branch of this entity (`draft`) or a commit hash.
   */
  private async resolve(kind: EntityKind, id: string, spec: string | undefined): Promise<string> {
    if (!spec || spec === 'main') return MAIN_REF;
    const refs = entityRefs(kind, id);
    if (versionNumber(spec) !== undefined) {
      const tag = refs.tag(spec);
      if (await this.git.revParse(tag)) return tag;
      throw new NotFoundError(kind, id, `version "${spec}"`);
    }
    if (BranchName.safeParse(spec).success) {
      const branch = refs.branch(spec);
      if (await this.git.revParse(branch)) return branch;
    }
    if (/^[0-9a-f]{7,64}$/.test(spec)) {
      const commit = await this.git.revParse(`${spec}^{commit}`);
      if (commit) return commit;
    }
    throw new NotFoundError(kind, id, `version or branch "${spec}"`);
  }

  // ---- Reads ----

  /** Version number and draft state of every entity of a kind. */
  private async versionSummaries(kind: EntityKind): Promise<Map<string, EntityVersionSummary>> {
    const highest = new Map<string, number>();
    const drafts = new Set<string>();
    for (const { ref } of await this.git.listRefs(`refs/tags/${kind}`, `refs/heads/${kind}`)) {
      const m = ENTITY_REF.exec(ref);
      if (!m) continue;
      const [, type, , id = '', name = ''] = m;
      if (type === 'heads') {
        if (name === DRAFT_BRANCH) drafts.add(id);
      } else {
        const n = versionNumber(name);
        if (n !== undefined && n > (highest.get(id) ?? 0)) highest.set(id, n);
      }
    }
    const result = new Map<string, EntityVersionSummary>();
    for (const id of new Set([...highest.keys(), ...drafts])) {
      const n = highest.get(id);
      result.set(id, { version: n ? versionName(n) : null, hasDraft: drafts.has(id) });
    }
    return result;
  }

  async list(kind: EntityKind, query?: string): Promise<EntityListItem[]> {
    const versions = await this.versionSummaries(kind);
    return this.index.list(kind, query).map((s) => ({
      ...s,
      ...(versions.get(s.id) ?? { version: null, hasDraft: false }),
    }));
  }

  /** Complete entities of a kind as on main (from the index cache), with their versions. */
  async listFull<K extends EntityKind>(
    kind: K,
  ): Promise<{ items: EntityByKind[K][]; versions: Record<string, EntityVersionSummary> }> {
    const items = this.index.listFull(kind) as EntityByKind[K][];
    const all = await this.versionSummaries(kind);
    const versions: Record<string, EntityVersionSummary> = {};
    for (const e of items) versions[e.id] = all.get(e.id) ?? { version: null, hasDraft: false };
    return { items, versions };
  }

  /** The entity at `ref` (see `resolve`); main by default. */
  async get<K extends EntityKind>(kind: K, id: string, ref?: string): Promise<EntityByKind[K]> {
    if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
    const entity = await this.read(kind, id, await this.resolve(kind, id, ref));
    if (!entity) throw new NotFoundError(kind, id, `files at "${ref}"`);
    return entity;
  }

  /** The last saved state: the draft if there is one, otherwise main. */
  async getLatest<K extends EntityKind>(kind: K, id: string): Promise<EntityByKind[K]> {
    const hasDraft = await this.git.revParse(entityRefs(kind, id).branch(DRAFT_BRANCH));
    return this.get(kind, id, hasDraft ? DRAFT_BRANCH : undefined);
  }

  /** Version state of every entity of a kind (current main version, draft flag). */
  async versionMap(kind: EntityKind): Promise<Map<string, EntityVersionSummary>> {
    return this.versionSummaries(kind);
  }

  /** Whether the entity has a branch of that name. */
  async hasBranch(kind: EntityKind, id: string, branch: string): Promise<boolean> {
    if (!BranchName.safeParse(branch).success) return false;
    return (await this.git.revParse(entityRefs(kind, id).branch(branch))) !== undefined;
  }

  /** Every branch of the given kinds except drafts, e.g. the forks pinned by projects. */
  async namedBranches(
    kinds: readonly EntityKind[],
  ): Promise<{ kind: EntityKind; id: string; branch: string; head: string }[]> {
    const out: { kind: EntityKind; id: string; branch: string; head: string }[] = [];
    for (const { ref, oid } of await this.git.listRefs(...kinds.map((k) => `refs/heads/${k}`))) {
      const m = ENTITY_REF.exec(ref);
      if (!m || m[4] === DRAFT_BRANCH) continue;
      out.push({ kind: m[2] as EntityKind, id: m[3] ?? '', branch: m[4] ?? '', head: oid });
    }
    return out;
  }

  /** Commit a branch of an entity points to, if it exists. */
  async branchHead(kind: EntityKind, id: string, branch: string): Promise<string | undefined> {
    if (!BranchName.safeParse(branch).success) return undefined;
    return this.git.revParse(entityRefs(kind, id).branch(branch));
  }

  /** Full git ref of an entity branch. */
  branchRef(kind: EntityKind, id: string, branch: string): string {
    return entityRefs(kind, id).branch(branch);
  }

  /** Apply ref changes (e.g. deleting unused forks) in one transaction. */
  async updateRefs(ops: RefOp[]): Promise<void> {
    if (ops.length === 0) return;
    await this.git.exclusive(() => this.git.updateRefs(ops));
  }

  /** Summary of an entity on main, from the index. */
  summary(kind: EntityKind, id: string): EntitySummary | undefined {
    return this.index.summary(kind, id);
  }

  references(kind: EntityKind, id: string): ReferencesResponse {
    return { outgoing: this.index.outgoing(kind, id), incoming: this.index.incoming(kind, id) };
  }

  /** Read and validate an entity at a git ref. Undefined when it does not exist there. */
  private async read<K extends EntityKind>(
    kind: K,
    id: string,
    ref: string,
  ): Promise<EntityByKind[K] | undefined> {
    const layout = layoutOf(kind);
    const present = await this.git.listFiles(layout.root(id), ref);
    if (present.length === 0) return undefined;
    const files: Record<string, string | undefined> = {};
    for (const f of layout.files(id))
      files[f] = present.includes(f) ? await this.git.readFile(f, ref) : undefined;
    const result = safeParseEntity(kind, layout.deserialize(id, files));
    if (!result.success) {
      throw new EntityValidationError(`stored ${kind} "${id}" is invalid`, result.error);
    }
    return result.data;
  }

  /** Whether the entity exists on main. */
  private async exists(kind: EntityKind, id: string): Promise<boolean> {
    return (await this.git.listFiles(layoutOf(kind).root(id), MAIN_REF)).length > 0;
  }

  // ---- Versions ----

  /** Current version, all versions and branches of an entity. */
  async status(kind: EntityKind, id: string): Promise<VersionStatus> {
    if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
    return this.statusOf(kind, id);
  }

  private async statusOf(kind: EntityKind, id: string): Promise<VersionStatus> {
    const refs = entityRefs(kind, id);
    const root = layoutOf(kind).root(id);
    const versions = versionsOf(await this.git.listRefs(refs.tagPrefix)).map(versionName);
    const onMain = await this.git.objectAt(MAIN_REF, root);
    const branches: BranchInfo[] = [];
    for (const b of await this.git.listRefs(refs.branchPrefix)) {
      branches.push({
        name: b.ref.slice(refs.branchPrefix.length + 1),
        head: b.oid,
        date: b.date,
        commits: await this.git.countBetween(MAIN_REF, b.ref),
        changed: (await this.git.objectAt(b.ref, root)) !== onMain,
      });
    }
    return { current: versions[0] ?? null, versions, branches };
  }

  /** Main versions and unmerged branch commits, newest first. */
  async history(kind: EntityKind, id: string): Promise<HistoryResponse> {
    const status = await this.status(kind, id);
    const refs = entityRefs(kind, id);
    const root = layoutOf(kind).root(id);
    const versions: HistoryResponse['versions'] = [];
    for (const version of status.versions) {
      const tag = refs.tag(version);
      const commit = (await this.git.revParse(`${tag}^{commit}`)) ?? '';
      // --first-parent: on main, a merge commit is the change that produced the version.
      const [last] = await this.git.log(['-1', '--first-parent', tag], root);
      versions.push({
        version,
        commit,
        date: last?.date ?? '',
        message: last?.message ?? '',
        ...(last?.body ? { note: last.body } : {}),
      });
    }
    const branches: HistoryResponse['branches'] = [];
    for (const b of status.branches) {
      branches.push({ ...b, log: await this.git.log([`${MAIN_REF}..${refs.branch(b.name)}`]) });
    }
    return { versions, branches };
  }

  /** The entity's files that differ between two versions, branches or commits. */
  async diff(kind: EntityKind, id: string, from: string, to: string): Promise<DiffResponse> {
    if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
    const root = layoutOf(kind).root(id);
    const fromRef = await this.resolve(kind, id, from);
    const toRef = await this.resolve(kind, id, to);
    const paths = new Set([
      ...(await this.git.listFiles(root, fromRef)),
      ...(await this.git.listFiles(root, toRef)),
    ]);
    const files: FileDiff[] = [];
    for (const path of [...paths].sort()) {
      const before = (await this.git.readFile(path, fromRef)) ?? null;
      const after = (await this.git.readFile(path, toRef)) ?? null;
      if (before !== after) files.push({ path, before, after });
    }
    return { from, to, files };
  }

  // ---- Writes ----

  private validate<K extends EntityKind>(kind: K, id: string, input: unknown): EntityByKind[K] {
    const body = input && typeof input === 'object' ? input : {};
    const result = safeParseEntity(kind, { ...body, id });
    if (!result.success) throw new EntityValidationError(`invalid ${kind}`, result.error);
    // Local copies and placeholders nothing uses any more are dropped.
    return isReferrerKind(kind) ? pruneLocal(kind, result.data) : result.data;
  }

  private writeOps<K extends EntityKind>(kind: K, entity: EntityByKind[K]): TreeOp[] {
    return Object.entries(layoutOf(kind).serialize(entity)).map(([path, content]) => ({
      op: 'write' as const,
      path,
      content,
    }));
  }

  /** Create on main and tag `v1`. */
  async create<K extends EntityKind>(
    kind: K,
    input: unknown,
    opts: {
      /**
       * Adjust the validated entity once its id is known, with extra ref changes made in the
       * same transaction (e.g. copying the forks it pins). Must not take the git lock.
       */
      prepare?: (
        id: string,
        entity: EntityByKind[K],
      ) => Promise<{ entity: EntityByKind[K]; refOps: RefOp[] }>;
    } = {},
  ): Promise<{ entity: EntityByKind[K]; commit: CommitInfo; status: VersionStatus }> {
    const name = (input as { name?: unknown } | null)?.name;
    const base = typeof name === 'string' ? name : kind;
    return this.git.exclusive(async () => {
      let id = makeEntityId(base);
      while (await this.idTaken(kind, id)) id = makeEntityId(base);
      let entity = this.validate(kind, id, input);
      let extraRefs: RefOp[] = [];
      if (opts.prepare) ({ entity, refOps: extraRefs } = await opts.prepare(id, entity));
      const message = `Create ${describe(kind, entity)}`;
      const commit = requireCommit(
        await this.commitToMain(this.writeOps(kind, entity), message, {
          refOps: (hash) => [
            { op: 'create', ref: entityRefs(kind, id).tag(versionName(1)), value: hash },
            ...extraRefs,
          ],
        }),
        message,
      );
      this.index.upsert(this.entryOf(kind, entity), commit.hash);
      return { entity, commit, status: await this.statusOf(kind, id) };
    });
  }

  /** An id is taken while it exists on main or has any versions or branches. */
  private async idTaken(kind: EntityKind, id: string): Promise<boolean> {
    if (await this.exists(kind, id)) return true;
    const refs = entityRefs(kind, id);
    return (await this.git.listRefs(refs.tagPrefix, refs.branchPrefix)).length > 0;
  }

  /**
   * Save to the entity's draft branch. The first save creates the branch from main; a save
   * that changes nothing makes no commit (and creates no branch).
   */
  async update<K extends EntityKind>(
    kind: K,
    id: string,
    input: unknown,
    opts: { branch?: string } = {},
  ): Promise<{ entity: EntityByKind[K]; commit: CommitInfo | null; status: VersionStatus }> {
    const branch = opts.branch ?? DRAFT_BRANCH;
    return this.git.exclusive(async () => {
      if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
      const entity = this.validate(kind, id, input);
      const ref = entityRefs(kind, id).branch(branch);
      const branchHead = BranchName.safeParse(branch).success
        ? await this.git.revParse(ref)
        : undefined;
      // Only the draft is created on demand; other branches (forks) must exist already.
      if (!branchHead && branch !== DRAFT_BRANCH) {
        throw new NotFoundError(kind, id, `branch "${branch}"`);
      }
      const base = branchHead ?? (await this.git.head(MAIN_REF));
      const commit = await this.commitOn({
        ref,
        base,
        createRef: !branchHead,
        ops: this.writeOps(kind, entity),
        message: `Update ${describe(kind, entity)}`,
      });
      return { entity, commit, status: await this.statusOf(kind, id) };
    });
  }

  /**
   * Merge a branch (the draft by default) to main: main gets the entity's files exactly as on
   * the branch, in a merge commit tagged with the next version. The branch is deleted.
   * Refused when main's copy of the entity changed since the branch started, unless `force`.
   */
  async merge<K extends EntityKind>(
    kind: K,
    id: string,
    opts: { branch?: string; force?: boolean; note?: string } = {},
  ): Promise<{
    entity: EntityByKind[K];
    commit: CommitInfo;
    version: string;
    status: VersionStatus;
  }> {
    return this.git.exclusive(async () => {
      if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
      const branch = opts.branch ?? DRAFT_BRANCH;
      const refs = entityRefs(kind, id);
      const root = layoutOf(kind).root(id);
      const branchRef = refs.branch(branch);
      const branchHead = await this.git.revParse(branchRef);
      if (!branchHead) throw new NotFoundError(kind, id, `branch "${branch}"`);
      const mainHead = await this.git.head(MAIN_REF);
      if (!mainHead) throw new Error('main has no commits');

      const onMain = await this.git.objectAt(MAIN_REF, root);
      if ((await this.git.objectAt(branchHead, root)) === onMain) {
        throw new BadRequestError(
          `The ${branch} branch has no changes compared to main. Discard it instead.`,
        );
      }
      if (!opts.force) {
        const forkPoint = await this.git.mergeBase(mainHead, branchHead);
        const atFork = forkPoint ? await this.git.objectAt(forkPoint, root) : undefined;
        if (atFork !== onMain) {
          throw new MergeConflictError(
            `main changed since the ${branch} branch started. Merging replaces main's version with the branch's.`,
          );
        }
      }
      const entity = await this.read(kind, id, branchHead);
      if (!entity) throw new BadRequestError(`The ${branch} branch does not contain this ${kind}.`);

      const version = versionName(
        (versionsOf(await this.git.listRefs(refs.tagPrefix))[0] ?? 0) + 1,
      );
      const subject = `Merge ${describe(kind, entity)} as ${version}`;
      const note = normalizeMergeNote(opts.note);
      if (note && note.length > MERGE_NOTE_MAX) {
        throw new BadRequestError(`The merge note is longer than ${MERGE_NOTE_MAX} characters.`);
      }
      const message = note ? `${subject}\n\n${note}` : subject;
      const commit = requireCommit(
        await this.commitToMain(
          [
            { op: 'remove', path: root },
            { op: 'copy', path: root, from: branchHead },
          ],
          message,
          {
            extraParents: [branchHead],
            refOps: (hash) => [
              { op: 'create', ref: refs.tag(version), value: hash },
              { op: 'delete', ref: branchRef, old: branchHead },
            ],
          },
        ),
        message,
      );
      this.index.upsert(this.entryOf(kind, entity), commit.hash);
      return { entity, commit, version, status: await this.statusOf(kind, id) };
    });
  }

  /**
   * Create a named branch (e.g. a fork pinned by a project) at a main version. Fails when the
   * branch exists already.
   */
  async createBranch(
    kind: EntityKind,
    id: string,
    branch: string,
    from: string,
  ): Promise<VersionStatus> {
    return this.git.exclusive(async () => {
      if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
      if (!BranchName.safeParse(branch).success || branch === DRAFT_BRANCH) {
        throw new BadRequestError(`"${branch}" is not a valid branch name`);
      }
      if (versionNumber(from) === undefined) {
        throw new BadRequestError('a branch starts from a main version, e.g. "v2"');
      }
      const refs = entityRefs(kind, id);
      const start = await this.git.revParse(`${refs.tag(from)}^{commit}`);
      if (!start) throw new NotFoundError(kind, id, `version "${from}"`);
      if (await this.git.revParse(refs.branch(branch))) {
        throw new BadRequestError(`branch "${branch}" already exists`);
      }
      await this.git.updateRefs([{ op: 'create', ref: refs.branch(branch), value: start }]);
      return this.statusOf(kind, id);
    });
  }

  /** Delete a branch without merging it. Its commits stay in the object store until gc. */
  async discardBranch(kind: EntityKind, id: string, branch: string): Promise<VersionStatus> {
    return this.git.exclusive(async () => {
      if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
      const ref = entityRefs(kind, id).branch(branch);
      const head = BranchName.safeParse(branch).success && (await this.git.revParse(ref));
      if (!head) throw new NotFoundError(kind, id, `branch "${branch}"`);
      await this.git.updateRefs([{ op: 'delete', ref, old: head }]);
      return this.statusOf(kind, id);
    });
  }

  /**
   * Several changes at once, all or nothing: a chain of commits on main (one per step, each
   * optionally tagged with a version), commits on entity branches, and extra ref changes. Main,
   * the tags and the branches move in one ref transaction. Used by the cascade and by deleting
   * a referenced entity.
   */
  async applyBatch(
    mainSteps: MainStep[],
    branchSteps: BranchStep[],
    extraRefOps: RefOp[] = [],
  ): Promise<{ commits: CommitInfo[]; head: string | undefined }> {
    return this.git.exclusive(async () => {
      const base = await this.git.head(MAIN_REF);
      if (!base) throw new Error('main has no commits');
      let prev = base;
      const commits: CommitInfo[] = [];
      const refOps: RefOp[] = [];
      const touched: string[] = [];
      for (const step of mainSteps) {
        const root = layoutOf(step.kind).root(step.id);
        const ops: TreeOp[] = [{ op: 'remove', path: root }];
        if (step.entity) ops.push(...this.writeOps(step.kind, step.entity));
        const tree = await this.git.writeTree(prev, ops);
        const hash = await this.git.commitTree(tree, [prev], step.message);
        commits.push({ hash, message: step.message });
        touched.push(...filesOf(ops));
        if (step.version) {
          refOps.push({
            op: 'create',
            ref: entityRefs(step.kind, step.id).tag(step.version),
            value: hash,
          });
        }
        prev = hash;
      }
      if (prev !== base) refOps.unshift({ op: 'update', ref: MAIN_REF, value: prev, old: base });
      for (const step of branchSteps) {
        const ref = entityRefs(step.kind, step.id).branch(step.branch);
        const head = await this.git.revParse(ref);
        if (!head) throw new NotFoundError(step.kind, step.id, `branch "${step.branch}"`);
        const root = layoutOf(step.kind).root(step.id);
        const tree = await this.git.writeTree(head, [
          { op: 'remove', path: root },
          ...this.writeOps(step.kind, step.entity),
        ]);
        const extra = step.mainStep === undefined ? undefined : commits[step.mainStep]?.hash;
        const hash = await this.git.commitTree(tree, extra ? [head, extra] : [head], step.message);
        refOps.push({ op: 'update', ref, value: hash, old: head });
      }
      refOps.push(...extraRefOps);
      if (refOps.length === 0) return { commits, head: base };
      await this.git.updateRefs(refOps);
      if (prev !== base) {
        await this.git.syncWorkingTree([...new Set(touched)]);
        mainSteps.forEach((step, i) => {
          const hash = commits[i]?.hash ?? prev;
          if (step.entity) this.index.upsert(this.entryOf(step.kind, step.entity), hash);
          else this.index.remove(step.kind, step.id, hash);
        });
      }
      return { commits, head: prev };
    });
  }

  /** Version tag refs of an entity, highest number first. */
  async nextVersion(kind: EntityKind, id: string): Promise<string> {
    return versionName(
      (versionsOf(await this.git.listRefs(entityRefs(kind, id).tagPrefix))[0] ?? 0) + 1,
    );
  }

  /** Ref ops that delete every branch of an entity. */
  async deleteBranchOps(
    kind: EntityKind,
    id: string,
    only?: (branch: string) => boolean,
  ): Promise<RefOp[]> {
    const refs = entityRefs(kind, id);
    return (await this.git.listRefs(refs.branchPrefix))
      .filter((b) => !only || only(b.ref.slice(refs.branchPrefix.length + 1)))
      .map((b) => ({ op: 'delete' as const, ref: b.ref, old: b.oid }));
  }

  /** Remove from main and delete the entity's branches. Version tags stay in history. */
  async delete(
    kind: EntityKind,
    id: string,
    opts: { extraRefOps?: RefOp[] } = {},
  ): Promise<{ commit: CommitInfo }> {
    return this.git.exclusive(async () => {
      if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
      const users = this.index
        .incoming(kind, id)
        .filter((r) => !(r.kind === kind && r.id === id))
        .map((r) => {
          const s = this.index.summary(r.kind, r.id);
          return {
            kind: r.kind,
            id: r.id,
            name: s?.name ?? r.id,
            description: s?.description ?? '',
            version: r.version,
          };
        });
      if (users.length > 0) throw new ReferencedError(kind, id, users);
      const branches = await this.git.listRefs(entityRefs(kind, id).branchPrefix);
      const summary = this.index.summary(kind, id);
      const message = `Delete ${kind} ${id}${summary ? ` (${summary.name})` : ''}`;
      const commit = requireCommit(
        await this.commitToMain([{ op: 'remove', path: layoutOf(kind).root(id) }], message, {
          refOps: () => [
            ...branches.map((b): RefOp => ({ op: 'delete', ref: b.ref, old: b.oid })),
            ...(opts.extraRefOps ?? []),
          ],
        }),
        message,
      );
      this.index.remove(kind, id, commit.hash);
      return { commit };
    });
  }

  private entryOf<K extends EntityKind>(kind: K, entity: EntityByKind[K]): IndexEntry {
    return {
      summary: { kind, id: entity.id, name: entity.name, description: entity.description },
      refs: collectRefs(kind, entity),
      data: entity,
    };
  }

  // ---- Settings (not versioned: committed straight to main) ----

  async getSettings(): Promise<Settings> {
    const result = Settings.safeParse(fromYaml(await this.git.readFile(SETTINGS_PATH)));
    if (!result.success)
      throw new EntityValidationError('stored settings are invalid', result.error);
    return result.data;
  }

  async updateSettings(input: unknown): Promise<{ settings: Settings; commit: CommitInfo | null }> {
    return this.git.exclusive(async () => {
      const result = Settings.safeParse(input);
      if (!result.success) throw new EntityValidationError('invalid settings', result.error);
      const commit = await this.commitToMain(
        [{ op: 'write', path: SETTINGS_PATH, content: toYaml(result.data) }],
        'Update settings',
      );
      if (commit) this.index.head = commit.hash;
      return { settings: result.data, commit };
    });
  }

  // ---- Index ----

  /**
   * Throw the index away and rebuild it from the library store at `main`. The SQLite file is
   * recreated, so this also recovers from a deleted or corrupted index file.
   */
  async rebuildIndex(): Promise<RebuildResult> {
    return this.git.exclusive(async () => {
      const head = await this.git.head(MAIN_REF);
      const entries: IndexEntry[] = [];
      const invalid: RebuildResult['invalid'] = [];
      for (const kind of ENTITY_KINDS) {
        const layout = layoutOf(kind);
        for (const child of await this.git.listDir(layout.dir)) {
          const id = layout.idFromChild(child);
          if (!id || child.startsWith('.')) continue;
          try {
            const entity = await this.read(kind, id, MAIN_REF);
            if (entity) entries.push(this.entryOf(kind, entity));
          } catch (err) {
            invalid.push({ kind, id, message: err instanceof Error ? err.message : String(err) });
          }
        }
      }
      const path = this.index.path;
      this.index.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
      this.index = new LibraryIndex(path);
      this.index.replaceAll(entries, head);
      return { ...this.index.counts(), head: head ?? '', invalid };
    });
  }
}
