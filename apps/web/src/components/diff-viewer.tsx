import type { FileDiff } from '@app/schema';
import { FileMinus, FilePlus, FileText } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { cn } from '@/lib/utils';

export interface DiffViewerProps {
  path: string;
  before: string | null;
  after: string | null;
}

const DiffViewerImpl = lazy(() => import('./diff-viewer-impl'));

function FileIcon({ file }: { file: FileDiff }) {
  if (file.before === null) return <FilePlus className="size-3.5 text-success" />;
  if (file.after === null) return <FileMinus className="size-3.5 text-destructive" />;
  return <FileText className="size-3.5 text-muted-foreground" />;
}

/**
 * Side-by-side diff of an entity's files (read-only Monaco), with one tab per changed file.
 * `fromLabel`/`toLabel` name the two sides.
 */
export function FileDiffs({
  files,
  fromLabel,
  toLabel,
  className,
}: {
  files: FileDiff[];
  fromLabel: string;
  toLabel: string;
  className?: string;
}) {
  const [selected, setSelected] = useState(0);
  const file = files[Math.min(selected, files.length - 1)];

  if (!file) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground',
          className,
        )}
      >
        No differences: {fromLabel} and {toLabel} are identical.
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border', className)}>
      <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1.5">
        {files.length > 1 ? (
          <div role="tablist" aria-label="Changed files" className="flex gap-1">
            {files.map((f, i) => (
              <button
                key={f.path}
                type="button"
                role="tab"
                aria-selected={f === file}
                onClick={() => setSelected(i)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs hover:bg-background',
                  f === file && 'bg-background shadow-xs ring-1 ring-border',
                )}
              >
                <FileIcon file={f} />
                {f.path.split('/').pop()}
              </button>
            ))}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-1 font-mono text-xs">
            <FileIcon file={file} />
            {file.path}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 border-b text-xs text-muted-foreground">
        <div className="px-3 py-1">
          <span className="font-medium text-foreground">{fromLabel}</span>
          {file.before === null && ' (no file)'}
        </div>
        <div className="border-l px-3 py-1">
          <span className="font-medium text-foreground">{toLabel}</span>
          {file.after === null && ' (no file)'}
        </div>
      </div>
      <div className="min-h-0 flex-1" data-testid="diff-viewer">
        <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted/40" />}>
          <DiffViewerImpl
            key={file.path}
            path={file.path}
            before={file.before}
            after={file.after}
          />
        </Suspense>
      </div>
    </div>
  );
}
