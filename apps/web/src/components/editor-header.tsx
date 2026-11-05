import {
  KIND_PLURALS,
  draftOf,
  type DeleteRequest,
  type DeleteResolution,
  type EntityKind,
  type ReferencedErrorBody,
} from '@app/schema';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
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
import { OutdatedUsers } from '@/components/cascade-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { VersionActions, VersionIndicator } from '@/components/versioning';
import { cn } from '@/lib/utils';
import type { Versioning } from '@/hooks/use-entity-editor';

interface EditorHeaderProps {
  title: string;
  /** Small label above the title, e.g. "Skill" or "New tool preset". */
  eyebrow: string;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  /** Omit for entities that cannot be deleted (e.g. not saved yet). */
  onDelete?: () => Promise<ReferencedErrorBody['references'] | undefined>;
  /**
   * Delete although entities on main still use it (PLAN.md 8.4). Without it, a referenced
   * entity can't be deleted.
   */
  onDeleteWithReferences?: (request: DeleteRequest) => Promise<boolean>;
  children?: React.ReactNode;
  /** Extra controls shown before Delete/Save. */
  actions?: React.ReactNode;
  /** Version badge, branch indicator, history, merge and discard (versioned entities). */
  versioning?: Versioning;
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export function EditorHeader({
  title,
  eyebrow,
  dirty,
  saving,
  onSave,
  onDelete,
  onDeleteWithReferences,
  children,
  actions,
  versioning,
}: EditorHeaderProps) {
  const [confirming, setConfirming] = useState(false);
  const [blockedBy, setBlockedBy] = useState<ReferencedErrorBody['references']>([]);
  const [choices, setChoices] = useState<Record<string, DeleteResolution>>({});
  const [deleting, setDeleting] = useState(false);

  const close = () => {
    setConfirming(false);
    setBlockedBy([]);
    setChoices({});
  };

  /** One row per referencing entity (the 409 lists each pinned version). */
  const users = [...new Map(blockedBy.map((r) => [`${r.kind}/${r.id}`, r])).values()];
  const choiceOf = (key: string): DeleteResolution => choices[key] ?? 'copy';
  const setAll = (resolution: DeleteResolution) =>
    setChoices(Object.fromEntries(users.map((u) => [`${u.kind}/${u.id}`, resolution])));

  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b bg-background/95 px-8 py-3 backdrop-blur">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </div>
        <div className="flex items-center gap-2">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {dirty && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="size-2 shrink-0 rounded-full bg-warning"
                  aria-label="Unsaved changes"
                />
              </TooltipTrigger>
              <TooltipContent>Unsaved changes</TooltipContent>
            </Tooltip>
          )}
          {versioning && <VersionIndicator versioning={versioning} />}
          {versioning?.id && versioning.branch === 'draft' && (
            <OutdatedUsers
              kind={versioning.kind}
              id={versioning.id}
              name={versioning.name}
              version={versioning.status?.current ?? null}
            />
          )}
          {children}
        </div>
      </div>
      {actions}
      {versioning && <VersionActions versioning={versioning} />}
      {onDelete && (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 />
          Delete
        </Button>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" onClick={onSave} disabled={saving || !dirty}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isMac ? '⌘S' : 'Ctrl+S'}</TooltipContent>
      </Tooltip>

      <AlertDialog open={confirming} onOpenChange={(open) => !open && close()}>
        <AlertDialogContent>
          {blockedBy.length === 0 ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  It is removed from the library
                  {versioning && draftOf(versioning.status) ? ', and its draft is discarded' : ''}.
                  Its versions stay in the git history.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={(e) => {
                    e.preventDefault();
                    void onDelete?.().then((refs) => {
                      if (refs && refs.length > 0) setBlockedBy(refs);
                      else close();
                    });
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : !onDeleteWithReferences ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>“{title}” is still in use</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove it from these first, then delete it:
                </AlertDialogDescription>
              </AlertDialogHeader>
              <UserLinks users={users} onNavigate={close} />
              <AlertDialogFooter>
                <AlertDialogCancel>Close</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>“{title}” is still in use</AlertDialogTitle>
                <AlertDialogDescription>
                  Each of these gets a new version without it. Choose what they keep: a local copy
                  keeps them working as they are; a placeholder shows it was deleted and must be
                  replaced before their next merge.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">For all:</span>
                <Button size="xs" variant="outline" onClick={() => setAll('copy')}>
                  Keep local copies
                </Button>
                <Button size="xs" variant="outline" onClick={() => setAll('placeholder')}>
                  Use placeholders
                </Button>
              </div>
              <ul className="max-h-72 space-y-1.5 overflow-auto text-sm" aria-label="Used by">
                {users.map((r) => {
                  const key = `${r.kind}/${r.id}`;
                  return (
                    <li key={key} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate">
                        <Link
                          to={`/${KIND_PLURALS[r.kind as EntityKind]}/${r.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                          onClick={close}
                        >
                          {r.name}
                        </Link>{' '}
                        <span className="text-muted-foreground">({r.kind})</span>
                      </div>
                      <div
                        className="flex overflow-hidden rounded-md border"
                        role="radiogroup"
                        aria-label={`What ${r.name} keeps`}
                      >
                        {(['copy', 'placeholder'] as const).map((res) => (
                          <button
                            key={res}
                            type="button"
                            role="radio"
                            aria-checked={choiceOf(key) === res}
                            className={cn(
                              'px-2 py-0.5 text-xs',
                              choiceOf(key) === res
                                ? 'bg-secondary font-medium'
                                : 'text-muted-foreground hover:bg-accent',
                            )}
                            onClick={() => setChoices((c) => ({ ...c, [key]: res }))}
                          >
                            {res === 'copy' ? 'Local copy' : 'Placeholder'}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={deleting}
                  onClick={(e) => {
                    e.preventDefault();
                    setDeleting(true);
                    const each = Object.fromEntries(
                      users.map((u) => [`${u.kind}/${u.id}`, choiceOf(`${u.kind}/${u.id}`)]),
                    );
                    void onDeleteWithReferences({ each }).then((done) => {
                      setDeleting(false);
                      if (done) close();
                    });
                  }}
                >
                  {deleting && <Loader2 className="animate-spin" />}
                  Delete and update{' '}
                  {users.length === 1 ? '1 user' : `${String(users.length)} users`}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

function UserLinks({
  users,
  onNavigate,
}: {
  users: ReferencedErrorBody['references'];
  onNavigate: () => void;
}) {
  return (
    <ul className="space-y-1 text-sm">
      {users.map((r) => (
        <li key={`${r.kind}/${r.id}`}>
          <Link
            to={`/${KIND_PLURALS[r.kind as EntityKind]}/${r.id}`}
            className="font-medium underline-offset-4 hover:underline"
            onClick={onNavigate}
          >
            {r.name}
          </Link>{' '}
          <span className="text-muted-foreground">({r.kind})</span>
        </li>
      ))}
    </ul>
  );
}
