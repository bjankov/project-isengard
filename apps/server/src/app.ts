import {
  kindFromPlural,
  type ApiErrorBody,
  type EntityKind,
  type HealthResponse,
  type ListResponse,
  type RebuildResponse,
} from '@app/schema';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AppConfig } from './config.js';
import { checkGitInstalled } from './git.js';
import { EntityValidationError, LibraryStore, NotFoundError } from './store/library-store.js';

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
    let body: ApiErrorBody;
    if (err instanceof NotFoundError || err instanceof UnknownKindError) {
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

  app.get<{ Params: { kinds: string }; Querystring: { q?: string } }>(
    '/api/:kinds',
    async (req): Promise<ListResponse> => ({
      items: store.list(kindParam(req.params.kinds), req.query.q),
    }),
  );

  app.post<{ Params: { kinds: string }; Body: unknown }>('/api/:kinds', async (req, reply) => {
    const result = await store.create(kindParam(req.params.kinds), req.body);
    return reply.status(201).send(result);
  });

  app.get<{ Params: { kinds: string; id: string } }>('/api/:kinds/:id', async (req) =>
    store.get(kindParam(req.params.kinds), req.params.id),
  );

  app.put<{ Params: { kinds: string; id: string }; Body: unknown }>(
    '/api/:kinds/:id',
    async (req) => store.update(kindParam(req.params.kinds), req.params.id, req.body),
  );

  app.delete<{ Params: { kinds: string; id: string } }>('/api/:kinds/:id', async (req) =>
    store.delete(kindParam(req.params.kinds), req.params.id),
  );

  app.get<{ Params: { kinds: string; id: string } }>('/api/:kinds/:id/references', async (req) => {
    const kind = kindParam(req.params.kinds);
    await store.get(kind, req.params.id);
    return store.references(kind, req.params.id);
  });

  return { app, store };
}
