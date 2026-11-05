/**
 * Inspector parts that only exist in the pattern editor: the pattern itself (with its repeat
 * groups), slots, and a node's repeat group.
 */
import {
  analyzeLoops,
  forkBranchName,
  isBranchVersion,
  listSlots,
  newLocalId,
  patternPorts,
  portInputs,
  repeatCount,
  type AgentBinding,
  type JoinMode,
  type RepeatGroup,
  type WorkflowNode,
} from '@app/schema';
import { useMemo, useState } from 'react';
import { ExternalLink, GitFork, Plus, Repeat2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PromoteFork } from '@/components/promote-fork';
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
import { ApiError, api } from '@/lib/api';
import { Link } from 'react-router';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { FieldErrors } from '@/lib/validation';
import { useEntities, useVersions } from '@/stores/library';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { nodeTitle, updateNode, type CanvasKind, type Change, type WorkflowDoc } from './doc';
import { SlotBindingRow, UNBOUND } from './insert-pattern';
import { usePatternTree } from './use-pattern-tree';
import { EnumSelect, OptionalNumber } from './fields';

type SlotBinding = Extract<AgentBinding, { kind: 'slot' }>;

const NONE = '__none__';

/** Role, description and optional default agent of a slot (agent node or evaluator). */
export function SlotFields({
  slot,
  onChange,
  idPrefix = 'slot',
  roleLabel = 'Role',
}: {
  slot: SlotBinding;
  onChange: (slot: SlotBinding, key: string) => void;
  idPrefix?: string;
  roleLabel?: string;
}) {
  const agents = useEntities('agent');
  const versions = useVersions('agent');
  return (
    <section
      className="space-y-4 rounded-lg border border-dashed border-sky-300 p-3"
      aria-label="Slot"
    >
      <p className="text-xs text-muted-foreground">
        A slot is a role. Whoever inserts the pattern binds it to an agent.
      </p>
      <Field label={roleLabel} htmlFor={`${idPrefix}-role`} hint="E.g. “Maker” or “Reviewer”.">
        <Input
          id={`${idPrefix}-role`}
          value={slot.role}
          onChange={(e) => onChange({ ...slot, role: e.target.value }, 'role')}
        />
      </Field>
      <Field
        label="What this role does"
        htmlFor={`${idPrefix}-description`}
        hint="Shown when binding the slot, to help pick the right agent."
      >
        <Textarea
          id={`${idPrefix}-description`}
          value={slot.description}
          rows={3}
          onChange={(e) => onChange({ ...slot, description: e.target.value }, 'description')}
        />
      </Field>
      <Field
        label="Default agent"
        htmlFor={`${idPrefix}-default`}
        hint="Optional. Pre-selected when the pattern is inserted."
      >
        <EnumSelect
          id={`${idPrefix}-default`}
          value={slot.defaultAgent?.id ?? NONE}
          options={[
            { value: NONE, label: 'None' },
            ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
          ]}
          onChange={(id) => {
            const { defaultAgent: _old, ...rest } = slot;
            onChange(
              id === NONE
                ? rest
                : {
                    ...rest,
                    defaultAgent: { kind: 'agent', id, version: versions[id]?.version ?? 'v1' },
                  },
              'default',
            );
          }}
        />
      </Field>
    </section>
  );
}

/** Node types that can't be repeated: ports and notes exist once. */
const NOT_REPEATABLE = new Set<WorkflowNode['type']>(['input', 'output', 'note']);

const NEW_GROUP = '__new__';

/** Which repeat group a node belongs to ("Worker 1…N", PLAN.md 10). */
export function RepeatField({
  node,
  doc,
  change,
}: {
  node: WorkflowNode;
  doc: WorkflowDoc;
  change: Change;
}) {
  if (NOT_REPEATABLE.has(node.type)) return null;
  const current = doc.repeat.find((g) => g.nodes.includes(node.id));
  const setGroup = (groupId: string) =>
    change((d) => {
      // Leave the current group (dropping it when it becomes empty), then join the new one.
      let repeat = d.repeat
        .map((g) => ({ ...g, nodes: g.nodes.filter((id) => id !== node.id) }))
        .filter((g) => g.nodes.length > 0);
      if (groupId === NEW_GROUP) {
        const label = `${nodeTitle(node)}s`;
        repeat = [
          ...repeat,
          {
            id: newLocalId(
              'group',
              repeat.map((g) => g.id),
            ),
            label,
            nodes: [node.id],
            mode: 'parallel',
            min: 1,
            max: 9,
            default: 2,
          },
        ];
      } else if (groupId !== NONE) {
        repeat = repeat.map((g) => (g.id === groupId ? { ...g, nodes: [...g.nodes, node.id] } : g));
      }
      return { ...d, repeat };
    }, `node:${node.id}:repeat`);

  return (
    <Field
      label="Repeat"
      htmlFor="node-repeat"
      hint={
        current
          ? `Copied ${String(current.min)}–${String(current.max)} times when the pattern is used; set the group up in the pattern panel (click the empty canvas).`
          : 'Make this node one of N copies, e.g. Worker 1…N. The inserter chooses N.'
      }
    >
      <EnumSelect
        id="node-repeat"
        value={current?.id ?? NONE}
        options={[
          { value: NONE, label: 'Exists once' },
          ...doc.repeat.map((g) => ({ value: g.id, label: `Repeated as “${g.label}”` })),
          { value: NEW_GROUP, label: 'New repeat group…' },
        ]}
        onChange={setGroup}
      />
    </Field>
  );
}

/** One repeat group's settings in the pattern panel. */
function RepeatGroupEditor({
  group,
  doc,
  change,
}: {
  group: RepeatGroup;
  doc: WorkflowDoc;
  change: Change;
}) {
  const set = (patch: Partial<RepeatGroup>, key: string) =>
    change(
      (d) => ({ ...d, repeat: d.repeat.map((g) => (g.id === group.id ? { ...g, ...patch } : g)) }),
      `repeat:${group.id}:${key}`,
    );
  const members = group.nodes
    .map((id) => doc.workflow.nodes.find((n) => n.id === id))
    .filter((n): n is WorkflowNode => !!n);
  const rangeError =
    group.min > group.default || group.default > group.max
      ? 'Needs min ≤ default ≤ max.'
      : undefined;
  return (
    <li className="space-y-3 rounded-lg border p-3" aria-label={`Repeat group ${group.label}`}>
      <div className="flex items-center gap-2">
        <Repeat2 className="size-4 shrink-0 text-violet-700" />
        <Input
          value={group.label}
          aria-label="Group name"
          className="h-8"
          onChange={(e) => set({ label: e.target.value }, 'label')}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove group ${group.label}`}
          onClick={() =>
            change((d) => ({ ...d, repeat: d.repeat.filter((g) => g.id !== group.id) }))
          }
        >
          <Trash2 />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {members.length === 0
          ? 'No nodes yet.'
          : `Repeats ${members.map((n) => nodeTitle(n)).join(', ')}.`}
      </p>
      <EnumSelect
        aria-label="How copies run"
        value={group.mode}
        options={[
          {
            value: 'parallel',
            label: 'In parallel',
            description: 'every copy gets the same input (workers, members, branches)',
          },
          {
            value: 'chain',
            label: 'One after another',
            description: 'each copy works on the previous one’s output (pipeline steps)',
          },
        ]}
        onChange={(mode) => set({ mode }, 'mode')}
      />
      <div className="grid grid-cols-3 gap-2 text-xs">
        {(['min', 'default', 'max'] as const).map((k) => (
          <label key={k} className="space-y-1">
            <span className="text-muted-foreground">
              {k === 'default' ? 'Default' : k === 'min' ? 'Min' : 'Max'}
            </span>
            <OptionalNumber
              value={group[k]}
              aria-label={`${group.label} ${k}`}
              className="h-8"
              onChange={(v) => v !== undefined && v > 0 && set({ [k]: v }, k)}
            />
          </label>
        ))}
      </div>
      {rangeError && <p className="text-xs text-destructive">{rangeError}</p>}
    </li>
  );
}

/** The pattern panel (nothing selected): name, description and repeat groups. */
export function PatternPanelFields({
  doc,
  change,
  errors,
}: {
  doc: WorkflowDoc;
  change: Change;
  errors: FieldErrors;
}) {
  const counts = doc.workflow.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  const ports = (counts.input ?? 0) + (counts.output ?? 0);
  const slots = doc.workflow.nodes.filter(
    (n) =>
      (n.type === 'agent' && n.binding.kind === 'slot') ||
      (n.type === 'decision' && n.evaluator.type === 'agent' && n.evaluator.agent.kind === 'slot'),
  ).length;
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      <Field label="Name" htmlFor="pattern-name" error={errors.name}>
        <Input
          id="pattern-name"
          value={doc.name}
          onChange={(e) => change((d) => ({ ...d, name: e.target.value }), 'pattern:name')}
        />
      </Field>
      <Field label="Description" htmlFor="pattern-description">
        <Textarea
          id="pattern-description"
          value={doc.description}
          rows={3}
          onChange={(e) =>
            change((d) => ({ ...d, description: e.target.value }), 'pattern:description')
          }
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        {ports} port{ports === 1 ? '' : 's'} (Input and Output nodes), {slots} slot
        {slots === 1 ? '' : 's'}, {doc.workflow.nodes.length} nodes in all
        {counts.pattern
          ? `, ${String(counts.pattern)} nested pattern${counts.pattern === 1 ? '' : 's'}`
          : ''}
        .
      </p>
      <section className="space-y-2" aria-label="Repeat groups">
        <h3 className="text-sm font-semibold">Repeat groups</h3>
        <p className="text-xs text-muted-foreground">
          Nodes the pattern’s user can have N of. Add a node to a group from its{' '}
          <span className="font-medium">Repeat</span> field.
        </p>
        {doc.repeat.length > 0 ? (
          <ul className="space-y-2">
            {doc.repeat.map((g) => (
              <RepeatGroupEditor key={g.id} group={g} doc={doc} change={change} />
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-1.5 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <Plus className="size-3.5" />
            None yet. Select a slot (or any node but a port or note) and choose “New repeat group…”
            in its Repeat field.
          </p>
        )}
      </section>
    </div>
  );
}

/** A pattern instance: what it pins, how many copies, its slot bindings and port joins. */
export function PatternInstanceFields({
  node,
  doc,
  change,
  changeAndSave,
  dirty,
  kind,
  entityId,
}: {
  node: Extract<WorkflowNode, { type: 'pattern' }>;
  doc: WorkflowDoc;
  change: Change;
  changeAndSave: Change;
  dirty: boolean;
  kind: CanvasKind;
  /** The project (or pattern) containing the instance; forks are named after it. */
  entityId: string;
}) {
  const roots = useMemo(() => [node.pattern], [node.pattern]);
  const tree = usePatternTree(roots);
  const agentVersions = useVersions('agent');
  const pattern = tree.lookup(node.pattern);
  const slots = pattern && tree.ready ? listSlots(pattern, node.repeat, tree.lookup) : undefined;
  const set = (fn: (n: typeof node) => typeof node, key: string) =>
    change(
      (d) => updateNode(d, node.id, (n) => (n.type === 'pattern' ? fn(n) : n)),
      `node:${node.id}:${key}`,
    );

  /** Change N; bindings of copies that no longer exist are dropped. */
  const setCount = (groupId: string, count: number) =>
    set((n) => {
      const repeat = { ...n.repeat, [groupId]: count };
      const keys = pattern ? listSlots(pattern, repeat, tree.lookup)?.map((x) => x.key) : undefined;
      const bindings = keys
        ? Object.fromEntries(Object.entries(n.bindings).filter(([k]) => keys.includes(k)))
        : n.bindings;
      return { ...n, repeat, bindings };
    }, `repeat:${groupId}`);

  const bind = (key: string, agentId: string) =>
    set((n) => {
      if (agentId === UNBOUND) {
        const { [key]: _removed, ...rest } = n.bindings;
        return { ...n, bindings: rest };
      }
      const agent = {
        kind: 'agent' as const,
        id: agentId,
        version: agentVersions[agentId]?.version ?? 'v1',
      };
      return { ...n, bindings: { ...n.bindings, [key]: { kind: 'agent', agent } } };
    }, `bind:${key}`);

  const patternVersions = useVersions('pattern');
  const libraryName = useEntities('pattern')?.find((p) => p.id === node.pattern.id)?.name;
  const forked = isBranchVersion(node.pattern.version);
  const latest = patternVersions[node.pattern.id]?.version ?? undefined;
  const [confirmFork, setConfirmFork] = useState(false);
  const [forking, setForking] = useState(false);

  /** Pin another version (or another pattern), keeping bindings, counts and port joins. */
  const pin = (version: string, id = node.pattern.id, apply: Change = change) =>
    apply((d) =>
      updateNode(d, node.id, (n) =>
        n.type === 'pattern' ? { ...n, pattern: { kind: 'pattern', id, version } } : n,
      ),
    );

  const fork = async () => {
    if (!entityId) return;
    setForking(true);
    const branch = forkBranchName(entityId, node.id);
    try {
      await api.createBranch('pattern', node.pattern.id, branch, node.pattern.version);
    } catch (err) {
      // Re-forking a node whose fork branch still exists: pin it again.
      if (!(err instanceof ApiError && /already exists/.test(err.message))) {
        toast.error('Could not fork the pattern', {
          description: err instanceof Error ? err.message : String(err),
        });
        setForking(false);
        return;
      }
    }
    pin(branch);
    setForking(false);
    setConfirmFork(false);
    toast.success('Forked for this node', {
      description: 'Save, then use “Edit fork” to change what is inside.',
    });
  };
  const back = `/${kind === 'project' ? 'projects' : 'patterns'}/${entityId}`;

  const loops = analyzeLoops(doc.workflow);
  const joinedPorts = pattern
    ? patternPorts(pattern).inputs.map((port) => ({
        port,
        inputs: portInputs(doc.workflow, node.id, port.id, loops).length,
      }))
    : [];

  return (
    <>
      <section className="space-y-2 rounded-lg border p-3" aria-label="Pattern">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {pattern?.name ?? (pattern === null ? 'Missing pattern' : node.pattern.id)}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{node.pattern.version}</div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/patterns/${node.pattern.id}`}>
              <ExternalLink />
              Open
            </Link>
          </Button>
        </div>
        {pattern?.description && (
          <p className="text-xs text-muted-foreground">{pattern.description}</p>
        )}
        {forked ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link
                  to={`/patterns/${node.pattern.id}?branch=${encodeURIComponent(node.pattern.version)}&back=${encodeURIComponent(back)}`}
                >
                  <GitFork />
                  Edit fork
                </Link>
              </Button>
              {latest && (
                <Button size="sm" variant="ghost" onClick={() => pin(latest)}>
                  Use library version ({latest})
                </Button>
              )}
            </div>
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Promote the fork: make it the library pattern’s next version, or a new pattern.
              </p>
              <PromoteFork
                kind="pattern"
                id={node.pattern.id}
                branch={node.pattern.version}
                name={libraryName ?? pattern?.name ?? node.pattern.id}
                disabledReason={dirty ? 'Save first: promoting saves.' : undefined}
                onPromoted={(to) => pin(to.version, to.id, changeAndSave)}
              />
            </div>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={!pattern || !entityId}
            onClick={() => setConfirmFork(true)}
          >
            <GitFork />
            Customize for this {kind === 'project' ? 'project' : 'pattern'}
          </Button>
        )}
      </section>

      <AlertDialog open={confirmFork} onOpenChange={setConfirmFork}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fork “{pattern?.name}” for this node?</AlertDialogTitle>
            <AlertDialogDescription>
              This node gets its own branch of the pattern, starting from {node.pattern.version}.
              You can then change what is inside without affecting the library pattern or other
              users of it. The node is marked as modified. Slot bindings and counts are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={forking}
              onClick={(e) => {
                e.preventDefault();
                void fork();
              }}
            >
              Fork pattern
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pattern && pattern.repeat.length > 0 && (
        <Field
          label="How many"
          hint="Changing a count keeps the bindings of the copies that remain."
        >
          <div className="space-y-2">
            {pattern.repeat.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <Repeat2 className="size-4 shrink-0 text-violet-700" />
                <span className="w-28 truncate">{g.label}</span>
                <OptionalNumber
                  value={repeatCount(g, node.repeat)}
                  aria-label={`Number of ${g.label}`}
                  className="h-8 w-16"
                  onChange={(v) =>
                    v !== undefined && setCount(g.id, Math.min(g.max, Math.max(g.min, v)))
                  }
                />
                <span className="text-xs text-muted-foreground">
                  {g.min}–{g.max}
                </span>
              </label>
            ))}
          </div>
        </Field>
      )}

      {joinedPorts
        .filter((p) => p.inputs > 1)
        .map(({ port, inputs }) => (
          <PortJoinField
            key={port.id}
            name={port.name}
            inputs={inputs}
            join={node.portJoins[port.id]}
            onChange={(join) =>
              set(
                (n) => ({ ...n, portJoins: { ...n.portJoins, [port.id]: join } }),
                `join:${port.id}`,
              )
            }
          />
        ))}

      {kind === 'project' ? (
        <Field
          label="Slots"
          hint="Who fills each role. Changing a binding never forks the pattern."
        >
          {!slots ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">This pattern has no slots.</p>
          ) : (
            <ul className="space-y-3" aria-label="Slot bindings">
              {slots.map((slot) => {
                const b = node.bindings[slot.key];
                return (
                  <SlotBindingRow
                    key={slot.key}
                    slot={slot}
                    compact
                    value={b?.kind === 'agent' ? b.agent.id : UNBOUND}
                    onChange={(id) => bind(slot.key, id)}
                  />
                );
              })}
            </ul>
          )}
        </Field>
      ) : (
        slots &&
        slots.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Its slots ({slots.map((x) => x.role).join(', ')}) are slots of this pattern too, bound
            when this pattern is used.
          </p>
        )
      )}
    </>
  );
}

/** How an input port with several incoming edges waits for them. */
function PortJoinField({
  name,
  inputs,
  join,
  onChange,
}: {
  name: string;
  inputs: number;
  join: JoinMode | undefined;
  onChange: (join: JoinMode) => void;
}) {
  return (
    <Field label={`Join at “${name}”`} hint={`${String(inputs)} inputs arrive at this port.`}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={join?.mode ?? ''}
        onValueChange={(v) => {
          if (v === 'all' || v === 'any') onChange({ mode: v });
          else if (v === 'n-of-m') onChange({ mode: 'n-of-m', n: Math.min(2, inputs) });
        }}
        aria-label={`Join mode at ${name}`}
      >
        <ToggleGroupItem value="all">Wait for all</ToggleGroupItem>
        <ToggleGroupItem value="any">Any one</ToggleGroupItem>
        <ToggleGroupItem value="n-of-m">Some</ToggleGroupItem>
      </ToggleGroup>
      {join?.mode === 'n-of-m' && (
        <div className="flex items-center gap-2 text-sm">
          Proceed when
          <OptionalNumber
            value={join.n}
            className="h-8 w-16"
            aria-label="Inputs needed"
            onChange={(n) => n !== undefined && onChange({ mode: 'n-of-m', n })}
          />
          of {inputs} inputs arrived
        </div>
      )}
      {!join && <p className="text-xs text-destructive">Choose how this port waits.</p>}
    </Field>
  );
}
