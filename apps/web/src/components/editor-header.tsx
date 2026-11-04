import { KIND_PLURALS, type EntityKind, type ReferencedErrorBody } from '@app/schema';
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
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface EditorHeaderProps {
  title: string;
  /** Small label above the title, e.g. "Skill" or "New tool preset". */
  eyebrow: string;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  /** Omit for entities that cannot be deleted (e.g. not saved yet). */
  onDelete?: () => Promise<ReferencedErrorBody['references'] | undefined>;
  children?: React.ReactNode;
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export function EditorHeader({
  title,
  eyebrow,
  dirty,
  saving,
  onSave,
  onDelete,
  children,
}: EditorHeaderProps) {
  const [confirming, setConfirming] = useState(false);
  const [blockedBy, setBlockedBy] = useState<ReferencedErrorBody['references']>([]);

  const close = () => {
    setConfirming(false);
    setBlockedBy([]);
  };

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
          {children}
        </div>
      </div>
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
                  It is removed from the library. Its history stays in git.
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
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>“{title}” is still in use</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove it from these first, then delete it:
                </AlertDialogDescription>
              </AlertDialogHeader>
              <ul className="space-y-1 text-sm">
                {blockedBy.map((r) => (
                  <li key={`${r.kind}/${r.id}`}>
                    <Link
                      to={`/${KIND_PLURALS[r.kind as EntityKind]}/${r.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                      onClick={close}
                    >
                      {r.name}
                    </Link>{' '}
                    <span className="text-muted-foreground">({r.kind})</span>
                  </li>
                ))}
              </ul>
              <AlertDialogFooter>
                <AlertDialogCancel>Close</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
