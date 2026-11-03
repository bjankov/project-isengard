import {
  KIND_PLURALS,
  safeParseEntity,
  type EntityByKind,
  type EntityInput,
  type EntityKind,
  type ReferencedErrorBody,
} from '@app/schema';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { SKIP_GUARD } from '@/components/unsaved-changes-guard';
import { ApiError, api } from '@/lib/api';
import { issuesToErrors, type FieldErrors } from '@/lib/validation';
import { useEntities, useLibrary } from '@/stores/library';

/** Valid id used only to validate drafts that have no id yet. */
const DRAFT_ID = 'draft-aaaaaa';

function withoutId<K extends EntityKind>(entity: EntityByKind[K]): EntityInput<K> {
  const { id: _id, ...rest } = entity;
  return rest as unknown as EntityInput<K>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type EditorSource<K extends EntityKind> =
  | { state: 'loading' }
  | { state: 'notFound' }
  | { state: 'ready'; saved: EntityByKind[K] | undefined; input: EntityInput<K> };

/**
 * Resolves what an editor starts from: the stored entity for `id`, or `makeNew()` for a new
 * one. Editors mount only once this is `ready`, so they can initialise state directly.
 */
export function useEditorSource<K extends EntityKind>(
  kind: K,
  id: string | undefined,
  makeNew: () => EntityInput<K> | undefined,
): EditorSource<K> {
  const list = useEntities(kind);
  if (id === undefined) {
    const input = makeNew();
    return input ? { state: 'ready', saved: undefined, input } : { state: 'loading' };
  }
  if (!list) return { state: 'loading' };
  const stored = list.find((e) => e.id === id);
  return stored
    ? { state: 'ready', saved: stored, input: withoutId<K>(stored) }
    : { state: 'notFound' };
}

export type EditorSourceReady<K extends EntityKind> = Extract<EditorSource<K>, { state: 'ready' }>;

export interface EntityEditor<K extends EntityKind> {
  draft: EntityInput<K>;
  /** The saved entity; undefined for a new one. */
  saved: EntityByKind[K] | undefined;
  isNew: boolean;
  dirty: boolean;
  saving: boolean;
  errors: FieldErrors;
  update: (fn: (draft: EntityInput<K>) => EntityInput<K>) => void;
  save: () => Promise<void>;
  /** Resolves to the blocking references when the delete is refused (409). */
  remove: () => Promise<ReferencedErrorBody['references'] | undefined>;
}

/**
 * Draft state for a library entity editor: tracks unsaved changes, validates with the shared
 * Zod schema and saves through the API.
 */
export function useEntityEditor<K extends EntityKind>(
  kind: K,
  source: { saved: EntityByKind[K] | undefined; input: EntityInput<K> },
): EntityEditor<K> {
  const navigate = useNavigate();
  const upsert = useLibrary((s) => s.upsert);
  const removeFromStore = useLibrary((s) => s.remove);

  const [saved, setSaved] = useState<EntityByKind[K] | undefined>(source.saved);
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
      const res = saved ? await api.update(kind, saved.id, draft) : await api.create(kind, draft);
      const input = withoutId<K>(res.entity);
      upsert(kind, res.entity);
      setSaved(res.entity);
      setBaseline(input);
      setDraft(input);
      setServerErrors({});
      setSubmitted(false);
      toast.success(res.commit ? `Saved “${res.entity.name}”` : 'No changes to save', {
        description: res.commit ? `Commit ${res.commit.hash.slice(0, 7)}` : undefined,
      });
      if (!saved) {
        void navigate(`/${KIND_PLURALS[kind]}/${res.entity.id}`, {
          replace: true,
          state: SKIP_GUARD,
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
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
  }, [draft, saving, kind, saved, upsert, navigate]);

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
  };
}
