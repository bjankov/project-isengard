import { mkdir, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ENTITY_KINDS,
  collectRefs,
  makeEntityId,
  safeParseEntity,
  type CommitInfo,
  type EntityByKind,
  type EntityKind,
  type EntitySummary,
  type ReferencesResponse,
} from '@app/schema';
import type { ZodError } from 'zod';
import { LibraryIndex, type IndexEntry } from '../index/library-index.js';
import { LibraryGit, MAIN_BRANCH } from '../git.js';
import { LAYOUTS, type KindLayout } from './layout.js';

export class NotFoundError extends Error {
  constructor(kind: EntityKind, id: string) {
    super(`${kind} "${id}" not found`);
    this.name = 'NotFoundError';
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

\`layout.json\` files hold node positions only, so moving boxes is not a semantic change.
`;

function layoutOf<K extends EntityKind>(kind: K): KindLayout<K> {
  return LAYOUTS[kind] as KindLayout<K>;
}

/** Creates and deletes always change files, so a missing commit is a bug. */
function requireCommit(commit: CommitInfo | null, action: string): CommitInfo {
  if (!commit) throw new Error(`${action} produced no changes to commit`);
  return commit;
}

function describe<K extends EntityKind>(kind: K, entity: EntityByKind[K]): string {
  return `${kind} ${entity.id} (${entity.name})`;
}

/**
 * CRUD over the library store. Every write is one commit on `main`, followed by an index
 * update. Reads go through git objects at `main`.
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

    if (!(await git.head())) {
      await writeFile(join(libraryDir, 'README.md'), LIBRARY_README);
      const paths = ['README.md'];
      for (const kind of ENTITY_KINDS) {
        const keep = `${LAYOUTS[kind].dir}/.gitkeep`;
        await mkdir(join(libraryDir, LAYOUTS[kind].dir), { recursive: true });
        await writeFile(join(libraryDir, keep), '');
        paths.push(keep);
      }
      await git.commitPaths(paths, 'Initialize library store');
    }

    const store = new LibraryStore(git, new LibraryIndex(indexPath));
    if (store.index.head !== (await git.head())) await store.rebuildIndex();
    return store;
  }

  get indexPath(): string {
    return this.index.path;
  }

  close(): void {
    this.index.close();
  }

  // ---- Reads ----

  list(kind: EntityKind, query?: string): EntitySummary[] {
    return this.index.list(kind, query);
  }

  async get<K extends EntityKind>(kind: K, id: string): Promise<EntityByKind[K]> {
    const entity = await this.read(kind, id, MAIN_BRANCH);
    if (!entity) throw new NotFoundError(kind, id);
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

  private async exists(kind: EntityKind, id: string): Promise<boolean> {
    return (await this.git.listFiles(layoutOf(kind).root(id))).length > 0;
  }

  // ---- Writes ----

  private validate<K extends EntityKind>(kind: K, id: string, input: unknown): EntityByKind[K] {
    const body = input && typeof input === 'object' ? input : {};
    const result = safeParseEntity(kind, { ...body, id });
    if (!result.success) throw new EntityValidationError(`invalid ${kind}`, result.error);
    return result.data;
  }

  async create<K extends EntityKind>(
    kind: K,
    input: unknown,
  ): Promise<{ entity: EntityByKind[K]; commit: CommitInfo }> {
    const name = (input as { name?: unknown } | null)?.name;
    return this.git.exclusive(async () => {
      let id = makeEntityId(typeof name === 'string' ? name : kind);
      while (await this.exists(kind, id)) id = makeEntityId(typeof name === 'string' ? name : kind);
      const entity = this.validate(kind, id, input);
      const message = `Create ${describe(kind, entity)}`;
      const commit = requireCommit(await this.writeAndCommit(kind, entity, message), message);
      return { entity, commit };
    });
  }

  async update<K extends EntityKind>(
    kind: K,
    id: string,
    input: unknown,
  ): Promise<{ entity: EntityByKind[K]; commit: CommitInfo | null }> {
    return this.git.exclusive(async () => {
      if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
      const entity = this.validate(kind, id, input);
      const commit = await this.writeAndCommit(kind, entity, `Update ${describe(kind, entity)}`);
      return { entity, commit };
    });
  }

  async delete(kind: EntityKind, id: string): Promise<{ commit: CommitInfo }> {
    return this.git.exclusive(async () => {
      const layout = layoutOf(kind);
      if (!(await this.exists(kind, id))) throw new NotFoundError(kind, id);
      const root = layout.root(id);
      const summary = this.index.list(kind).find((s) => s.id === id);
      try {
        await rm(join(this.git.dir, root), { recursive: true, force: true });
        const message = `Delete ${kind} ${id}${summary ? ` (${summary.name})` : ''}`;
        const commit = requireCommit(await this.git.commitPaths([root], message), message);
        this.index.remove(kind, id, commit.hash);
        return { commit };
      } catch (err) {
        await this.git.discard([root]);
        throw err;
      }
    });
  }

  private async writeAndCommit<K extends EntityKind>(
    kind: K,
    entity: EntityByKind[K],
    message: string,
  ): Promise<CommitInfo | null> {
    const files = layoutOf(kind).serialize(entity);
    const paths = Object.keys(files);
    try {
      for (const [path, content] of Object.entries(files)) {
        const abs = join(this.git.dir, path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content);
      }
      const commit = await this.git.commitPaths(paths, message);
      if (commit) this.index.upsert(this.entryOf(kind, entity), commit.hash);
      return commit;
    } catch (err) {
      await this.git.discard(paths);
      throw err;
    }
  }

  private entryOf<K extends EntityKind>(kind: K, entity: EntityByKind[K]): IndexEntry {
    return {
      summary: { kind, id: entity.id, name: entity.name, description: entity.description },
      refs: collectRefs(kind, entity),
    };
  }

  // ---- Index ----

  /**
   * Throw the index away and rebuild it from the library store at `main`. The SQLite file is
   * recreated, so this also recovers from a deleted or corrupted index file.
   */
  async rebuildIndex(): Promise<RebuildResult> {
    return this.git.exclusive(async () => {
      const head = await this.git.head();
      const entries: IndexEntry[] = [];
      const invalid: RebuildResult['invalid'] = [];
      for (const kind of ENTITY_KINDS) {
        const layout = layoutOf(kind);
        for (const child of await this.git.listDir(layout.dir)) {
          const id = layout.idFromChild(child);
          if (!id || child.startsWith('.')) continue;
          try {
            const entity = await this.read(kind, id, MAIN_BRANCH);
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
