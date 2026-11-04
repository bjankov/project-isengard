import type { WorkspaceCheck } from '@app/schema';
import { CircleAlert, CircleCheck, FolderGit2, Folder, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import { Input } from '@/components/ui/input';
import { useFetched } from '@/hooks/use-fetched';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** `value`, updated only after it stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Workspace folder path with live validation (must be a git repo root), folder suggestions
 * while typing, and an offer to run `git init` (after confirmation).
 */
export function WorkspaceField({
  id,
  value,
  onChange,
  onCheck,
  error,
}: {
  id: string;
  value: string;
  onChange: (path: string) => void;
  /** Called with the latest check result (undefined while checking). */
  onCheck?: (check: WorkspaceCheck | undefined) => void;
  error?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [confirmInit, setConfirmInit] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const typed = useDebounced(value, 250);
  const check = useFetched(typed.trim() ? `${typed}#${nonce}` : undefined, () =>
    api.checkWorkspace(typed),
  );
  const suggestions = useFetched(focused ? `suggest:${typed}` : undefined, () =>
    api.suggestWorkspaces(typed || '~/'),
  );
  const result = typed === value ? check.data : undefined;

  useEffect(() => {
    onCheck?.(result);
  }, [result, onCheck]);

  const items = (suggestions.data?.items ?? []).filter((i) => i.path !== value);

  const init = async () => {
    if (!result) return;
    setInitializing(true);
    try {
      const after = await api.initWorkspace(result.path);
      if (after.status === 'ok')
        toast.success('Initialized a git repo', { description: after.path });
      setNonce((n) => n + 1);
    } catch (err) {
      toast.error('git init failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setInitializing(false);
      setConfirmInit(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="~/code/my-app"
          className="font-mono text-sm"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error || (result && result.status !== 'ok')}
        />
        {focused && items.length > 0 && (
          <ul
            className="absolute top-full right-0 left-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
            role="listbox"
            aria-label="Folder suggestions"
          >
            {items.map((item) => (
              <li key={item.path}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-xs hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange(`${item.path}/`)}
                >
                  {item.isGitRepo ? (
                    <FolderGit2 className="size-3.5 shrink-0 text-success" />
                  ) : (
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{item.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-h-5 text-xs" data-testid="workspace-status">
        {!value.trim() ? (
          <span className="text-muted-foreground">
            The git repo of the product this workflow works on. The app only stores its path.
          </span>
        ) : !result ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Checking…
          </span>
        ) : result.status === 'ok' ? (
          <span className="inline-flex items-center gap-1 text-success">
            <CircleCheck className="size-3.5" /> Git repo
          </span>
        ) : (
          <span
            className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-destructive')}
          >
            <span className="inline-flex items-center gap-1">
              <CircleAlert className="size-3.5 shrink-0" />
              {result.message}
            </span>
            {result.status === 'not-a-repo' && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setConfirmInit(true)}
              >
                Initialize git here
              </Button>
            )}
            {result.status === 'inside-repo' && result.repoRoot && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => onChange(result.repoRoot ?? value)}
              >
                Use {result.repoRoot}
              </Button>
            )}
          </span>
        )}
        {error && result?.status === 'ok' && <p className="text-destructive">{error}</p>}
      </div>

      <AlertDialog open={confirmInit} onOpenChange={setConfirmInit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run git init in this folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a <code>.git</code> folder in{' '}
              <span className="font-mono">{result?.path}</span>. Nothing else in the folder is
              touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={initializing}
              onClick={(e) => {
                e.preventDefault();
                void init();
              }}
            >
              Run git init
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
