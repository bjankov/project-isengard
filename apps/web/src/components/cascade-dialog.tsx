/**
 * Cascade preview (PLAN.md 8.2): after an entity gets a new main version, everything that pins
 * an older version of it, as a tree. Accept all, decline all, or choose per case. Forks are
 * listed but not selected. Nothing changes until Apply.
 */
import {
  caseAvailable,
  defaultAccepted,
  enabledCases,
  type CascadeCase,
  type CascadeEntity,
  type CascadePreview,
  type EntityKind,
} from '@app/schema';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpCircle,
  GitBranch,
  GitFork,
  Loader2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFetched } from '@/hooks/use-fetched';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PINNABLE, useCascade } from '@/stores/cascade';
import { useLibrary } from '@/stores/library';
import { usePinnedStore } from '@/stores/pinned';

const KIND_LABEL: Record<EntityKind, string> = {
  skill: 'Skill',
  tool: 'Tool preset',
  agent: 'Agent',
  pattern: 'Pattern',
  template: 'Template',
  project: 'Project',
};

const KIND_ORDER: EntityKind[] = ['skill', 'tool', 'agent', 'pattern', 'template', 'project'];

/** Cases accepted when the dialog opens: the defaults, minus updates that would add errors. */
function initialAccepted(preview: CascadePreview): Set<string> {
  const blocked = new Set(preview.entities.filter((e) => e.problems.length > 0).map((e) => e.key));
  return new Set(
    [...defaultAccepted(preview)].filter((id) => {
      const c = preview.cases.find((x) => x.id === id);
      return c && !blocked.has(c.referrer);
    }),
  );
}

export function CascadeDialog() {
  const request = useCascade((s) => s.request);
  const close = useCascade((s) => s.close);
  const fetched = useFetched(request ? String(request.seq) : undefined, () =>
    api.cascadePreview(request?.roots ?? [], request?.exclude),
  );
  const preview = fetched.data;
  const error = fetched.error;
  // The user's choices, for this request; the defaults until they change something.
  const [choice, setChoice] = useState<{ seq: number; accepted: Set<string> }>();
  const accepted = useMemo(
    () =>
      choice && choice.seq === request?.seq
        ? choice.accepted
        : preview
          ? initialAccepted(preview)
          : new Set<string>(),
    [choice, request?.seq, preview],
  );
  const setAccepted = (fn: Set<string> | ((s: Set<string>) => Set<string>)) => {
    if (!request) return;
    setChoice({ seq: request.seq, accepted: typeof fn === 'function' ? fn(accepted) : fn });
  };
  const [applying, setApplying] = useState(false);

  const enabled = useMemo(
    () => (preview ? enabledCases(preview, accepted) : new Set<string>()),
    [preview, accepted],
  );

  const apply = async () => {
    if (!request || !preview) return;
    setApplying(true);
    try {
      const res = await api.cascadeApply(request.roots, [...enabled], request.exclude);
      const kinds = new Set(res.updated.map((u) => u.kind));
      const { load } = useLibrary.getState();
      await Promise.all([...kinds].map((k) => load(k)));
      usePinnedStore.getState().forgetBranches();
      useCascade.getState().applied();
      const n = res.updated.length;
      toast.success(
        n === 0
          ? 'Nothing was updated'
          : `Updated ${n === 1 ? '1 entity' : `${String(n)} entities`}`,
        {
          description: res.commit ? `Commit ${res.commit.hash.slice(0, 7)}` : undefined,
        },
      );
      close();
    } catch (err) {
      const problems =
        err instanceof ApiError && err.body && 'problems' in err.body
          ? (err.body.problems ?? [])
          : [];
      toast.error('Could not apply the updates', {
        description: problems[0]?.message ?? (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setApplying(false);
    }
  };

  const total = preview?.cases.length ?? 0;
  const trees = useMemo(() => {
    const out = new Map<string, TreeNode[]>();
    if (!preview) return out;
    const shown = new Set(preview.roots);
    for (const root of preview.roots) out.set(root, buildTree(preview, root, shown));
    return out;
  }, [preview]);

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && !applying && close()}>
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-3xl"
        aria-describedby="cascade-intro"
      >
        <DialogHeader>
          <DialogTitle>Update what uses it?</DialogTitle>
          <DialogDescription id="cascade-intro">
            {request?.intro} These pin older versions. Accepted updates get a new version of their
            own; project overrides are kept. Forks are listed, but not selected.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !preview ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Finding everything that uses it…
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Button
                size="xs"
                variant="outline"
                onClick={() => setAccepted(new Set(preview.cases.map((c) => c.id)))}
              >
                Accept all
              </Button>
              <Button size="xs" variant="outline" onClick={() => setAccepted(new Set())}>
                Decline all
              </Button>
              <span className="ml-auto text-muted-foreground" data-testid="cascade-count">
                {enabled.size} of {total} {total === 1 ? 'update' : 'updates'} selected
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border p-3" role="tree">
              {preview.roots.map((root) => {
                const info = preview.entities.find((e) => e.key === root);
                return (
                  <div key={root} className="mb-3 last:mb-0">
                    <div className="text-sm font-semibold">
                      {info ? KIND_LABEL[info.kind] : ''} {info?.name}{' '}
                      <Badge variant="secondary">{info?.version}</Badge>
                    </div>
                    <Level
                      preview={preview}
                      nodes={trees.get(root) ?? []}
                      accepted={accepted}
                      enabled={enabled}
                      setAccepted={setAccepted}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={applying}>
            Not now
          </Button>
          <Button
            onClick={() => void apply()}
            disabled={!preview || applying || enabled.size === 0}
          >
            {applying && <Loader2 className="animate-spin" />}
            Apply{' '}
            {enabled.size > 0
              ? `${String(enabled.size)} ${enabled.size === 1 ? 'update' : 'updates'}`
              : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface TreeNode {
  entity: CascadeEntity;
  /** Its cases pinning this branch's target. */
  cases: CascadeCase[];
  children: TreeNode[];
  /** Already shown (with what uses it) earlier in the tree. */
  repeat: boolean;
}

/** The referrers of `target`, depth first, each entity's subtree shown only once. */
function buildTree(preview: CascadePreview, target: string, shown: Set<string>): TreeNode[] {
  const groups = new Map<string, CascadeCase[]>();
  for (const c of preview.cases) {
    if (c.target === target) groups.set(c.referrer, [...(groups.get(c.referrer) ?? []), c]);
  }
  return [...groups.keys()]
    .map((k) => preview.entities.find((e) => e.key === k))
    .filter((e): e is CascadeEntity => !!e)
    .sort(
      (a, b) =>
        Number(!!a.branch) - Number(!!b.branch) ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.name.localeCompare(b.name),
    )
    .map((entity) => {
      const repeat = shown.has(entity.key);
      shown.add(entity.key);
      return {
        entity,
        cases: groups.get(entity.key) ?? [],
        children: repeat || entity.branch ? [] : buildTree(preview, entity.key, shown),
        repeat,
      };
    });
}

function Level({
  preview,
  nodes,
  accepted,
  enabled,
  setAccepted,
}: {
  preview: CascadePreview;
  nodes: TreeNode[];
  accepted: Set<string>;
  enabled: Set<string>;
  setAccepted: (fn: (s: Set<string>) => Set<string>) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <ul className="ml-3 mt-1 space-y-1 border-l pl-3">
      {nodes.map(({ entity: e, cases, children, repeat }) => {
        const updated =
          !e.branch && preview.cases.some((c) => c.referrer === e.key && enabled.has(c.id));
        const usedBy = preview.cases.some((c) => c.target === e.key);
        return (
          <li key={e.key} role="treeitem" aria-label={`${KIND_LABEL[e.kind]} ${e.name}`}>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">{KIND_LABEL[e.kind]}</span>
              <span className="font-medium">{e.name}</span>
              {e.branch ? (
                <Badge variant="outline" className="gap-1">
                  <GitFork /> fork
                </Badge>
              ) : updated ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {e.version} <ArrowRight className="size-3" /> {e.next}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">stays {e.version}</span>
              )}
              {e.hasDraft && updated && (
                <Badge variant="outline" className="gap-1" title="Its draft gets the same update">
                  <GitBranch /> draft too
                </Badge>
              )}
            </div>
            {e.problems.length > 0 && (
              <p className="mt-0.5 flex items-start gap-1 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                Would add{' '}
                {e.problems.length === 1 ? 'an error' : `${String(e.problems.length)} errors`}:{' '}
                {e.problems[0]?.message}
              </p>
            )}
            <ul className="mt-0.5 space-y-0.5">
              {cases.map((c) => {
                const available = caseAvailable(preview, c, enabled);
                return (
                  <li key={c.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent',
                        !available && 'cursor-not-allowed opacity-50',
                      )}
                      title={available ? undefined : 'Accept the update it depends on first'}
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 accent-primary"
                        checked={accepted.has(c.id) && available}
                        disabled={!available}
                        onChange={(ev) => {
                          const on = ev.target.checked;
                          setAccepted((s) => {
                            const next = new Set(s);
                            if (on) next.add(c.id);
                            else next.delete(c.id);
                            return next;
                          });
                        }}
                        aria-label={`${e.name}: ${c.label}`}
                      />
                      <span>{c.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.from} → {c.to}
                      </span>
                      {c.fork === 'pins-fork' && (
                        <span className="text-xs text-amber-700">
                          {c.danglingFork
                            ? 'its fork no longer exists'
                            : 'drops this customization'}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
            {repeat && usedBy ? (
              <p className="ml-6 text-xs text-muted-foreground">What uses it is listed above.</p>
            ) : (
              <Level
                preview={preview}
                nodes={children}
                accepted={accepted}
                enabled={enabled}
                setAccepted={setAccepted}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Editor header entry: how many entities pin an older version of this one, with a button that
 * opens the cascade preview. Hidden when there are none.
 */
export function OutdatedUsers({
  kind,
  id,
  name,
  version,
}: {
  kind: EntityKind;
  id: string;
  name: string;
  version: string | null;
}) {
  const generation = useCascade((s) => s.generation);
  const open = useCascade((s) => s.open);
  const { data } = useFetched(
    PINNABLE.has(kind) && version ? `${kind}/${id}@${version}#${String(generation)}` : undefined,
    () => api.cascadePreview([{ kind, id }]),
  );
  const root = `${kind}/${id}`;
  const users = new Set(data?.cases.filter((c) => c.target === root).map((c) => c.referrer));
  if (users.size === 0) return null;
  return (
    <Button
      size="xs"
      variant="outline"
      className="gap-1 border-sky-300 text-sky-800"
      title="They pin an older version. Review and update them."
      onClick={() => open({ roots: [{ kind, id }], intro: `“${name}” is ${version ?? ''}.` })}
    >
      <ArrowUpCircle className="size-3" />
      {users.size === 1 ? '1 user' : `${String(users.size)} users`} on older versions
    </Button>
  );
}
