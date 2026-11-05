/**
 * Update notifications (PLAN.md 8.3): an instance pinned to an older main version shows a
 * small "v2 → v4" badge. Clicking it shows what changed (the merge notes in between, and the
 * diff) and updates this one instance. Nothing updates by itself.
 */
import {
  isBranchVersion,
  isOutdated,
  versionNumber,
  type EntityKind,
  type VersionInfo,
} from '@app/schema';
import { ArrowUpCircle, GitCompare, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { FileDiffs } from '@/components/diff-viewer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFetched } from '@/hooks/use-fetched';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useEntities, useVersions } from '@/stores/library';

/** The version an instance could move to, if it is behind (or pins a fork that is gone). */
export function useUpdate(
  kind: EntityKind,
  id: string | undefined,
  version: string | undefined,
  /** The pinned version can't be found (e.g. a fork branch that was deleted). */
  missing = false,
): { to: string; reason: 'outdated' | 'missing-fork' } | undefined {
  useEntities(kind); // loads the version state
  const current = useVersions(kind)[id ?? '']?.version ?? undefined;
  if (!id || !version || !current) return undefined;
  if (isOutdated(version, current)) return { to: current, reason: 'outdated' };
  if (missing && isBranchVersion(version)) return { to: current, reason: 'missing-fork' };
  return undefined;
}

/** Merge notes of the versions after `from`, up to `to`, newest first. */
function changesBetween(versions: VersionInfo[], from: string, to: string): VersionInfo[] {
  const lo = versionNumber(from) ?? 0;
  const hi = versionNumber(to) ?? 0;
  return versions.filter((v) => {
    const n = versionNumber(v.version) ?? 0;
    return n > lo && n <= hi;
  });
}

export function UpdateAvailable({
  kind,
  id,
  version,
  name,
  missing,
  onUpdate,
  className,
}: {
  kind: EntityKind;
  id: string;
  version: string;
  /** The entity's name, for the popover. */
  name: string;
  missing?: boolean;
  /** Pin this instance to `to`. Undefined: show the badge without an update action. */
  onUpdate?: (to: string) => void;
  className?: string;
}) {
  const update = useUpdate(kind, id, version, missing);
  const [open, setOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const history = useFetched(
    open && update?.reason === 'outdated' ? `${kind}/${id}` : undefined,
    () => api.history(kind, id),
  );
  const diff = useFetched(
    comparing && update ? `${kind}/${id}:${version}..${update.to}` : undefined,
    () => api.diff(kind, id, version, update?.to ?? version),
  );
  if (!update) return null;
  const changes = history.data ? changesBetween(history.data.versions, version, update.to) : [];

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'nodrag inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-100 px-1.5 py-px text-[11px] font-medium text-sky-800 hover:bg-sky-200',
              className,
            )}
            title={`Update available: ${version} → ${update.to}`}
            aria-label={`Update available: ${version} → ${update.to}`}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <ArrowUpCircle className="size-3" />
            {update.reason === 'missing-fork'
              ? `fork gone → ${update.to}`
              : `${version} → ${update.to}`}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-3" onClick={(e) => e.stopPropagation()}>
          <div>
            <p className="text-sm font-semibold">
              {update.reason === 'missing-fork' ? 'Its fork no longer exists' : 'Update available'}
            </p>
            <p className="text-xs text-muted-foreground">
              {update.reason === 'missing-fork'
                ? `This instance pinned a fork of “${name}” that was promoted or deleted. Pin the library version (${update.to}) instead.`
                : `This instance pins “${name}” ${version}; the library has ${update.to}. Nothing changes until you update it.`}
            </p>
          </div>
          {update.reason === 'outdated' && (
            <div className="space-y-1">
              <p className="text-xs font-medium">What changed</p>
              {history.loading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <ul className="max-h-40 space-y-1.5 overflow-auto text-xs" aria-label="Changes">
                  {changes.map((v) => (
                    <li key={v.version}>
                      <span className="font-mono font-medium">{v.version}</span>{' '}
                      <span className="text-muted-foreground">{formatDateTime(v.date)}</span>
                      <div>{v.note ?? v.message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {update.reason === 'outdated' && (
              <Button size="xs" variant="outline" onClick={() => setComparing(true)}>
                <GitCompare />
                Compare
              </Button>
            )}
            {onUpdate && (
              <Button
                size="xs"
                onClick={() => {
                  onUpdate(update.to);
                  setOpen(false);
                }}
              >
                <ArrowUpCircle />
                {update.reason === 'missing-fork' ? `Use ${update.to}` : `Update to ${update.to}`}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={comparing} onOpenChange={setComparing}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {name}: {version} → {update.to}
            </DialogTitle>
            <DialogDescription>The stored files of both versions.</DialogDescription>
          </DialogHeader>
          {diff.data ? (
            <FileDiffs files={diff.data.files} fromLabel={version} toLabel={update.to} />
          ) : (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
