import {
  KIND_PLURALS,
  type ApiErrorBody,
  type DeleteResponse,
  type EntityByKind,
  type EntityInput,
  type EntityKind,
  type EntityMutationResponse,
  type FullListResponse,
  type ReferencedErrorBody,
  type Settings,
  type SettingsMutationResponse,
  type SettingsResponse,
} from '@app/schema';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | ReferencedErrorBody | undefined,
  ) {
    super(body?.message ?? `request failed with status ${status}`);
    this.name = 'ApiError';
  }

  /** Field issues from a 400 validation error. */
  get issues(): { path: (string | number)[]; message: string }[] {
    return this.body && 'issues' in this.body ? (this.body.issues ?? []) : [];
  }

  /** Entities blocking a delete (409). */
  get references(): ReferencedErrorBody['references'] {
    return this.body && 'references' in this.body ? this.body.references : [];
  }
}

/** Minimal JSON fetch wrapper for the local API. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody | undefined);
  return data as T;
}

const path = (kind: EntityKind, id?: string) =>
  `/${KIND_PLURALS[kind]}${id ? `/${encodeURIComponent(id)}` : ''}`;

export const api = {
  list: <K extends EntityKind>(kind: K) =>
    apiFetch<FullListResponse<K>>(`${path(kind)}?full=1`).then((r) => r.items),

  get: <K extends EntityKind>(kind: K, id: string) => apiFetch<EntityByKind[K]>(path(kind, id)),

  create: <K extends EntityKind>(kind: K, input: EntityInput<K>) =>
    apiFetch<EntityMutationResponse<K>>(path(kind), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: <K extends EntityKind>(kind: K, id: string, input: EntityInput<K>) =>
    apiFetch<EntityMutationResponse<K>>(path(kind, id), {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  remove: (kind: EntityKind, id: string) =>
    apiFetch<DeleteResponse>(path(kind, id), { method: 'DELETE' }),

  getSettings: () => apiFetch<SettingsResponse>('/settings'),

  updateSettings: (settings: Settings) =>
    apiFetch<SettingsMutationResponse>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};
