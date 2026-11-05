import {
  BUILTIN_PATTERN_IDS,
  listSlots,
  patternPorts,
  type EntityInput,
  type Pattern,
} from '@app/schema';
import { ReactFlowProvider } from '@xyflow/react';
import { Plus, Repeat2, Shapes } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { WorkflowEditor } from '@/canvas/workflow-editor';
import { Field } from '@/components/field';
import { NotFound } from '@/components/library-layout';
import { DraftBadge } from '@/components/versioning';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useEditorSource } from '@/hooks/use-entity-editor';
import { ApiError, api } from '@/lib/api';
import { issuesToErrors, type FieldErrors } from '@/lib/validation';
import { useEntities, useLibrary, useVersions } from '@/stores/library';

const BUILTIN_IDS = new Set<string>(Object.values(BUILTIN_PATTERN_IDS));

/** A new pattern: one input port, one slot, one output port, connected. */
function blankPattern(name: string, description: string): EntityInput<'pattern'> {
  const edge = (id: string, source: string, target: string) => ({
    id,
    source: { node: source },
    target: { node: target },
    payload: 'text' as const,
    context: { mode: 'full' as const },
  });
  return {
    name,
    description,
    workflow: {
      nodes: [
        { id: 'in', type: 'input', name: 'Task', payloadType: 'text', content: '', files: [] },
        { id: 'agent', type: 'agent', binding: { kind: 'slot', role: 'Agent', description: '' } },
        { id: 'out', type: 'output', name: 'Result', payloadType: 'text' },
      ],
      edges: [edge('e1', 'in', 'agent'), edge('e2', 'agent', 'out')],
    },
    layout: {
      nodes: { in: { x: 0, y: 0 }, agent: { x: 320, y: 0 }, out: { x: 640, y: 0 } },
      expanded: [],
    },
    repeat: [],
  };
}

/** One line about a pattern's shape: its slots and ports. */
function shapeOf(p: Pattern, all: readonly Pattern[]): string {
  const byId = new Map(all.map((x) => [x.id, x]));
  const slots = listSlots(p, {}, (ref) => byId.get(ref.id) ?? null) ?? [];
  const roles = [...new Set(slots.map((s) => s.role.replace(/ \d+( \(.*\))?$/, '')))];
  const { inputs, outputs } = patternPorts(p);
  const ports = `${String(inputs.length)} in, ${String(outputs.length)} out`;
  return roles.length > 0 ? `${roles.join(', ')} · ${ports}` : ports;
}

export function PatternsPage() {
  const patterns = useEntities('pattern');
  const versions = useVersions('pattern');
  const [creating, setCreating] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 px-8 py-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Patterns</h1>
            <p className="text-sm text-muted-foreground">
              Reusable multi-agent structures. Insert one into a workflow and bind its slots to
              agents.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New pattern
          </Button>
        </header>

        {!patterns ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : patterns.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Shapes className="size-6" />
            </div>
            <p className="mt-4 text-sm font-medium">No patterns</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              A pattern is a reusable group of nodes with ports and slots, such as maker-checker.
            </p>
            <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
              New pattern
            </Button>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Patterns">
            {patterns.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/patterns/${p.id}`}
                  className="flex h-full flex-col rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-foreground/20 hover:bg-accent/40"
                >
                  <div className="flex items-start gap-2">
                    <Shapes className="mt-0.5 size-4 shrink-0 text-violet-700" />
                    <span className="flex-1 font-medium">{p.name}</span>
                    {BUILTIN_IDS.has(p.id) && (
                      <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[11px]">
                        built-in
                      </Badge>
                    )}
                    {versions[p.id]?.version && (
                      <Badge
                        variant="outline"
                        className="rounded-md px-1.5 py-0 font-mono text-[11px]"
                      >
                        {versions[p.id]?.version}
                      </Badge>
                    )}
                    {versions[p.id]?.hasDraft && <DraftBadge />}
                  </div>
                  {p.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                  <div className="mt-auto flex items-center gap-1.5 pt-4 text-xs text-muted-foreground">
                    {p.repeat.length > 0 && <Repeat2 className="size-3.5 shrink-0" />}
                    <span className="truncate">{shapeOf(p, patterns)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          {creating && <NewPatternForm onCancel={() => setCreating(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewPatternForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const upsert = useLibrary((s) => s.upsert);
  const setVersion = useLibrary((s) => s.setVersion);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: 'Give the pattern a name.' });
      return;
    }
    setBusy(true);
    try {
      const res = await api.create('pattern', blankPattern(name.trim(), description));
      upsert('pattern', res.entity);
      setVersion('pattern', res.entity.id, { version: res.status.current, hasDraft: false });
      toast.success(`Created “${res.entity.name}”`);
      void navigate(`/patterns/${res.entity.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(issuesToErrors(err.issues));
      toast.error('Could not create the pattern', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <DialogHeader>
        <DialogTitle>New pattern</DialogTitle>
        <DialogDescription>
          It starts as Input → one slot → Output. Add slots, decisions and repeat groups on the
          canvas.
        </DialogDescription>
      </DialogHeader>
      <Field label="Name" htmlFor="new-pattern-name" error={errors.name}>
        <Input
          id="new-pattern-name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Description" htmlFor="new-pattern-description">
        <Textarea
          id="new-pattern-description"
          value={description}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The pattern canvas; `?branch=` opens a fork made by a project instance. */
export function PatternCanvasRoute() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const branch = params.get('branch') ?? undefined;
  const source = useEditorSource('pattern', id, () => undefined, branch);
  if (source.state === 'notFound') return <NotFound what="pattern" backHref="/patterns" />;
  if (source.state === 'loading') return null;
  return (
    <ReactFlowProvider>
      <WorkflowEditor
        key={`${id ?? ''}@${branch ?? ''}`}
        kind="pattern"
        source={source}
        back={params.get('back') ?? undefined}
      />
    </ReactFlowProvider>
  );
}
