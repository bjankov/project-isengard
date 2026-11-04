import { draftOf, versionName, versionNumber, type HistoryResponse } from '@app/schema';
import { GitBranch, GitMerge, History, Loader2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { FileDiffs } from '@/components/diff-viewer';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Versioning } from '@/hooks/use-entity-editor';
import { useFetched } from '@/hooks/use-fetched';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';

/** The version a merge of the current draft would create. */
function nextVersion(current: string | null): string {
  return versionName((current ? (versionNumber(current) ?? 0) : 0) + 1);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---- Indicator (title row) ----

/** Current version and which branch the editor is on. */
export function VersionIndicator({ versioning: v }: { versioning: Versioning }) {
  if (!v.id) {
    return (
      <span className="text-xs text-muted-foreground" data-testid="version-indicator">
        New · saving creates v1
      </span>
    );
  }
  if (!v.status) return null;
  const { current } = v.status;
  const draft = draftOf(v.status);
  const next = nextVersion(current);

  let chip: React.ReactNode;
  let explanation: string;
  if (draft) {
    chip = (
      <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-amber-800">
        <GitBranch className="size-3" />
        draft · {draft.changed ? plural(draft.commits, 'save') : 'no changes'}
      </span>
    );
    explanation = draft.changed
      ? `You are editing the draft branch. Its saves are not on main yet: merge to publish them as ${next}.`
      : 'You are editing the draft branch. It matches main again, so there is nothing to merge.';
  } else if (v.dirty) {
    chip = (
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-warning px-1.5 py-0.5 text-xs font-medium text-amber-800">
        <GitBranch className="size-3" />
        new draft
      </span>
    );
    explanation = `Saving starts a draft branch. Main stays at ${current ?? 'v1'} until you merge.`;
  } else {
    chip = (
      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
        <GitBranch className="size-3" />
        main
      </span>
    );
    explanation = `This is ${current ?? 'the current version'} on main. Saving starts a draft branch; main changes only when you merge.`;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5" data-testid="version-indicator">
          {current && (
            <Badge variant="outline" className="rounded-md px-1.5 py-0 font-mono text-[11px]">
              {current}
            </Badge>
          )}
          {chip}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{explanation}</TooltipContent>
    </Tooltip>
  );
}

// ---- Actions (header buttons) ----

/** History, Discard draft and Merge buttons, with their dialogs. */
export function VersionActions({ versioning: v }: { versioning: Versioning }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [conflict, setConflict] = useState(false);
  if (!v.id || !v.status) return null;
  const draft = draftOf(v.status);
  const next = nextVersion(v.status.current);

  const mergeBlocked = v.dirty
    ? 'Save your changes first. Merge publishes what is saved on the draft.'
    : draft && !draft.changed
      ? 'The draft matches main, so there is nothing to merge. Discard it instead.'
      : undefined;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="History"
            onClick={() => setHistoryOpen(true)}
          >
            <History />
          </Button>
        </TooltipTrigger>
        <TooltipContent>History and diffs</TooltipContent>
      </Tooltip>

      {draft && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDiscard(true)}
            disabled={v.busy}
          >
            <Undo2 />
            Discard draft
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* span: disabled buttons do not fire the events tooltips need */}
              <span tabIndex={mergeBlocked ? 0 : undefined}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!mergeBlocked || v.busy}
                  onClick={() =>
                    void v.merge().then((outcome) => outcome === 'conflict' && setConflict(true))
                  }
                >
                  {v.busy ? <Loader2 className="animate-spin" /> : <GitMerge />}
                  Merge as {next}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {mergeBlocked ?? `Publish the draft to main as ${next}. The draft branch is closed.`}
            </TooltipContent>
          </Tooltip>
        </>
      )}

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard the draft of “{v.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {draft
                ? `${plural(draft.commits, 'saved change')} on the draft branch `
                : 'The draft '}
              {v.dirty ? 'and your unsaved edits ' : ''}
              are thrown away. The editor goes back to {v.status.current ?? 'main'}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void v.discard()}>
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MergeConflictDialog versioning={v} open={conflict} onOpenChange={setConflict} next={next} />

      <HistorySheet versioning={v} open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  );
}

// ---- Merge conflict ----

function MergeConflictDialog({
  versioning: v,
  open,
  onOpenChange,
  next,
}: {
  versioning: Versioning;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  next: string;
}) {
  const id = v.id;
  const diff = useFetched(open && id ? `${v.kind}/${id}:conflict` : undefined, () =>
    api.diff(v.kind, id ?? '', 'main', 'draft'),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Main changed since this draft started</DialogTitle>
          <DialogDescription>
            Someone changed “{v.name}” on main after the draft branched off (for example by editing
            the library files directly). Merging replaces main with the draft as {next}; the changes
            on main stay in the history.
          </DialogDescription>
        </DialogHeader>
        {diff.error ? (
          <p className="text-sm text-destructive">{diff.error}</p>
        ) : diff.data ? (
          <FileDiffs
            files={diff.data.files}
            fromLabel="main"
            toLabel="draft"
            className="min-h-0 flex-1"
          />
        ) : (
          <div className="flex-1 animate-pulse rounded-lg bg-muted/40" />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={v.busy}
            onClick={() =>
              void v.merge(true).then((outcome) => outcome === 'merged' && onOpenChange(false))
            }
          >
            Merge anyway as {next}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- History ----

interface HistoryEntry {
  /** What the API resolves: a version (`v2`) or a commit hash. */
  spec: string;
  label: string;
  detail: string;
  /** The full commit message. */
  message: string;
  date: string;
  type: 'draft' | 'version';
  current?: boolean;
}

/** A readable summary of the app's commit messages ("Merge agent x (Name) as v2"). */
function describeCommit(message: string): string {
  if (message.startsWith('Create ')) return 'Created';
  if (/^Merge .* as v\d+$/.test(message)) return 'Merged from the draft';
  if (message.startsWith('Update ')) return 'Saved on main (before versioning)';
  return message;
}

function entriesOf(history: HistoryResponse): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const branch of history.branches) {
    branch.log.forEach((c, i) =>
      entries.push({
        spec: c.hash,
        label: i === 0 ? `${branch.name} (latest save)` : `${branch.name} save`,
        detail: c.hash.slice(0, 7),
        message: c.message,
        date: c.date,
        type: 'draft',
      }),
    );
  }
  history.versions.forEach((v, i) =>
    entries.push({
      spec: v.version,
      label: v.version,
      detail: describeCommit(v.message),
      message: v.message,
      date: v.date,
      type: 'version',
      current: i === 0,
    }),
  );
  return entries;
}

/** The default comparison: draft against main, or the latest version against the one before. */
function defaultPair(entries: HistoryEntry[]): [string, string] | undefined {
  const draft = entries.find((e) => e.type === 'draft');
  const current = entries.find((e) => e.current);
  if (draft && current) return [current.spec, draft.spec];
  const [latest, previous] = entries.filter((e) => e.type === 'version');
  return latest && previous ? [previous.spec, latest.spec] : undefined;
}

function HistorySheet({
  versioning: v,
  open,
  onOpenChange,
}: {
  versioning: Versioning;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = v.id ?? '';
  const draft = draftOf(v.status);
  // Refetch whenever a save, merge or discard changed the version state.
  const stateKey = `${v.kind}/${id}:${v.status?.current ?? ''}:${draft?.head ?? ''}`;
  const history = useFetched(open && v.id ? stateKey : undefined, () => api.history(v.kind, id));
  const entries = history.data ? entriesOf(history.data) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[min(1280px,94vw)]">
        <SheetHeader className="border-b">
          <SheetTitle>History of “{v.name}”</SheetTitle>
          <SheetDescription>
            Versions on main, and saves on the draft that are not merged yet. Pick any two to
            compare them.
          </SheetDescription>
        </SheetHeader>
        {history.error ? (
          <p className="p-4 text-sm text-destructive">{history.error}</p>
        ) : !history.data ? (
          <div className="m-4 flex-1 animate-pulse rounded-lg bg-muted/40" />
        ) : (
          <HistoryBody key={stateKey} versioning={v} entries={entries} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function HistoryBody({
  versioning: v,
  entries,
}: {
  versioning: Versioning;
  entries: HistoryEntry[];
}) {
  const [pair, setPair] = useState(() => defaultPair(entries));
  const [from, to] = pair ?? [];
  const id = v.id ?? '';
  const diff = useFetched(from && to ? `${v.kind}/${id}:${from}..${to}` : undefined, () =>
    api.diff(v.kind, id, from ?? '', to ?? ''),
  );
  const labelOf = (spec: string | undefined) =>
    entries.find((e) => e.spec === spec)?.label ?? spec ?? '';

  const pick = (index: number) => {
    const entry = entries[index];
    const older = entries[index + 1];
    if (entry && older) setPair([older.spec, entry.spec]);
  };

  const draftEntries = entries.filter((e) => e.type === 'draft');
  const versionEntries = entries.filter((e) => e.type === 'version');

  const renderEntry = (entry: HistoryEntry) => {
    const index = entries.indexOf(entry);
    const role = entry.spec === to ? 'to' : entry.spec === from ? 'from' : undefined;
    return (
      <li key={entry.spec}>
        <button
          type="button"
          onClick={() => pick(index)}
          disabled={index === entries.length - 1}
          className={cn(
            'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent',
            role && 'bg-accent/60',
          )}
          title={index === entries.length - 1 ? undefined : 'Compare with the entry below it'}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className={cn('font-medium', entry.type === 'version' && 'font-mono')}>
                {entry.label}
              </span>
              {entry.current && (
                <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[10px]">
                  on main
                </Badge>
              )}
              {role && (
                <Badge
                  variant={role === 'to' ? 'default' : 'outline'}
                  className="ml-auto rounded-md px-1.5 py-0 text-[10px]"
                >
                  {role}
                </Badge>
              )}
            </span>
            <span className="block truncate text-xs text-muted-foreground" title={entry.message}>
              {entry.detail}
            </span>
            <span
              className="block text-xs text-muted-foreground"
              title={formatDateTime(entry.date)}
            >
              {timeAgo(entry.date)}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const select = (value: string | undefined, onChange: (spec: string) => void, label: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-56" aria-label={label}>
        <SelectValue placeholder="Choose…" />
      </SelectTrigger>
      <SelectContent>
        {draftEntries.length > 0 && (
          <SelectGroup>
            <SelectLabel>Draft</SelectLabel>
            {draftEntries.map((e) => (
              <SelectItem key={e.spec} value={e.spec}>
                {e.label} · {e.detail}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>Versions</SelectLabel>
          {versionEntries.map((e) => (
            <SelectItem key={e.spec} value={e.spec}>
              {e.label}
              {e.current ? ' (on main)' : ''}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-72 shrink-0 overflow-y-auto border-r p-2" aria-label="History">
        {draftEntries.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <GitBranch className="size-3" />
              Draft, not merged
            </div>
            <ul className="mb-3 space-y-0.5">{draftEntries.map(renderEntry)}</ul>
          </>
        )}
        <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Versions on main
        </div>
        <ul className="space-y-0.5">{versionEntries.map(renderEntry)}</ul>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        {entries.length < 2 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Only one version so far. Save a change and it shows up here to compare.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Compare</span>
              {select(from, (s) => setPair([s, to ?? s]), 'Compare from')}
              <span className="text-muted-foreground">→</span>
              {select(to, (s) => setPair([from ?? s, s]), 'Compare to')}
            </div>
            {diff.error ? (
              <p className="text-sm text-destructive">{diff.error}</p>
            ) : diff.data ? (
              <FileDiffs
                key={`${from}..${to}`}
                files={diff.data.files}
                fromLabel={labelOf(from)}
                toLabel={labelOf(to)}
                className="min-h-0 flex-1"
              />
            ) : (
              <div className="flex-1 animate-pulse rounded-lg bg-muted/40" />
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ---- List badge ----

/** Shown in lists for entities with saved changes that are not on main yet. */
export function DraftBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0 text-[11px] font-medium text-amber-800">
          <GitBranch className="size-3" />
          draft
        </span>
      </TooltipTrigger>
      <TooltipContent>Has saved changes that are not merged to main yet</TooltipContent>
    </Tooltip>
  );
}
