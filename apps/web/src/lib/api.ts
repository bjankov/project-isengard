import {
  KIND_PLURALS,
  type ApiErrorBody,
  type DeleteResponse,
  type DiffResponse,
  type DiscardBranchResponse,
  type HistoryResponse,
  type MergeResponse,
  type VersionStatus,
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

const query = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const api = {
  /** Complete entities as on main, with each entity's version state. */
  list: <K extends EntityKind>(kind: K) => apiFetch<FullListResponse<K>>(`${path(kind)}?full=1`),

  /** The entity at `ref`: main (default), a version (`v2`), a branch (`draft`) or a commit. */
  get: <K extends EntityKind>(kind: K, id: string, ref?: string) =>
    apiFetch<EntityByKind[K]>(`${path(kind, id)}${query({ ref })}`),

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

  versions: (kind: EntityKind, id: string) => apiFetch<VersionStatus>(`${path(kind, id)}/versions`),

  history: (kind: EntityKind, id: string) => apiFetch<HistoryResponse>(`${path(kind, id)}/history`),

  diff: (kind: EntityKind, id: string, from: string, to: string) =>
    apiFetch<DiffResponse>(`${path(kind, id)}/diff${query({ from, to })}`),

  merge: <K extends EntityKind>(kind: K, id: string, opts: { force?: boolean } = {}) =>
    apiFetch<MergeResponse<K>>(`${path(kind, id)}/merge`, {
      method: 'POST',
      body: JSON.stringify(opts),
    }),

  discardBranch: (kind: EntityKind, id: string, branch: string) =>
    apiFetch<DiscardBranchResponse>(`${path(kind, id)}/branches/${encodeURIComponent(branch)}`, {
      method: 'DELETE',
    }),

  getSettings: () => apiFetch<SettingsResponse>('/settings'),

  updateSettings: (settings: Settings) =>
    apiFetch<SettingsMutationResponse>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};
