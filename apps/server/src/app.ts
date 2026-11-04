import {
  kindFromPlural,
  type ApiErrorBody,
  type DiffResponse,
  type DiscardBranchResponse,
  type HistoryResponse,
  type MergeRequest,
  type VersionStatus,
  type WorkspaceCheck,
  type WorkspaceSuggestions,
  type EntityKind,
  type HealthResponse,
  type RebuildResponse,
  type ReferencedErrorBody,
  type SettingsMutationResponse,
  type SettingsResponse,
} from '@app/schema';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AppConfig } from './config.js';
import { checkGitInstalled } from './git.js';
import { checkWorkspace, expandPath, initWorkspace, suggestWorkspaces } from './workspace.js';
import {
  BadRequestError,
  EntityValidationError,
  LibraryStore,
  MergeConflictError,
  NotFoundError,
  ReferencedError,
} from './store/library-store.js';

export interface BuiltApp {
  app: FastifyInstance;
  store: LibraryStore;
}

class UnknownKindError extends Error {}

/** A 400 with field issues that do not come from a Zod schema (e.g. workspace checks). */
class FieldError extends Error {
  constructor(
    message: string,
    readonly issues: { path: (string | number)[]; message: string }[],
  ) {
    super(message);
  }
}

function kindParam(plural: string): EntityKind {
  const kind = kindFromPlural(plural);
  if (!kind) throw new UnknownKindError(`unknown entity kind "${plural}"`);
  return kind;
}

/**
 * Build the API server: checks git, opens (initializing if needed) the library store and
 * brings the index up to date.
 */
export async function buildApp(
  config: AppConfig,
  options: FastifyServerOptions = {},
): Promise<BuiltApp> {
  const gitVersion = await checkGitInstalled();
  const store = await LibraryStore.open(config.libraryDir, config.indexPath);

  const app = Fastify({ bodyLimit: 10 * 1024 * 1024, ...options });
  app.addHook('onClose', async () => store.close());

  app.setErrorHandler<Error & { statusCode?: number }>((err, _req, reply) => {
    let status = 500;
    let body: ApiErrorBody | ReferencedErrorBody;
    if (err instanceof ReferencedError) {
      status = 409;
      body = { error: 'conflict', message: err.message, references: err.references };
    } else if (err instanceof FieldError) {
      status = 400;
      body = { error: 'validation', message: err.message, issues: err.issues };
    } else if (err instanceof MergeConflictError) {
      status = 409;
      body = { error: 'merge_conflict', message: err.message };
    } else if (err instanceof BadRequestError) {
      status = 400;
      body = { error: 'bad_request', message: err.message };
    } else if (err instanceof NotFoundError || err instanceof UnknownKindError) {
      status = 404;
      body = { error: 'not_found', message: err.message };
    } else if (err instanceof EntityValidationError) {
      status = 400;
      body = {
        error: 'validation',
        message: err.message,
        issues: err.zodError.issues.map((i) => ({
          path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
          message: i.message,
        })),
      };
    } else if (err.statusCode && err.statusCode < 500) {
      status = err.statusCode;
      body = { error: 'validation', message: err.message };
    } else {
      app.log.error(err);
      body = { error: 'internal', message: err.message };
    }
    return reply.status(status).send(body);
  });

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    ok: true,
    gitVersion,
    libraryDir: config.libraryDir,
    indexPath: store.indexPath,
    libraryHead: (await store.git.head()) ?? '',
  }));

  app.post('/api/index/rebuild', async (): Promise<RebuildResponse> => store.rebuildIndex());

  app.get('/api/settings', async (): Promise<SettingsResponse> => ({
    settings: await store.getSettings(),
    libraryDir: config.libraryDir,
  }));

  app.put<{ Body: unknown }>('/api/settings', async (req): Promise<SettingsMutationResponse> =>
    store.updateSettings(req.body),
  );

  app.post<{ Body: { path?: unknown } | undefined }>(
    '/api/workspace/check',
    async (req): Promise<WorkspaceCheck> =>
      checkWorkspace(String(req.body?.path ?? ''), config.libraryDir),
  );

  app.post<{ Body: { path?: unknown } | undefined }>(
    '/api/workspace/init',
    async (req): Promise<WorkspaceCheck> =>
      initWorkspace(String(req.body?.path ?? ''), config.libraryDir),
  );

  app.get<{ Querystring: { path?: string } }>(
    '/api/workspace/suggest',
    async (req): Promise<WorkspaceSuggestions> => suggestWorkspaces(req.query.path ?? ''),
  );

  /**
   * Projects: the workspace must be the root of a git repo. Checked when a project is created
   * and whenever its path changes, not on every save (a moved folder must not block saving).
   */
  async function prepareProject(body: unknown, previousPath?: string): Promise<unknown> {
    if (!body || typeof body !== 'object') return body;
    const raw = (body as { workspacePath?: unknown }).workspacePath;
    if (typeof raw !== 'string' || raw.trim() === '') return body;
    const expanded = expandPath(raw);
    if (expanded === previousPath) return { ...body, workspacePath: expanded };
    const check = await checkWorkspace(raw, config.libraryDir);
    if (check.status !== 'ok') {
      throw new FieldError('invalid workspace', [
        { path: ['workspacePath'], message: check.message ?? 'invalid workspace' },
      ]);
    }
    return { ...body, workspacePath: check.path };
  }

  app.get<{ Params: { kinds: string }; Querystring: { q?: string; full?: string } }>(
    '/api/:kinds',
    async (req) => {
      const kind = kindParam(req.params.kinds);
      if (req.query.full === '1' || req.query.full === 'true') return store.listFull(kind);
      return { items: await store.list(kind, req.query.q) };
    },
  );

  app.post<{ Params: { kinds: string }; Body: unknown }>('/api/:kinds', async (req, reply) => {
    const kind = kindParam(req.params.kinds);
    const body = kind === 'project' ? await prepareProject(req.body) : req.body;
    const result = await store.create(kind, body);
    return reply.status(201).send(result);
  });

  /** `?ref=` main (default), a version (`v2`), a branch (`draft`) or a commit hash. */
  app.get<{ Params: { kinds: string; id: string }; Querystring: { ref?: string } }>(
    '/api/:kinds/:id',
    async (req) => store.get(kindParam(req.params.kinds), req.params.id, req.query.ref),
  );

  app.put<{ Params: { kinds: string; id: string }; Body: unknown }>(
    '/api/:kinds/:id',
    async (req) => {
      const kind = kindParam(req.params.kinds);
      let body = req.body;
      if (kind === 'project') {
        const previous = await store.getLatest('project', req.params.id);
        body = await prepareProject(body, previous.workspacePath);
      }
      return store.update(kind, req.params.id, body);
    },
  );

  app.delete<{ Params: { kinds: string; id: string } }>('/api/:kinds/:id', async (req) =>
    store.delete(kindParam(req.params.kinds), req.params.id),
  );

  app.get<{ Params: { kinds: string; id: string } }>(
    '/api/:kinds/:id/versions',
    async (req): Promise<VersionStatus> => store.status(kindParam(req.params.kinds), req.params.id),
  );

  app.get<{ Params: { kinds: string; id: string } }>(
    '/api/:kinds/:id/history',
    async (req): Promise<HistoryResponse> =>
      store.history(kindParam(req.params.kinds), req.params.id),
  );

  app.get<{ Params: { kinds: string; id: string }; Querystring: { from?: string; to?: string } }>(
    '/api/:kinds/:id/diff',
    async (req): Promise<DiffResponse> => {
      const { from, to } = req.query;
      if (!from || !to) throw new BadRequestError('both "from" and "to" are required');
      return store.diff(kindParam(req.params.kinds), req.params.id, from, to);
    },
  );

  app.post<{ Params: { kinds: string; id: string }; Body: MergeRequest | undefined }>(
    '/api/:kinds/:id/merge',
    async (req) => {
      const body = req.body ?? {};
      if (body.note !== undefined && typeof body.note !== 'string') {
        throw new BadRequestError('"note" must be a string');
      }
      return store.merge(kindParam(req.params.kinds), req.params.id, {
        branch: typeof body.branch === 'string' ? body.branch : undefined,
        force: body.force === true,
        note: body.note,
      });
    },
  );

  app.delete<{ Params: { kinds: string; id: string; branch: string } }>(
    '/api/:kinds/:id/branches/:branch',
    async (req): Promise<DiscardBranchResponse> => ({
      status: await store.discardBranch(
        kindParam(req.params.kinds),
        req.params.id,
        req.params.branch,
      ),
    }),
  );

  app.get<{ Params: { kinds: string; id: string } }>('/api/:kinds/:id/references', async (req) => {
    const kind = kindParam(req.params.kinds);
    await store.get(kind, req.params.id);
    return store.references(kind, req.params.id);
  });

  return { app, store };
}
