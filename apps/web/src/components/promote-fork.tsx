/**
 * Promoting a fork (PLAN.md 7.7) of an agent or pattern that a project node pins: merge it to
 * main as the next version (showing main and the fork side by side if main changed since the
 * fork started), or save it as a new entity. Either way the fork branch is gone afterwards, and
 * the caller re-pins the node.
 */
import { MERGE_NOTE_MAX, normalizeMergeNote, type EntityInput, type Ref } from '@app/schema';
import { GitMerge, CopyPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FileDiffs } from '@/components/diff-viewer';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useFetched } from '@/hooks/use-fetched';
import { ApiError, api } from '@/lib/api';
import { useLibrary, useVersions } from '@/stores/library';

type ForkKind = 'agent' | 'pattern';

const NOUN: Record<ForkKind, string> = { agent: 'agent', pattern: 'pattern' };

function nextVersion(current: string | undefined): string {
  const n = current ? Number(current.slice(1)) : 0;
  return `v${String(n + 1)}`;
}

export function PromoteFork({
  kind,
  id,
  branch,
  name,
  disabledReason,
  onPromoted,
}: {
  kind: ForkKind;
  id: string;
  /** The fork branch the node pins. */
  branch: string;
  /** The entity's name on main, for labels. */
  name: string;
  /** Why promoting isn't possible right now (e.g. unsaved project changes). */
  disabledReason?: string;
  /** Re-pin the node to what the fork became (and save). */
  onPromoted: (ref: Pick<Ref, 'id' | 'version'>) => void;
}) {
  const [dialog, setDialog] = useState<'merge' | 'conflict' | 'new' | null>(null);
  const [note, setNote] = useState('');
  const [newName, setNewName] = useState(`${name} (custom)`);
  const [busy, setBusy] = useState(false);
  const upsert = useLibrary((s) => s.upsert);
  const setVersion = useLibrary((s) => s.setVersion);
  const current = useVersions(kind)[id]?.version ?? undefined;
  const next = nextVersion(current);
  const noteTooLong = note.trim().length > MERGE_NOTE_MAX;

  const merge = async (force: boolean) => {
    setBusy(true);
    try {
      const res = await api.merge(kind, id, { branch, force, note: normalizeMergeNote(note) });
      upsert(kind, res.entity);
      setVersion(kind, id, {
        version: res.version,
        hasDraft: res.status.branches.some((b) => b.name === 'draft'),
      });
      toast.success(`Merged the fork into “${res.entity.name}” as ${res.version}`, {
        description: `Commit ${res.commit.hash.slice(0, 7)}. Other users of the ${NOUN[kind]} keep their version until they update.`,
      });
      setDialog(null);
      onPromoted({ id, version: res.version });
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'merge_conflict') {
        setDialog('conflict');
      } else {
        toast.error('Could not merge the fork', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const saveAsNew = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const fork = await api.get(kind, id, branch);
      const { id: _old, ...input } = fork;
      const res = await api.create(kind, { ...input, name: trimmed } as EntityInput<typeof kind>);
      upsert(kind, res.entity);
      setVersion(kind, res.entity.id, { version: res.status.current ?? 'v1', hasDraft: false });
      await api.discardBranch(kind, id, branch);
      toast.success(`Saved the fork as “${res.entity.name}”`, {
        description: `A new ${NOUN[kind]} in the library (${res.status.current ?? 'v1'}). “${name}” is unchanged.`,
      });
      setDialog(null);
      onPromoted({ id: res.entity.id, version: res.status.current ?? 'v1' });
    } catch (err) {
      toast.error(`Could not save the fork as a new ${NOUN[kind]}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2" title={disabledReason}>
        <Button
          size="sm"
          variant="outline"
          disabled={!!disabledReason}
          onClick={() => setDialog('merge')}
        >
          <GitMerge />
          Merge to main
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!disabledReason}
          onClick={() => setDialog('new')}
        >
          <CopyPlus />
          Save as new {NOUN[kind]}
        </Button>
      </div>
      {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}

      <Dialog open={dialog === 'merge'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!noteTooLong) void merge(false);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>
                Merge the fork into “{name}” as {next}?
              </DialogTitle>
              <DialogDescription>
                The library {NOUN[kind]} gets this fork’s content as {next}, and this node pins{' '}
                {next}. Other projects keep the version they pin until they update. The project is
                saved right after.
              </DialogDescription>
            </DialogHeader>
            <Field
              label="What changed?"
              htmlFor="promote-note"
              hint="Optional. Shown in the history."
              error={noteTooLong ? `At most ${String(MERGE_NOTE_MAX)} characters.` : undefined}
            >
              <Input id="promote-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || noteTooLong}>
                Merge as {next}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ForkConflictDialog
        open={dialog === 'conflict'}
        onOpenChange={(open) => !open && setDialog(null)}
        kind={kind}
        id={id}
        branch={branch}
        name={name}
        next={next}
        busy={busy}
        onMerge={() => void merge(true)}
      />

      <Dialog open={dialog === 'new'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveAsNew();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Save the fork as a new {NOUN[kind]}</DialogTitle>
              <DialogDescription>
                It becomes a separate library {NOUN[kind]} (v1) that this node pins. “{name}” stays
                as it is. The project is saved right after.
              </DialogDescription>
            </DialogHeader>
            <Field
              label="Name"
              htmlFor="promote-name"
              error={newName.trim() ? undefined : 'Give it a name.'}
            >
              <Input
                id="promote-name"
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !newName.trim()}>
                Save as new {NOUN[kind]}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Main changed since the fork started: show both side by side before merging (PLAN.md 7.7). */
function ForkConflictDialog({
  open,
  onOpenChange,
  kind,
  id,
  branch,
  name,
  next,
  busy,
  onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ForkKind;
  id: string;
  branch: string;
  name: string;
  next: string;
  busy: boolean;
  onMerge: () => void;
}) {
  const diff = useFetched(open ? `${kind}/${id}:main..${branch}` : undefined, () =>
    api.diff(kind, id, 'main', branch),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>“{name}” changed on main since this fork started</DialogTitle>
          <DialogDescription>
            Main (left) has a newer version than the one this fork started from. Merging replaces
            main with the fork (right) as {next}; main’s current version stays in the history.
            Nothing is merged line by line.
          </DialogDescription>
        </DialogHeader>
        {diff.error ? (
          <p className="text-sm text-destructive">{diff.error}</p>
        ) : diff.data ? (
          <FileDiffs
            files={diff.data.files}
            fromLabel="main"
            toLabel="fork"
            className="min-h-0 flex-1"
          />
        ) : (
          <div className="flex-1 animate-pulse rounded-lg bg-muted/40" />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onMerge}>
            Merge anyway as {next}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
