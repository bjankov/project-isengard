import { lazy, Suspense } from 'react';
import { cn } from '@/lib/utils';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: 'markdown' | 'python' | 'yaml';
  height?: number;
  placeholder?: string;
  ariaLabel?: string;
}

const CodeEditorImpl = lazy(() => import('./code-editor-impl'));

/** Monaco editor, loaded lazily so the rest of the app does not wait for it. */
export function CodeEditor({ className, ...props }: CodeEditorProps & { className?: string }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        className,
      )}
      style={{ height: props.height ?? 360 }}
    >
      <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted/40" />}>
        <CodeEditorImpl {...props} />
      </Suspense>
    </div>
  );
}
