import { mkdir } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import {
  BranchName,
  DRAFT_BRANCH,
  ENTITY_KINDS,
  Settings,
  collectRefs,
  entityBranchName,
  makeEntityId,
  safeParseEntity,
  versionName,
  versionNumber,
  versionTagName,
  type BranchInfo,
  type CommitInfo,
  type DiffResponse,
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

  /** Open (initializing if needed) the library store and bring the index up to date. */
  static async open(libraryDir: string, indexPath: string): Promise<LibraryStore> {
    await mkdir(libraryDir, { recursive: true });
    const git = new LibraryGit(libraryDir);
    if (!git.isRepo()) await git.init();
    else await git.configure();
    const store = new LibraryStore(git, new LibraryIndex(indexPath));

    if (!(await git.head(MAIN_REF))) {
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
      versions.push({ version, commit, date: last?.date ?? '', message: last?.message ?? '' });
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
    return result.data;
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
  ): Promise<{ entity: EntityByKind[K]; commit: CommitInfo; status: VersionStatus }> {
    const name = (input as { name?: unknown } | null)?.name;
    const base = typeof name === 'string' ? name : kind;
    return this.git.exclusive(async () => {
      let id = makeEntityId(base);
      while (await this.idTaken(kind, id)) id = makeEntityId(base);
      const entity = this.validate(kind, id, input);
      const message = `Create ${describe(kind, entity)}`;
      const commit = requireCommit(
        await this.commitToMain(this.writeOps(kind, entity), message, {
          refOps: (hash) => [
            { op: 'create', ref: entityRefs(kind, id).tag(versionName(1)), value: hash },
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
  ): Promise<{ entity: EntityByKind[K]; commit: CommitInfo | null; status: VersionStatus }> {
    return this.git.exclusive(async () => {
      if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
      const entity = this.validate(kind, id, input);
      const ref = entityRefs(kind, id).branch(DRAFT_BRANCH);
      const draftHead = await this.git.revParse(ref);
      const base = draftHead ?? (await this.git.head(MAIN_REF));
      const commit = await this.commitOn({
        ref,
        base,
        createRef: !draftHead,
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
    opts: { branch?: string; force?: boolean } = {},
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
      const message = `Merge ${describe(kind, entity)} as ${version}`;
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

  /** Remove from main and delete the entity's branches. Version tags stay in history. */
  async delete(kind: EntityKind, id: string): Promise<{ commit: CommitInfo }> {
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
          refOps: () => branches.map((b) => ({ op: 'delete', ref: b.ref, old: b.oid })),
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
