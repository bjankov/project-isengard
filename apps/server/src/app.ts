import {
  kindFromPlural,
  type ApiErrorBody,
  type DiffResponse,
  type DiscardBranchResponse,
  type HistoryResponse,
  type MergeRequest,
  type VersionStatus,
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

  app.get<{ Params: { kinds: string }; Querystring: { q?: string; full?: string } }>(
    '/api/:kinds',
    async (req) => {
      const kind = kindParam(req.params.kinds);
      if (req.query.full === '1' || req.query.full === 'true') return store.listFull(kind);
      return { items: await store.list(kind, req.query.q) };
    },
  );

  app.post<{ Params: { kinds: string }; Body: unknown }>('/api/:kinds', async (req, reply) => {
    const result = await store.create(kindParam(req.params.kinds), req.body);
    return reply.status(201).send(result);
  });

  /** `?ref=` main (default), a version (`v2`), a branch (`draft`) or a commit hash. */
  app.get<{ Params: { kinds: string; id: string }; Querystring: { ref?: string } }>(
    '/api/:kinds/:id',
    async (req) => store.get(kindParam(req.params.kinds), req.params.id, req.query.ref),
  );

  app.put<{ Params: { kinds: string; id: string }; Body: unknown }>(
    '/api/:kinds/:id',
    async (req) => store.update(kindParam(req.params.kinds), req.params.id, req.body),
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
      return store.merge(kindParam(req.params.kinds), req.params.id, {
        branch: typeof body.branch === 'string' ? body.branch : undefined,
        force: body.force === true,
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
