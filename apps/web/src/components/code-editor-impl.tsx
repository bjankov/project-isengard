import Editor from '@monaco-editor/react';
import '@/lib/monaco-setup';
import type { CodeEditorProps } from './code-editor';

export default function CodeEditorImpl({
  value,
  onChange,
  language,
  height = 360,
  placeholder,
  ariaLabel,
}: CodeEditorProps) {
  return (
    <Editor
      value={value}
      language={language}
      height={height}
      onChange={(v) => onChange(v ?? '')}
      loading={<div className="h-full w-full animate-pulse bg-muted/40" />}
      options={{
        ariaLabel,
        placeholder,
        minimap: { enabled: false },
        wordWrap: language === 'markdown' ? 'on' : 'off',
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        folding: false,
        fontSize: 13,
        lineHeight: 20,
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'none',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        automaticLayout: true,
        tabSize: 2,
        quickSuggestions: false,
        wordBasedSuggestions: 'off',
      }}
    />
  );
}
