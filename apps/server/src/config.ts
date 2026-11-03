import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface AppConfig {
  /** App data folder. Holds the library store and the (derived) SQLite index. */
  home: string;
  /** The library store git repo. */
  libraryDir: string;
  /** SQLite index; derived data, rebuildable from the library store at any time. */
  indexPath: string;
  host: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const home = resolve(env.APP_HOME ?? join(homedir(), '.app'));
  return {
    home,
    libraryDir: join(home, 'library'),
    indexPath: join(home, 'index.db'),
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 4317),
  };
}
