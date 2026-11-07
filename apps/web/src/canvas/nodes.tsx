import {
  describeScope,
  isBranchVersion,
  listSlots,
  patternPorts,
  repeatCount,
  type AgentRef,
  type WorkflowNode,
  type WorkflowNodeType,
} from '@app/schema';
import { memo } from 'react';
import {
  Handle,
  NodeResizer,
  Position,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import {
  Archive,
  CircleAlert,
  GitFork as ForkIcon,
  Maximize2,
  Merge,
  Minimize2,
  Repeat2,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { modelLabel } from '@/components/agent-defaults';
import { BuiltinIcon } from '@/components/tools';
import { UpdateAvailable } from '@/components/update-available';
import { cn } from '@/lib/utils';
import { usePinned } from '@/stores/pinned';
import { useCanvasContext } from './context';
import { NODE_META } from './node-meta';
import { NO_STATUS, type NodeStatus } from './node-status';

export type FlowNodeData = {
  node: WorkflowNode;
  /** Inside an expanded pattern frame: read-only, not part of the edited graph. */
  inner?: boolean;
  /** How far an expanded frame has opened (animation), 0..1. */
  open?: number;
  /** The box an expanded frame draws now; it grows inside the node while animating. */
  box?: { width: number; height: number };
  /** Problems and joins, computed once per change by the editor (see `nodeStatuses`). */
  status?: NodeStatus;
};
export type FlowNode = Node<FlowNodeData>;

const handleClass =
  '!size-2.5 !border-2 !border-background !bg-muted-foreground transition-colors hover:!bg-primary';

function firstLine(text: string | undefined, max = 60): string {
  const line = (text ?? '').split('\n').find((l) => l.trim()) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Red (error) or amber (warning) marker in a node's corner, with the messages as a tooltip. */
function ProblemMarker({ status }: { status: NodeStatus }) {
  const { severity, messages } = status;
  if (!severity) return null;
  const Icon = severity === 'error' ? CircleAlert : TriangleAlert;
  return (
    <span
      className={cn(
        'absolute -top-2 -right-2 z-10 flex size-5 items-center justify-center rounded-full border-2 border-background',
        severity === 'error' ? 'bg-destructive text-white' : 'bg-amber-400 text-amber-950',
      )}
      title={messages.join('\n')}
      data-problem-marker={severity}
    >
      <Icon className="size-3" />
    </span>
  );
}

/** How a node with several inputs waits for them; red when not chosen yet. */
function JoinChip({ status }: { status: NodeStatus }) {
  const { join, inputs } = status;
  if (join === undefined) return null;
  return (
    <Chip
      className={cn(join === null && 'bg-destructive/10 text-destructive')}
      title={
        join === null
          ? `${inputs} inputs: choose how this waits for them`
          : `Waits for ${join} of its ${inputs} inputs`
      }
    >
      <Merge className="size-3 rotate-90" />
      {join === null ? 'join?' : `join ${join}`}
    </Chip>
  );
}

/** In a pattern: the repeat group a node belongs to, and how many copies it makes by default. */
function RepeatChip({ id }: { id: string }) {
  const { kind, repeat } = useCanvasContext();
  const group = kind === 'pattern' ? repeat.find((g) => g.nodes.includes(id)) : undefined;
  if (!group) return null;
  return (
    <Chip
      className="bg-violet-100 text-violet-800"
      title={`Repeated as “${group.label}”: ${String(group.min)}–${String(group.max)} copies, ${String(group.default)} by default${group.mode === 'chain' ? ', one after another' : ', in parallel'}`}
    >
      <Repeat2 className="size-3" />×{repeatCount(group)} {group.label}
    </Chip>
  );
}

/** In a pattern, Input and Output nodes are its ports. */
function PortChip() {
  const { kind } = useCanvasContext();
  return kind === 'pattern' ? <Chip className="bg-emerald-100 text-emerald-800">port</Chip> : null;
}

const problemOutline = {
  error: 'outline-2 outline-offset-2 outline-destructive/70',
  warning: 'outline-2 outline-offset-2 outline-amber-400/80',
} as const;

function Card({
  id,
  type,
  selected,
  status,
  title,
  subtitle,
  badges,
  inHandle = true,
  outHandle = true,
  className,
  children,
}: {
  id: string;
  type: WorkflowNodeType;
  selected: boolean;
  status: NodeStatus;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  inHandle?: boolean;
  outHandle?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const meta = NODE_META[type];
  const Icon = meta.icon;
  const { severity } = status;
  return (
    <div
      className={cn(
        'relative w-56 rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow',
        selected && 'ring-2 ring-primary ring-offset-1',
        severity && problemOutline[severity],
        className,
      )}
      data-node-type={type}
      data-problem={severity}
    >
      <ProblemMarker status={status} />
      {inHandle && <Handle type="target" position={Position.Left} className={handleClass} />}
      <div className="flex items-start gap-2 p-2.5">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border',
            meta.accent,
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-tight font-medium">{title}</div>
          {subtitle && (
            <div className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 px-2.5 pb-2 empty:hidden">
        {badges}
        <RepeatChip id={id} />
        <JoinChip status={status} />
      </div>
      {children}
      {outHandle && <Handle type="source" position={Position.Right} className={handleClass} />}
    </div>
  );
}

function Chip({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---- Node types ----

function InputNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'input') return null;
  return (
    <Card
      id={id}
      status={data.status ?? NO_STATUS}
      type="input"
      selected={selected}
      inHandle={false}
      title={n.label || n.name}
      subtitle={firstLine(n.content) || 'Input'}
      badges={
        <>
          <PortChip />
          <Chip>{n.payloadType}</Chip>
        </>
      }
    />
  );
}

function OutputNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'output') return null;
  return (
    <Card
      id={id}
      status={data.status ?? NO_STATUS}
      type="output"
      selected={selected}
      outHandle={false}
      title={n.label || n.name}
      subtitle="Output"
      badges={
        <>
          <PortChip />
          <Chip>{n.payloadType}</Chip>
        </>
      }
    />
  );
}

/** Chips for a pinned entity that was deleted: kept as a local copy, or a placeholder. */
function LocalChip({ pinned }: { pinned: { state: string; local?: true; deleted?: string } }) {
  if (pinned.state === 'ready' && pinned.local) {
    return (
      <Chip
        className="bg-stone-200 text-stone-800"
        title="Deleted from the library; this workflow keeps a local copy"
      >
        <Archive className="size-3" />
        local copy
      </Chip>
    );
  }
  if (pinned.state === 'missing') {
    return <Chip className="bg-destructive/10 text-destructive">deleted</Chip>;
  }
  return null;
}

/** "Missing agent", or the placeholder's last known name. */
function missingTitle(noun: string, pinned: { state: string; deleted?: string }): string {
  return pinned.deleted ? `Deleted: ${pinned.deleted}` : `Missing ${noun}`;
}

/** The name of an agent at a pinned version, for slot defaults. */
function useAgentName(ref: AgentRef | undefined): string | undefined {
  const pinned = usePinned('agent', ref?.id, ref?.version);
  return pinned.state === 'ready' ? pinned.entity.name : undefined;
}

/** A slot: a role in a pattern, bound to an agent when the pattern is inserted. */
function SlotNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  const binding = n.type === 'agent' && n.binding.kind === 'slot' ? n.binding : undefined;
  const defaultName = useAgentName(binding?.defaultAgent);
  if (!binding) return null;
  return (
    <Card
      id={id}
      status={data.status ?? NO_STATUS}
      type="agent"
      selected={selected}
      className="border-dashed border-sky-300"
      title={n.label || binding.role}
      subtitle={
        binding.defaultAgent
          ? `Default: ${defaultName ?? binding.defaultAgent.id}`
          : firstLine(binding.description) || 'Slot'
      }
      badges={<Chip className="bg-sky-100 text-sky-800">slot</Chip>}
    />
  );
}

function AgentNodeView(props: NodeProps<FlowNode>) {
  const n = props.data.node;
  if (n.type === 'agent' && n.binding.kind === 'slot') return <SlotNodeView {...props} />;
  return <BoundAgentNodeView {...props} />;
}

function BoundAgentNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  const { overrides, settings, tools, repin } = useCanvasContext();
  const ref = n.type === 'agent' && n.binding.kind === 'agent' ? n.binding.agent : undefined;
  const pinned = usePinned('agent', ref?.id, ref?.version);
  if (n.type !== 'agent' || !ref) return null;
  const agent = pinned.state === 'ready' ? pinned.entity : undefined;
  const override = overrides[id];
  const model = override?.model ?? agent?.defaults.model;
  const forked = isBranchVersion(ref.version);
  const unrestricted = (agent?.tools ?? []).some((t) => {
    const preset = tools?.find((p) => p.id === t.id);
    return preset ? describeScope(preset).unrestricted : false;
  });
  return (
    <Card
      id={id}
      status={data.status ?? NO_STATUS}
      type="agent"
      selected={selected}
      title={
        n.label ||
        (agent?.name ?? (pinned.state === 'missing' ? missingTitle('agent', pinned) : ref.id))
      }
      subtitle={model ? modelLabel(model, settings?.models ?? []) : undefined}
      className={cn(pinned.state === 'missing' && 'border-destructive')}
      badges={
        <>
          {forked ? (
            <Chip className="bg-violet-100 text-violet-800">
              <ForkIcon className="size-3" />
              modified
            </Chip>
          ) : (
            <Chip className="font-mono">{ref.version}</Chip>
          )}
          <LocalChip pinned={pinned} />
          {!data.inner && (
            <UpdateAvailable
              kind="agent"
              id={ref.id}
              version={ref.version}
              name={agent?.name ?? ref.id}
              missing={pinned.state === 'missing'}
              onUpdate={(to) => repin(`node/${id}`, to)}
            />
          )}
          {override && Object.keys(override).length > 0 && <Chip>overrides</Chip>}
          {unrestricted && (
            <Chip className="bg-destructive/10 text-destructive">
              <ShieldAlert className="size-3" />
              unrestricted shell
            </Chip>
          )}
        </>
      }
    />
  );
}

function ArtifactNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'artifact') return null;
  return (
    <Card
      id={id}
      status={data.status ?? NO_STATUS}
      type="artifact"
      selected={selected}
      className="rounded-tr-2xl border-dashed"
      title={<span className="font-mono text-[13px]">{n.label || n.path}</span>}
      subtitle={n.label ? n.path : 'Artifact'}
      badges={<Chip>{n.fileType}</Chip>}
    />
  );
}

function ToolStepNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  const { repin } = useCanvasContext();
  const ref = n.type === 'toolStep' ? n.tool : undefined;
  const pinned = usePinned('tool', ref?.id, ref?.version);
  if (n.type !== 'toolStep') return null;
  const preset = pinned.state === 'ready' ? pinned.entity : undefined;
  const args = Object.values(n.args).filter(Boolean).join(' ');
  return (
    <Card
      id={id}
      status={data.status ?? NO_STATUS}
      type="toolStep"
      selected={selected}
      title={
        n.label ||
        (preset?.name ??
          (pinned.state === 'missing' ? missingTitle('tool preset', pinned) : n.tool.id))
      }
      subtitle={args ? <span className="font-mono">{args}</span> : 'Tool step'}
      className={cn(pinned.state === 'missing' && 'border-destructive')}
      badges={
        <>
          {preset && (
            <Chip>
              <BuiltinIcon id={preset.builtin} className="size-3" />
              {preset.builtin}
            </Chip>
          )}
          <LocalChip pinned={pinned} />
          {!data.inner && (
            <UpdateAvailable
              kind="tool"
              id={n.tool.id}
              version={n.tool.version}
              name={preset?.name ?? n.tool.id}
              onUpdate={(to) => repin(`node/${id}`, to)}
            />
          )}
        </>
      }
    />
  );
}

function HumanInputNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'humanInput') return null;
  return (
    <Card
      id={id}
      status={data.status ?? NO_STATUS}
      type="humanInput"
      selected={selected}
      title={n.label || 'Human input'}
      subtitle={firstLine(n.instructions) || 'A person provides input'}
      badges={
        n.fields.length > 0 && (
          <Chip>
            {n.fields.length} field{n.fields.length === 1 ? '' : 's'}
          </Chip>
        )
      }
    />
  );
}

function SharedStoreNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'sharedStore') return null;
  return (
    <Card
      id={id}
      status={data.status ?? NO_STATUS}
      type="sharedStore"
      selected={selected}
      className="border-double border-4"
      title={n.label || n.name}
      subtitle="Shared store"
      badges={<Chip>{n.format}</Chip>}
    />
  );
}

function NoteNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'note') return null;
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={60}
        lineClassName="!border-yellow-400"
        handleClassName="!size-2 !bg-yellow-400"
      />
      <div
        className={cn(
          'h-full w-full overflow-hidden rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm whitespace-pre-wrap text-yellow-950 shadow-sm',
          selected && 'ring-2 ring-yellow-400',
        )}
        data-node-type="note"
        data-id={id}
      >
        {n.text || <span className="text-yellow-700/60">Empty note</span>}
      </div>
    </>
  );
}

function DecisionNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  const status = data.status ?? NO_STATUS;
  const { severity, join } = status;
  const { repin } = useCanvasContext();
  const evaluatorRef =
    n.type === 'decision' && n.evaluator.type === 'agent' && n.evaluator.agent.kind === 'agent'
      ? n.evaluator.agent.agent
      : undefined;
  const evaluatorName = useAgentName(evaluatorRef);
  if (n.type !== 'decision') return null;
  const evaluator =
    n.evaluator.type === 'deterministic'
      ? 'code'
      : n.evaluator.type === 'agent'
        ? 'agent'
        : 'human';
  return (
    <div className="flex items-center" data-node-type="decision" data-problem={severity}>
      <div className="relative size-28 shrink-0">
        <span className="absolute top-2 right-2">
          <ProblemMarker status={status} />
        </span>
        <Handle type="target" position={Position.Left} className={handleClass} />
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible">
          <polygon
            points="50,2 98,50 50,98 2,50"
            className={cn(
              'fill-amber-50 stroke-amber-300 transition-all',
              severity === 'error' && 'stroke-destructive',
              severity === 'warning' && 'stroke-amber-500',
              selected && 'stroke-primary',
            )}
            strokeWidth={selected ? 3 : 1.5}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
          <span className="line-clamp-2 text-xs leading-tight font-medium">
            {n.label || 'Decision'}
          </span>
          <span className="mt-0.5 text-[10px] text-amber-800">{evaluator}</span>
          {evaluatorRef && !data.inner && (
            <UpdateAvailable
              kind="agent"
              id={evaluatorRef.id}
              version={evaluatorRef.version}
              name={evaluatorName ?? evaluatorRef.id}
              className="mt-0.5"
              onUpdate={(to) => repin(`node/${id}/evaluator`, to)}
            />
          )}
          {join !== undefined && (
            <span className="mt-0.5">
              <JoinChip status={status} />
            </span>
          )}
        </div>
      </div>
      <div className="-ml-3 flex flex-col gap-1.5">
        {n.exits.map((x) => (
          <div
            key={x.id}
            className="relative rounded-md border border-amber-200 bg-card py-0.5 pr-3 pl-2 text-xs shadow-xs"
            data-exit={x.id}
          >
            {x.label}
            {x.maxIterations !== undefined && (
              <span className="ml-1 text-[10px] text-muted-foreground">≤{x.maxIterations}</span>
            )}
            <Handle type="source" id={x.id} position={Position.Right} className={handleClass} />
          </div>
        ))}
        {n.exits.length === 0 && (
          <span className="rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
            no exits
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A pattern instance, collapsed: its name and version, a handle per port (inputs left, outputs
 * right), and how many of its slots are bound.
 */
/** Expand or collapse a pattern instance. */
function ExpandButton({ path, open }: { path: string; open: boolean }) {
  const { toggleExpanded } = useCanvasContext();
  const Icon = open ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      className="nodrag flex size-6 shrink-0 items-center justify-center rounded-md text-violet-800 transition-colors hover:bg-violet-200/70"
      aria-label={open ? 'Collapse pattern' : 'Expand pattern'}
      title={open ? 'Collapse' : 'Expand to see inside'}
      onClick={(e) => {
        e.stopPropagation();
        toggleExpanded(path);
      }}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function PatternNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  const { kind, patterns, repin } = useCanvasContext();
  const ref = n.type === 'pattern' ? n.pattern : undefined;
  const pinned = usePinned('pattern', ref?.id, ref?.version);
  const status = data.status ?? NO_STATUS;
  const { severity } = status;
  if (n.type !== 'pattern' || !ref) return null;
  const pattern = pinned.state === 'ready' ? pinned.entity : undefined;
  // Until the pattern arrives, give the ports its edges use a handle, so they stay attached.
  const used = (ids: string[] = []) => ids.map((port) => ({ id: port, name: '…' }));
  const ports = pattern
    ? patternPorts(pattern)
    : { inputs: used(status.usedPorts?.inputs), outputs: used(status.usedPorts?.outputs) };
  const slots = pattern ? (listSlots(pattern, n.repeat, patterns ?? (() => undefined)) ?? []) : [];
  const bound = slots.filter((s) => n.bindings[s.key]?.kind === 'agent').length;
  const forked = isBranchVersion(ref.version);
  const rows = Math.max(ports.inputs.length, ports.outputs.length, 1);
  return (
    <div
      className={cn(
        'relative w-64 rounded-xl border-2 border-violet-300 bg-violet-50/60 text-card-foreground shadow-sm',
        selected && 'ring-2 ring-primary ring-offset-1',
        severity && problemOutline[severity],
        pinned.state === 'missing' && 'border-destructive',
      )}
      data-node-type="pattern"
      data-problem={severity}
    >
      <ProblemMarker status={status} />
      <div className="flex items-start gap-2 p-2.5">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border',
            NODE_META.pattern.accent,
          )}
        >
          <NodeIcon type="pattern" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-tight font-medium">
            {n.label ||
              (pattern?.name ??
                (pinned.state === 'missing' ? missingTitle('pattern', pinned) : ref.id))}
          </div>
          <div className="mt-0.5 flex items-center gap-1 truncate text-xs leading-tight text-muted-foreground">
            {kind === 'pattern' && n.label && pattern ? pattern.name : 'Pattern'}
            <LocalChip pinned={pinned} />
            {!data.inner && (
              <UpdateAvailable
                kind="pattern"
                id={ref.id}
                version={ref.version}
                name={pattern?.name ?? ref.id}
                missing={pinned.state === 'missing'}
                onUpdate={(to) => repin(`node/${id}`, to)}
              />
            )}
          </div>
        </div>
        {pattern && <ExpandButton path={id} open={false} />}
      </div>
      <div className="relative grid grid-cols-2 gap-x-2 px-0 pb-2 text-[11px]">
        {Array.from({ length: rows }, (_, i) => {
          const input = ports.inputs[i];
          const output = ports.outputs[i];
          return (
            <div key={i} className="contents">
              <div className="relative flex h-6 items-center pl-3 text-muted-foreground">
                {input && (
                  <>
                    <Handle
                      type="target"
                      id={input.id}
                      position={Position.Left}
                      className={handleClass}
                    />
                    <span className="truncate" data-port={input.id}>
                      {input.name}
                    </span>
                    {(status.portInputs?.[input.id] ?? 0) > 1 && (
                      <span
                        className={cn(
                          'ml-1 shrink-0 rounded px-1 text-[10px]',
                          n.portJoins[input.id]
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-destructive/10 text-destructive',
                        )}
                        title="Several inputs arrive at this port"
                      >
                        {n.portJoins[input.id]?.mode ?? 'join?'}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="relative flex h-6 items-center justify-end pr-3 text-muted-foreground">
                {output && (
                  <>
                    <span className="truncate" data-port={output.id}>
                      {output.name}
                    </span>
                    <Handle
                      type="source"
                      id={output.id}
                      position={Position.Right}
                      className={handleClass}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1 border-t border-violet-200 px-2.5 py-2">
        {forked ? (
          <Chip className="bg-violet-100 text-violet-800">
            <ForkIcon className="size-3" />
            modified
          </Chip>
        ) : (
          <Chip className="font-mono">{ref.version}</Chip>
        )}
        {kind !== 'pattern' && !data.inner && slots.length > 0 && (
          <Chip
            className={cn(bound < slots.length && 'bg-destructive/10 text-destructive')}
            title={slots.map((s) => s.role).join(', ')}
          >
            {bound}/{slots.length} slots bound
          </Chip>
        )}
        <RepeatChip id={id} />
      </div>
    </div>
  );
}

/**
 * An expanded pattern instance: a frame around its nodes (separate React Flow nodes inside
 * it), with its ports as pills on the left and right edges.
 */
function PatternFrameView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  const ref = n.type === 'pattern' ? n.pattern : undefined;
  const pinned = usePinned('pattern', ref?.id, ref?.version);
  const status = data.status ?? NO_STATUS;
  const { severity } = status;
  if (n.type !== 'pattern' || !ref) return null;
  const pattern = pinned.state === 'ready' ? pinned.entity : undefined;
  const forked = isBranchVersion(ref.version);
  const box = data.box;
  return (
    <div
      className={cn(
        'absolute top-0 left-0 rounded-2xl border-2 border-violet-300 bg-violet-50/40 shadow-sm',
        selected && 'ring-2 ring-primary ring-offset-1',
        severity && problemOutline[severity],
        data.inner && 'bg-violet-100/40',
      )}
      style={box ? { width: box.width, height: box.height } : { width: '100%', height: '100%' }}
      data-node-type="pattern"
      data-expanded="true"
      data-problem={severity}
    >
      <ProblemMarker status={status} />
      <div className="flex items-center gap-2 px-3 pt-2.5" style={{ opacity: data.open ?? 1 }}>
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md border',
            NODE_META.pattern.accent,
          )}
        >
          <NodeIcon type="pattern" />
        </span>
        <span className="truncate text-sm font-medium">{n.label || pattern?.name}</span>
        {forked ? (
          <Chip className="bg-violet-100 text-violet-800">
            <ForkIcon className="size-3" />
            modified
          </Chip>
        ) : (
          <Chip className="font-mono">{ref.version}</Chip>
        )}
        <RepeatChip id={id} />
        <span className="ml-auto" />
        {!data.inner && <span className="text-[10px] text-muted-foreground">read-only inside</span>}
        <ExpandButton path={id} open />
      </div>
    </div>
  );
}

/** A pattern's Input or Output, drawn as a pill on the edge of its expanded frame. */
function PortNodeView({ data }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'input' && n.type !== 'output') return null;
  return (
    <div
      className="flex h-8 w-28 items-center justify-center gap-1 rounded-full border-2 border-emerald-300 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-900 shadow-xs"
      data-node-type="port"
      data-port-direction={n.type === 'input' ? 'in' : 'out'}
    >
      <Handle type="target" position={Position.Left} className={handleClass} />
      <NodeIcon type={n.type} />
      <span className="truncate">{n.name}</span>
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

function NodeIcon({ type }: { type: WorkflowNodeType }) {
  const Icon = NODE_META[type].icon;
  return <Icon className="size-4" />;
}

/**
 * React Flow node type of a workflow node. Prefixed so React Flow's built-in `input` and
 * `output` node styles never apply.
 */
export function flowNodeType(type: WorkflowNodeType): string {
  return `wf-${type}`;
}

/**
 * Memoized: the editor keeps a node's props (and `data`) identical while nothing about it
 * changed, so dragging or editing one node doesn't re-render the others.
 */
export const nodeTypes: NodeTypes = {
  'wf-input': memo(InputNodeView),
  'wf-output': memo(OutputNodeView),
  'wf-agent': memo(AgentNodeView),
  'wf-decision': memo(DecisionNodeView),
  'wf-artifact': memo(ArtifactNodeView),
  'wf-toolStep': memo(ToolStepNodeView),
  'wf-humanInput': memo(HumanInputNodeView),
  'wf-sharedStore': memo(SharedStoreNodeView),
  'wf-note': memo(NoteNodeView),
  'wf-pattern': memo(PatternNodeView),
  'wf-pattern-frame': memo(PatternFrameView),
  'wf-port': memo(PortNodeView),
};
