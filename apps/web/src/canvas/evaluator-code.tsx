import type { Evaluator, EvaluatorLanguage } from '@app/schema';
import { FileCode2, FolderOpen, Maximize2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { CodeEditor } from '@/components/code-editor';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { EnumSelect } from './fields';

type Deterministic = Extract<Evaluator, { type: 'deterministic' }>;

/** File extensions per evaluator language. Python only in v1 (PLAN.md 7.4). */
const LANGUAGES: Record<EvaluatorLanguage, { label: string; extensions: string[] }> = {
  python: { label: 'Python', extensions: ['.py'] },
};

const MAX_FILE_BYTES = 256 * 1024;

const PLACEHOLDER = `import json, sys

report = sys.stdin.read()
if "FAILED" in report:
    print(json.dumps({"notes": "some tests failed"}))
    sys.exit(1)  # second exit
sys.exit(0)  # first exit`;

export const CONTRACT_HINT =
  'Runs in v2, never in this version. It receives the decision’s input on stdin. Exit code 0 takes the first exit, any other code the second. Optional JSON on stdout adds notes ({"notes": …}) or picks an exit by label ({"exit": …}).';

/**
 * The code of a deterministic evaluator: a Monaco editor with a language selector, plus
 * loading a file by drag and drop or a file picker. Nothing is ever run.
 */
export function EvaluatorCode({
  evaluator: ev,
  onChange,
  error,
}: {
  evaluator: Deterministic;
  onChange: (next: Deterministic, key: string) => void;
  error?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const lang = LANGUAGES[ev.language];

  const load = async (file: File | undefined) => {
    if (!file) return;
    const ok = lang.extensions.some((x) => file.name.toLowerCase().endsWith(x));
    if (!ok) {
      toast.error(`“${file.name}” is not a ${lang.label} file`, {
        description: `Only ${lang.extensions.join(', ')} files can be used in this version.`,
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error(`“${file.name}” is too large`, { description: 'The limit is 256 KB.' });
      return;
    }
    const code = await file.text();
    onChange({ ...ev, code, sourceFileName: file.name }, 'code-file');
    toast.success(`Loaded ${file.name}`, {
      description: 'Undo with Ctrl/Cmd+Z on the canvas if that was a mistake.',
    });
  };

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const editor = (height: number) => (
    <CodeEditor
      value={ev.code}
      onChange={(code) => onChange({ ...ev, code }, 'code')}
      language="python"
      height={height}
      placeholder={PLACEHOLDER}
      ariaLabel="Evaluator code"
    />
  );

  return (
    <Field label="Code" hint={CONTRACT_HINT} error={error}>
      <div className="flex items-center gap-2">
        <EnumSelect
          id="node-code-language"
          aria-label="Language"
          className="h-8 w-28"
          value={ev.language}
          options={Object.entries(LANGUAGES).map(([value, l]) => ({
            value: value as EvaluatorLanguage,
            label: l.label,
          }))}
          onChange={(language) => onChange({ ...ev, language }, 'language')}
        />
        <Button variant="outline" size="sm" onClick={() => picker.current?.click()}>
          <FolderOpen />
          Load file…
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Expand the code editor"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 />
        </Button>
        <input
          ref={picker}
          type="file"
          accept={lang.extensions.join(',')}
          className="hidden"
          data-testid="evaluator-file"
          onChange={(e) => {
            void load(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {/* Capture phase: Monaco would otherwise take the drop and insert the file's path. */}
      <div
        className="relative"
        data-testid="evaluator-drop"
        onDragEnterCapture={(e) => hasFiles(e) && setDragging(true)}
        onDragOverCapture={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeaveCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDropCapture={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          void load(e.dataTransfer.files[0]);
        }}
      >
        {editor(220)}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-background/85 text-sm font-medium text-primary opacity-0 transition-opacity',
            dragging && 'opacity-100',
          )}
        >
          <Upload className="mr-2 size-4" />
          Drop a {lang.extensions.join(', ')} file to use its code
        </div>
      </div>
      {ev.sourceFileName && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileCode2 className="size-3.5" />
          Loaded from <span className="font-mono">{ev.sourceFileName}</span>
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-0.5 hover:text-foreground"
            onClick={() => onChange({ ...ev, sourceFileName: undefined }, 'code-file')}
            aria-label="Forget the file name"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Evaluator code ({lang.label})</DialogTitle>
            <DialogDescription>{CONTRACT_HINT}</DialogDescription>
          </DialogHeader>
          {expanded && editor(Math.round(window.innerHeight * 0.6))}
        </DialogContent>
      </Dialog>
    </Field>
  );
}
