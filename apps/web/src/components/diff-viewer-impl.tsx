import { DiffEditor } from '@monaco-editor/react';
import type { editor } from 'monaco-editor/editor/editor.api';
import { useEffect, useRef } from 'react';
import '@/lib/monaco-setup';
import { useTheme } from '@/stores/theme';
import type { DiffViewerProps } from './diff-viewer';

function languageOf(path: string): string {
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.py')) return 'python';
  return 'plaintext';
}

export default function DiffViewerImpl({ path, before, after }: DiffViewerProps) {
  // @monaco-editor/react disposes the models before the diff widget, which makes Monaco throw
  // on unmount. Keep the models and dispose them after the widget is gone instead.
  const models = useRef<editor.IDiffEditorModel | null>(null);
  const dark = useTheme((s) => s.resolved === 'dark');
  useEffect(
    () => () => {
      const m = models.current;
      if (m) {
        setTimeout(() => {
          m.original.dispose();
          m.modified.dispose();
        });
      }
    },
    [],
  );

  return (
    <DiffEditor
      theme={dark ? 'app-dark' : 'app-light'}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(e) => {
        models.current = e.getModel();
      }}
      original={before ?? ''}
      modified={after ?? ''}
      language={languageOf(path)}
      height="100%"
      loading={<div className="h-full w-full animate-pulse bg-muted/40" />}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: true,
        minimap: { enabled: false },
        wordWrap: 'on',
        diffWordWrap: 'on',
        lineNumbersMinChars: 3,
        folding: false,
        fontSize: 13,
        lineHeight: 20,
        scrollBeyondLastLine: false,
        renderLineHighlight: 'none',
        renderOverviewRuler: false,
        automaticLayout: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      }}
    />
  );
}
