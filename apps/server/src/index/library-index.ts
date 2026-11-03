import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EntityKind, EntitySummary, Ref } from '@app/schema';
import Database from 'better-sqlite3';

/** Bump when the table layout changes; a mismatch drops and rebuilds the index. */
const INDEX_SCHEMA_VERSION = '1';

export interface IndexEntry {
  summary: EntitySummary;
  refs: Ref[];
}

export interface IncomingRef {
  kind: EntityKind;
  id: string;
  version: string;
}

/**
 * Derived SQLite index for listing, search and reference lookups. Git is the source of truth:
 * the index records the library HEAD it was built from and can be rebuilt at any time.
 */
export class LibraryIndex {
  private readonly db: Database.Database;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    if (this.getMeta('schemaVersion') !== INDEX_SCHEMA_VERSION) {
      this.db.exec('DROP TABLE IF EXISTS refs; DROP TABLE IF EXISTS entities; DELETE FROM meta;');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE TABLE IF NOT EXISTS refs (
        from_kind TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_kind TEXT NOT NULL,
        to_id TEXT NOT NULL,
        to_version TEXT NOT NULL,
        PRIMARY KEY (from_kind, from_id, to_kind, to_id, to_version)
      );
      CREATE INDEX IF NOT EXISTS refs_to ON refs (to_kind, to_id);
    `);
    this.setMeta('schemaVersion', INDEX_SCHEMA_VERSION);
  }

  private getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  /** The library commit this index reflects. */
  get head(): string | undefined {
    return this.getMeta('head');
  }

  set head(sha: string | undefined) {
    if (sha) this.setMeta('head', sha);
    else this.db.prepare("DELETE FROM meta WHERE key = 'head'").run();
  }

  private writeEntry({ summary, refs }: IndexEntry): void {
    this.removeEntry(summary.kind, summary.id);
    this.db
      .prepare('INSERT INTO entities (kind, id, name, description) VALUES (?, ?, ?, ?)')
      .run(summary.kind, summary.id, summary.name, summary.description);
    const insertRef = this.db.prepare(
      'INSERT OR IGNORE INTO refs (from_kind, from_id, to_kind, to_id, to_version) VALUES (?, ?, ?, ?, ?)',
    );
    for (const r of refs) insertRef.run(summary.kind, summary.id, r.kind, r.id, r.version);
  }

  private removeEntry(kind: EntityKind, id: string): void {
    this.db.prepare('DELETE FROM entities WHERE kind = ? AND id = ?').run(kind, id);
    this.db.prepare('DELETE FROM refs WHERE from_kind = ? AND from_id = ?').run(kind, id);
  }

  upsert(entry: IndexEntry, head: string): void {
    this.db.transaction(() => {
      this.writeEntry(entry);
      this.head = head;
    })();
  }

  remove(kind: EntityKind, id: string, head: string): void {
    this.db.transaction(() => {
      this.removeEntry(kind, id);
      this.head = head;
    })();
  }

  /** Replace the whole index atomically. */
  replaceAll(entries: IndexEntry[], head: string | undefined): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM refs; DELETE FROM entities;');
      for (const e of entries) this.writeEntry(e);
      this.head = head;
    })();
  }

  list(kind: EntityKind, query?: string): EntitySummary[] {
    const q = query?.trim();
    const rows = q
      ? this.db
          .prepare(
            `SELECT kind, id, name, description FROM entities
             WHERE kind = ? AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')
             ORDER BY name COLLATE NOCASE, id`,
          )
          .all(kind, ...Array<string>(3).fill(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`))
      : this.db
          .prepare(
            'SELECT kind, id, name, description FROM entities WHERE kind = ? ORDER BY name COLLATE NOCASE, id',
          )
          .all(kind);
    return rows as EntitySummary[];
  }

  outgoing(kind: EntityKind, id: string): Ref[] {
    return this.db
      .prepare(
        'SELECT to_kind AS kind, to_id AS id, to_version AS version FROM refs WHERE from_kind = ? AND from_id = ? ORDER BY 1, 2, 3',
      )
      .all(kind, id) as Ref[];
  }

  /** Entities referencing `kind/id` at any version. `version` is the version they pin. */
  incoming(kind: EntityKind, id: string): IncomingRef[] {
    return this.db
      .prepare(
        'SELECT from_kind AS kind, from_id AS id, to_version AS version FROM refs WHERE to_kind = ? AND to_id = ? ORDER BY 1, 2, 3',
      )
      .all(kind, id) as IncomingRef[];
  }

  counts(): { entities: number; references: number } {
    const e = this.db.prepare('SELECT COUNT(*) AS n FROM entities').get() as { n: number };
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM refs').get() as { n: number };
    return { entities: e.n, references: r.n };
  }

  close(): void {
    this.db.close();
  }
}
