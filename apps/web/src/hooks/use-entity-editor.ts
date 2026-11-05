import {
  DRAFT_BRANCH,
  KIND_PLURALS,
  draftOf,
  normalizeMergeNote,
  safeParseEntity,
  type EntityByKind,
  type EntityInput,
  type EntityKind,
  type ReferencedErrorBody,
  type VersionStatus,
} from '@app/schema';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { SKIP_GUARD } from '@/components/unsaved-changes-guard';
import { ApiError, api } from '@/lib/api';
import { issuesToErrors, type FieldErrors } from '@/lib/validation';
import { useEntities, useLibrary } from '@/stores/library';
import { sameData } from '@/lib/same';

/** Valid id used only to validate drafts that have no id yet. */
const DRAFT_ID = 'draft-aaaaaa';

function withoutId<K extends EntityKind>(entity: EntityByKind[K]): EntityInput<K> {
  const { id: _id, ...rest } = entity;
  return rest as unknown as EntityInput<K>;
}

const same = sameData;

export type EditorSource<K extends EntityKind> =
  | { state: 'loading' }
  | { state: 'notFound' }
  | {
      state: 'ready';
      /** What the editor starts from: the draft if there is one, otherwise main. */
      saved: EntityByKind[K] | undefined;
      input: EntityInput<K>;
      /** Undefined for a new entity, or when the version state could not be loaded. */
      status: VersionStatus | undefined;
      /** The branch saves go to: the draft, or a fork opened with `?branch=`. */
      branch: string;
    };

interface LoadedVersions<K extends EntityKind> {
  key: string;
  status?: VersionStatus;
  /** The entity on the branch being edited, if that branch exists. */
  onBranch?: EntityByKind[K];
  missingBranch?: boolean;
}

/**
 * Resolves what an editor starts from: the entity's draft when it has one, otherwise its main
 * version, or `makeNew()` for a new entity. Editors mount only once this is `ready`, so they
 * can initialise state directly.
 */
export function useEditorSource<K extends EntityKind>(
  kind: K,
  id: string | undefined,
  makeNew: () => EntityInput<K> | undefined,
  /** Edit this existing branch (a fork) instead of the draft. */
  branch: string = DRAFT_BRANCH,
): EditorSource<K> {
  const list = useEntities(kind);
  const key = id === undefined ? undefined : `${kind}/${id}@${branch}`;
  const [loaded, setLoaded] = useState<LoadedVersions<K>>();

  useEffect(() => {
    if (key === undefined || id === undefined) return;
    let cancelled = false;
    void (async () => {
      let status: VersionStatus | undefined;
      let onBranch: EntityByKind[K] | undefined;
      let missingBranch = false;
      try {
        status = await api.versions(kind, id);
        if (status.branches.some((b) => b.name === branch)) {
          onBranch = await api.get(kind, id, branch);
        } else missingBranch = branch !== DRAFT_BRANCH;
      } catch (err) {
        // Not found is shown from the list below; otherwise edit main without version info.
        if (!(err instanceof ApiError && err.status === 404)) {
          toast.error('Could not load versions', {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (!cancelled) setLoaded({ key, status, onBranch, missingBranch });
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, id, key, branch]);

  if (id === undefined) {
    const input = makeNew();
    return input
      ? { state: 'ready', saved: undefined, input, status: undefined, branch: DRAFT_BRANCH }
      : { state: 'loading' };
  }
  if (!list) return { state: 'loading' };
  const stored = list.find((e) => e.id === id);
  if (!stored) return { state: 'notFound' };
  if (!loaded || loaded.key !== key) return { state: 'loading' };
  if (loaded.missingBranch) return { state: 'notFound' };
  const saved = loaded.onBranch ?? stored;
  return { state: 'ready', saved, input: withoutId<K>(saved), status: loaded.status, branch };
}

export type EditorSourceReady<K extends EntityKind> = Extract<EditorSource<K>, { state: 'ready' }>;

export type MergeOutcome = 'merged' | 'conflict' | 'failed';

/** Version state and actions of an editor, shown in its header. */
export interface Versioning {
  kind: EntityKind;
  /** Undefined until the entity has been created. */
  id: string | undefined;
  name: string;
  status: VersionStatus | undefined;
  /** The branch saves go to: `draft`, or a fork. */
  branch: string;
  /** Unsaved changes in the editor. */
  dirty: boolean;
  busy: boolean;
  /**
   * Merge the draft to main, with an optional note on what changed. `force` merges even if
   * main changed since the draft started.
   */
  merge: (opts?: { force?: boolean; note?: string }) => Promise<MergeOutcome>;
  /** Delete the draft and go back to main. */
  discard: () => Promise<void>;
  /** Why merging is not possible right now (e.g. the workflow has errors), shown on Merge. */
  mergeBlocked?: string;
}

export interface EntityEditor<K extends EntityKind> {
  draft: EntityInput<K>;
  /** The last saved state (the draft branch if there is one, else main); undefined for a new one. */
  saved: EntityByKind[K] | undefined;
  isNew: boolean;
  dirty: boolean;
  saving: boolean;
  errors: FieldErrors;
  update: (fn: (draft: EntityInput<K>) => EntityInput<K>) => void;
  save: () => Promise<void>;
  /** Resolves to the blocking references when the delete is refused (409). */
  remove: () => Promise<ReferencedErrorBody['references'] | undefined>;
  versioning: Versioning;
}

/**
 * State for a library entity editor: tracks unsaved changes, validates with the shared Zod
 * schema, saves through the API (creating on main, then committing to the draft branch) and
 * merges or discards the draft.
 */
export function useEntityEditor<K extends EntityKind>(
  kind: K,
  source: {
    saved: EntityByKind[K] | undefined;
    input: EntityInput<K>;
    status: VersionStatus | undefined;
    branch?: string;
  },
): EntityEditor<K> {
  const branch = source.branch ?? DRAFT_BRANCH;
  const navigate = useNavigate();
  const upsert = useLibrary((s) => s.upsert);
  const setVersion = useLibrary((s) => s.setVersion);
  const removeFromStore = useLibrary((s) => s.remove);

  const [saved, setSaved] = useState<EntityByKind[K] | undefined>(source.saved);
  const [status, setStatusState] = useState<VersionStatus | undefined>(source.status);
  const [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState<EntityInput<K>>(source.input);
  const [draft, setDraft] = useState<EntityInput<K>>(source.input);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const isNew = saved === undefined;

  const dirty = !same(draft, baseline);

  const clientErrors = useMemo<FieldErrors>(() => {
    if (!submitted) return {};
    const result = safeParseEntity(kind, { ...draft, id: DRAFT_ID });
    return result.success ? {} : issuesToErrors(result.error.issues);
  }, [kind, draft, submitted]);

  const errors = useMemo(
    () => ({ ...serverErrors, ...clientErrors }),
    [serverErrors, clientErrors],
  );

  /** Keep the editor's status and the list's version badge in step. */
  const setStatus = useCallback(
    (id: string, next: VersionStatus) => {
      setStatusState(next);
      setVersion(kind, id, { version: next.current, hasDraft: !!draftOf(next) });
    },
    [kind, setVersion],
  );

  /** Reset the editor to a saved entity. */
  const resetTo = useCallback((entity: EntityByKind[K]) => {
    const input = withoutId<K>(entity);
    setSaved(entity);
    setBaseline(input);
    setDraft(input);
    setServerErrors({});
    setSubmitted(false);
  }, []);

  const update = useCallback((fn: (d: EntityInput<K>) => EntityInput<K>) => {
    setServerErrors({});
    setDraft(fn);
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    setSubmitted(true);
    const check = safeParseEntity(kind, { ...draft, id: saved?.id ?? DRAFT_ID });
    if (!check.success) {
      toast.error('Some fields need attention', { description: check.error.issues[0]?.message });
      return;
    }
    setSaving(true);
    try {
      const res = saved
        ? await api.update(kind, saved.id, draft, branch === DRAFT_BRANCH ? undefined : branch)
        : await api.create(kind, draft);
      // Creating writes main; updating only writes the draft, so the list (main) stays.
      if (!saved) upsert(kind, res.entity);
      setStatus(res.entity.id, res.status);
      resetTo(res.entity);
      const where = !saved
        ? `as ${res.status.current ?? 'v1'}`
        : branch === DRAFT_BRANCH
          ? 'to the draft'
          : `to ${branch}`;
      toast.success(res.commit ? `Saved “${res.entity.name}” ${where}` : 'No changes to save', {
        description: res.commit ? `Commit ${res.commit.hash.slice(0, 7)}` : undefined,
      });
      if (!saved) {
        void navigate(`/${KIND_PLURALS[kind]}/${res.entity.id}`, {
          replace: true,
          state: SKIP_GUARD,
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'workflow') {
        toast.error('The workflow can’t be saved', { description: err.message });
      } else if (err instanceof ApiError && err.status === 400) {
        setServerErrors(issuesToErrors(err.issues));
        toast.error('The server rejected some fields', { description: err.issues[0]?.message });
      } else {
        toast.error('Could not save', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setSaving(false);
    }
  }, [draft, saving, kind, saved, upsert, navigate, setStatus, resetTo, branch]);

  const merge = useCallback(
    async ({
      force = false,
      note,
    }: { force?: boolean; note?: string } = {}): Promise<MergeOutcome> => {
      if (!saved || busy) return 'failed';
      setBusy(true);
      try {
        const res = await api.merge(kind, saved.id, { force, note: normalizeMergeNote(note) });
        upsert(kind, res.entity);
        setStatus(res.entity.id, res.status);
        setSaved(res.entity);
        toast.success(`Merged “${res.entity.name}” as ${res.version}`, {
          description: `Commit ${res.commit.hash.slice(0, 7)}`,
        });
        return 'merged';
      } catch (err) {
        if (err instanceof ApiError && err.body?.error === 'merge_conflict') return 'conflict';
        toast.error('Could not merge', {
          description: err instanceof Error ? err.message : String(err),
        });
        return 'failed';
      } finally {
        setBusy(false);
      }
    },
    [saved, busy, kind, upsert, setStatus],
  );

  const discard = useCallback(async () => {
    if (!saved || busy) return;
    setBusy(true);
    try {
      const res = await api.discardBranch(kind, saved.id, DRAFT_BRANCH);
      const main = await api.get(kind, saved.id);
      upsert(kind, main);
      setStatus(saved.id, res.status);
      resetTo(main);
      toast.success('Draft discarded', {
        description: res.status.current ? `Back to ${res.status.current}` : undefined,
      });
    } catch (err) {
      toast.error('Could not discard the draft', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [saved, busy, kind, upsert, setStatus, resetTo]);

  const remove = useCallback(async () => {
    if (!saved) return undefined;
    try {
      await api.remove(kind, saved.id);
      removeFromStore(kind, saved.id);
      toast.success(`Deleted “${saved.name}”`);
      void navigate(`/${KIND_PLURALS[kind]}`, { replace: true, state: SKIP_GUARD });
      return undefined;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return err.references;
      toast.error('Could not delete', {
        description: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }, [saved, kind, removeFromStore, navigate]);

  return {
    draft,
    saved,
    isNew,
    dirty,
    saving,
    errors,
    update,
    save,
    remove,
    versioning: {
      kind,
      id: saved?.id,
      name: saved?.name ?? '',
      status,
      branch,
      dirty,
      busy,
      merge,
      discard,
    },
  };
}
