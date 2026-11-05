/**
 * Inserting a pattern (PLAN.md 7.7): pick it, choose N for its repeat groups, and bind each
 * slot to an agent. In the pattern editor a nested instance's slots stay open (they become the
 * outer pattern's slots), so there is nothing to bind there.
 */
import {
  listSlots,
  patternPorts,
  repeatCount,
  type AgentBinding,
  type Pattern,
  type PatternRef,
  type PatternSlot,
} from '@app/schema';
import { ArrowLeft, Repeat2, Shapes } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useEntities, useVersions } from '@/stores/library';
import type { CanvasKind } from './doc';
import { EnumSelect, OptionalNumber } from './fields';
import { usePatternTree } from './use-pattern-tree';

export interface PatternInsert {
  pattern: PatternRef;
  bindings: Record<string, AgentBinding>;
  repeat: Record<string, number>;
}

const NONE = '__none__';

export function InsertPatternDialog({
  kind,
  open,
  onOpenChange,
  initialPatternId,
  selfId,
  onInsert,
}: {
  kind: CanvasKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Skip the picking step (the pattern was chosen in quick-add). */
  initialPatternId?: string;
  /** The pattern being edited: it can't contain itself. */
  selfId?: string;
  onInsert: (insert: PatternInsert) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {open && (
          <InsertPatternForm
            kind={kind}
            initialPatternId={initialPatternId}
            selfId={selfId}
            onCancel={() => onOpenChange(false)}
            onInsert={(insert) => {
              onInsert(insert);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InsertPatternForm({
  kind,
  initialPatternId,
  selfId,
  onCancel,
  onInsert,
}: {
  kind: CanvasKind;
  initialPatternId?: string;
  selfId?: string;
  onCancel: () => void;
  onInsert: (insert: PatternInsert) => void;
}) {
  const patterns = useEntities('pattern');
  const versions = useVersions('pattern');
  const [chosenId, setChosenId] = useState(initialPatternId);
  const chosen = patterns?.find((p) => p.id === chosenId);

  if (!chosen) {
    const choices = (patterns ?? []).filter((p) => p.id !== selfId);
    return (
      <>
        <DialogHeader>
          <DialogTitle>Insert a pattern</DialogTitle>
          <DialogDescription>
            A reusable group of nodes. You bind its slots to agents next.
          </DialogDescription>
        </DialogHeader>
        <ul
          className="grid max-h-[60vh] gap-2 overflow-y-auto sm:grid-cols-2"
          aria-label="Patterns"
        >
          {choices.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setChosenId(p.id)}
                className="flex h-full w-full flex-col rounded-lg border p-3 text-left transition-colors hover:border-foreground/20 hover:bg-accent/40"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Shapes className="size-4 text-violet-700" />
                  {p.name}
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {versions[p.id]?.version ?? 'v1'}
                  </span>
                </span>
                {p.description && (
                  <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {p.description}
                  </span>
                )}
              </button>
            </li>
          ))}
          {choices.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No patterns yet. Create one in the Patterns tab.
            </li>
          )}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <ConfigureInsert
      key={chosen.id}
      kind={kind}
      pattern={chosen}
      version={versions[chosen.id]?.version ?? 'v1'}
      onBack={initialPatternId ? undefined : () => setChosenId(undefined)}
      onCancel={onCancel}
      onInsert={onInsert}
    />
  );
}

function ConfigureInsert({
  kind,
  pattern,
  version,
  onBack,
  onCancel,
  onInsert,
}: {
  kind: CanvasKind;
  pattern: Pattern;
  version: string;
  onBack?: () => void;
  onCancel: () => void;
  onInsert: (insert: PatternInsert) => void;
}) {
  const ref = useMemo<PatternRef>(
    () => ({ kind: 'pattern', id: pattern.id, version }),
    [pattern.id, version],
  );
  const roots = useMemo(() => [ref], [ref]);
  const tree = usePatternTree(roots);
  const agentVersions = useVersions('agent');
  const pinned = tree.lookup(ref) ?? pattern;
  const [repeat, setRepeat] = useState<Record<string, number>>(() =>
    Object.fromEntries(pinned.repeat.map((g) => [g.id, g.default])),
  );
  const slots = tree.ready ? (listSlots(pinned, repeat, tree.lookup) ?? []) : undefined;
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const agentOf = (s: PatternSlot) => chosen[s.key] ?? s.defaultAgent?.id ?? NONE;
  const { inputs, outputs } = patternPorts(pinned);
  const bindsSlots = kind === 'project';
  const unbound = bindsSlots ? (slots ?? []).filter((s) => agentOf(s) === NONE).length : 0;

  const insert = () => {
    const bindings: Record<string, AgentBinding> = {};
    if (bindsSlots) {
      for (const s of slots ?? []) {
        const id = agentOf(s);
        if (id === NONE) continue;
        // New references pin the agent's current version (as everywhere since M2).
        bindings[s.key] = {
          kind: 'agent',
          agent: { kind: 'agent', id, version: agentVersions[id]?.version ?? 'v1' },
        };
      }
    }
    onInsert({ pattern: ref, bindings, repeat });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {onBack && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Choose another pattern"
              onClick={onBack}
            >
              <ArrowLeft />
            </Button>
          )}
          Insert {pattern.name}
          <span className="font-mono text-xs font-normal text-muted-foreground">{version}</span>
        </DialogTitle>
        <DialogDescription>
          {inputs.length} input port{inputs.length === 1 ? '' : 's'} (
          {inputs.map((p) => p.name).join(', ')}), {outputs.length} output port
          {outputs.length === 1 ? '' : 's'} ({outputs.map((p) => p.name).join(', ')}). Connect to
          its ports on the canvas.
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
        {pinned.repeat.length > 0 && (
          <section className="space-y-2" aria-label="How many">
            <h3 className="text-sm font-semibold">How many</h3>
            {pinned.repeat.map((g) => (
              <label key={g.id} className="flex items-center gap-3 text-sm">
                <Repeat2 className="size-4 text-violet-700" />
                <span className="w-32 truncate">{g.label}</span>
                <OptionalNumber
                  value={repeatCount(g, repeat)}
                  aria-label={`Number of ${g.label}`}
                  className="h-8 w-20"
                  onChange={(n) =>
                    n !== undefined &&
                    setRepeat((r) => ({ ...r, [g.id]: Math.min(g.max, Math.max(g.min, n)) }))
                  }
                />
                <span className="text-xs text-muted-foreground">
                  {g.min}–{g.max}
                  {g.mode === 'chain' ? ', one after another' : ', in parallel'}
                </span>
              </label>
            ))}
          </section>
        )}

        <section className="space-y-2" aria-label="Slots">
          <h3 className="text-sm font-semibold">Slots</h3>
          {!slots ? (
            <p className="text-sm text-muted-foreground">Loading nested patterns…</p>
          ) : !bindsSlots ? (
            <p className="text-sm text-muted-foreground">
              Inside a pattern, the nested pattern’s slots ({slots.map((s) => s.role).join(', ')})
              stay open: they become slots of this pattern, bound when it is used.
            </p>
          ) : (
            <ul className="space-y-2">
              {slots.map((s) => (
                <SlotBindingRow
                  key={s.key}
                  slot={s}
                  value={agentOf(s)}
                  onChange={(id) => setChosen((c) => ({ ...c, [s.key]: id }))}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <DialogFooter className="items-center">
        {unbound > 0 && (
          <span className="mr-auto text-xs text-muted-foreground">
            {unbound} slot{unbound === 1 ? '' : 's'} left unbound: you can bind{' '}
            {unbound === 1 ? 'it' : 'them'} later in the inspector.
          </span>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={insert} disabled={!slots}>
          Insert
        </Button>
      </DialogFooter>
    </>
  );
}

/** One slot: its role and description, and the agent it is bound to. */
export function SlotBindingRow({
  slot,
  value,
  onChange,
  compact,
}: {
  slot: PatternSlot;
  value: string;
  onChange: (agentId: string) => void;
  compact?: boolean;
}) {
  const agents = useEntities('agent');
  return (
    <li
      className={cn(
        'grid items-center gap-x-3 gap-y-1',
        compact ? 'grid-cols-1' : 'sm:grid-cols-2',
      )}
      data-slot={slot.key}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {slot.role}
          {slot.evaluator && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">(decides)</span>
          )}
        </div>
        {slot.description && (
          <div className="line-clamp-2 text-xs text-muted-foreground">{slot.description}</div>
        )}
      </div>
      <EnumSelect
        aria-label={`Agent for ${slot.role}`}
        value={value}
        className={cn(value === NONE && 'text-muted-foreground')}
        options={[
          { value: NONE, label: 'Choose an agent…' },
          ...(agents ?? []).map((a) => ({
            value: a.id,
            label: a.name,
            ...(slot.defaultAgent?.id === a.id ? { description: '(default)' } : {}),
          })),
        ]}
        onChange={onChange}
      />
    </li>
  );
}

export const UNBOUND = NONE;
