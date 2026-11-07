import {
  KIND_PLURALS,
  type ApiErrorBody,
  type CascadeApplyResponse,
  type CascadePreview,
  type CascadeRoot,
  type DeleteRequest,
  type DeleteWithReferencesResponse,
  type DeleteResponse,
  type DiffResponse,
  type DiscardBranchResponse,
  type HistoryResponse,
  type MergeRequest,
  type MergeResponse,
  type VersionStatus,
  type WorkspaceCheck,
  type WorkspaceSuggestions,
  type EntityByKind,
  type EntityInput,
  type EntityKind,
  type EntityMutationResponse,
  type FullListResponse,
  type ReferencedErrorBody,
  type RestoreDefaultsResponse,
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

  /** Save to the draft, or to an existing `branch` such as a fork. */
  update: <K extends EntityKind>(kind: K, id: string, input: EntityInput<K>, branch?: string) =>
    apiFetch<EntityMutationResponse<K>>(`${path(kind, id)}${query({ branch })}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  remove: (kind: EntityKind, id: string) =>
    apiFetch<DeleteResponse>(path(kind, id), { method: 'DELETE' }),

  versions: (kind: EntityKind, id: string) => apiFetch<VersionStatus>(`${path(kind, id)}/versions`),

  history: (kind: EntityKind, id: string) => apiFetch<HistoryResponse>(`${path(kind, id)}/history`),

  diff: (kind: EntityKind, id: string, from: string, to: string) =>
    apiFetch<DiffResponse>(`${path(kind, id)}/diff${query({ from, to })}`),

  merge: <K extends EntityKind>(kind: K, id: string, opts: MergeRequest = {}) =>
    apiFetch<MergeResponse<K>>(`${path(kind, id)}/merge`, {
      method: 'POST',
      body: JSON.stringify(opts),
    }),

  /** Create a named branch (a fork) at a main version. */
  createBranch: (kind: EntityKind, id: string, name: string, from: string) =>
    apiFetch<DiscardBranchResponse>(`${path(kind, id)}/branches`, {
      method: 'POST',
      body: JSON.stringify({ name, from }),
    }),

  /** Create a project; with `createWorkspace` the server also creates its folder and git repo. */
  createProject: (input: EntityInput<'project'>, opts: { createWorkspace?: boolean } = {}) =>
    apiFetch<EntityMutationResponse<'project'>>(
      `/projects${query({ createWorkspace: opts.createWorkspace ? '1' : undefined })}`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  checkNewWorkspace: (path: string) =>
    apiFetch<WorkspaceCheck>('/workspace/check-new', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  checkWorkspace: (path: string) =>
    apiFetch<WorkspaceCheck>('/workspace/check', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  initWorkspace: (path: string) =>
    apiFetch<WorkspaceCheck>('/workspace/init', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  suggestWorkspaces: (path: string) =>
    apiFetch<WorkspaceSuggestions>(`/workspace/suggest${query({ path })}`),

  discardBranch: (kind: EntityKind, id: string, branch: string) =>
    apiFetch<DiscardBranchResponse>(`${path(kind, id)}/branches/${encodeURIComponent(branch)}`, {
      method: 'DELETE',
    }),

  /** Delete an entity still referenced on main, keeping local copies or placeholders. */
  removeWithReferences: (kind: EntityKind, id: string, request: DeleteRequest) =>
    apiFetch<DeleteWithReferencesResponse>(`${path(kind, id)}/delete`, {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  /** Who pins older versions of the roots, transitively (PLAN.md 8.2). */
  cascadePreview: (roots: CascadeRoot[], exclude: CascadeRoot[] = []) =>
    apiFetch<CascadePreview>('/cascade/preview', {
      method: 'POST',
      body: JSON.stringify({ roots, exclude }),
    }),

  cascadeApply: (roots: CascadeRoot[], accept: string[], exclude: CascadeRoot[] = []) =>
    apiFetch<CascadeApplyResponse>('/cascade/apply', {
      method: 'POST',
      body: JSON.stringify({ roots, accept, exclude }),
    }),

  /** Settings → Restore defaults: add back deleted built-in patterns and demo content. */
  restoreDefaults: () =>
    apiFetch<RestoreDefaultsResponse>('/settings/restore-defaults', { method: 'POST' }),

  getSettings: () => apiFetch<SettingsResponse>('/settings'),

  updateSettings: (settings: Settings) =>
    apiFetch<SettingsMutationResponse>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};
