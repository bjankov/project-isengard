import {
  describeScope,
  isBranchVersion,
  joinInputs,
  joinLabel,
  listSlots,
  patternPorts,
  repeatCount,
  type AgentRef,
  type WorkflowNode,
  type WorkflowNodeType,
} from '@app/schema';
import {
  Handle,
  NodeResizer,
  Position,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import {
  CircleAlert,
  GitFork as ForkIcon,
  Merge,
  Repeat2,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { modelLabel } from '@/components/agent-defaults';
import { BuiltinIcon } from '@/components/tools';
import { cn } from '@/lib/utils';
import { usePinned } from '@/stores/pinned';
import { useCanvasContext } from './context';
import { NODE_META } from './node-meta';

export type FlowNodeData = { node: WorkflowNode };
export type FlowNode = Node<FlowNodeData>;

const handleClass =
  '!size-2.5 !border-2 !border-background !bg-muted-foreground transition-colors hover:!bg-primary';

function firstLine(text: string | undefined, max = 60): string {
  const line = (text ?? '').split('\n').find((l) => l.trim()) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Problems and join state of a node, for its outline, marker and join chip. */
function useNodeStatus(id: string) {
  const { graph, loops, check } = useCanvasContext();
  const node = graph.nodes.find((n) => n.id === id);
  const inputs = joinInputs(graph, id, loops).length;
  const severity = check.nodes.get(id);
  const messages = check.problems.filter((p) => p.nodes[0] === id).map((p) => p.message);
  const join = inputs > 1 ? (node?.join ? joinLabel(node.join, inputs) : null) : undefined;
  return { severity, messages, join, inputs };
}

/** Red (error) or amber (warning) marker in a node's corner, with the messages as a tooltip. */
function ProblemMarker({ id }: { id: string }) {
  const { severity, messages } = useNodeStatus(id);
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
function JoinChip({ id }: { id: string }) {
  const { join, inputs } = useNodeStatus(id);
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
  const { severity } = useNodeStatus(id);
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
      <ProblemMarker id={id} />
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
        <JoinChip id={id} />
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
  const { overrides, settings, tools } = useCanvasContext();
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
      type="agent"
      selected={selected}
      title={n.label || (agent?.name ?? (pinned.state === 'missing' ? 'Missing agent' : ref.id))}
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
  const { tools } = useCanvasContext();
  if (n.type !== 'toolStep') return null;
  const preset = tools?.find((t) => t.id === n.tool.id);
  const args = Object.values(n.args).filter(Boolean).join(' ');
  return (
    <Card
      id={id}
      type="toolStep"
      selected={selected}
      title={n.label || (preset?.name ?? n.tool.id)}
      subtitle={args ? <span className="font-mono">{args}</span> : 'Tool step'}
      badges={
        preset && (
          <Chip>
            <BuiltinIcon id={preset.builtin} className="size-3" />
            {preset.builtin}
          </Chip>
        )
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
  const { severity, join } = useNodeStatus(id);
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
          <ProblemMarker id={id} />
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
          {join !== undefined && (
            <span className="mt-0.5">
              <JoinChip id={id} />
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
function PatternNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  const { kind, check } = useCanvasContext();
  const ref = n.type === 'pattern' ? n.pattern : undefined;
  const pinned = usePinned('pattern', ref?.id, ref?.version);
  const { severity } = useNodeStatus(id);
  if (n.type !== 'pattern' || !ref) return null;
  const pattern = pinned.state === 'ready' ? pinned.entity : undefined;
  const ports = pattern ? patternPorts(pattern) : { inputs: [], outputs: [] };
  const slots = pattern
    ? (listSlots(pattern, n.repeat, check.resolver.pattern ?? (() => undefined)) ?? [])
    : [];
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
      <ProblemMarker id={id} />
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
              (pattern?.name ?? (pinned.state === 'missing' ? 'Missing pattern' : ref.id))}
          </div>
          <div className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
            {kind === 'pattern' && n.label && pattern ? pattern.name : 'Pattern'}
          </div>
        </div>
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
        {kind === 'project' && slots.length > 0 && (
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

export const nodeTypes: NodeTypes = {
  'wf-input': InputNodeView,
  'wf-output': OutputNodeView,
  'wf-agent': AgentNodeView,
  'wf-decision': DecisionNodeView,
  'wf-artifact': ArtifactNodeView,
  'wf-toolStep': ToolStepNodeView,
  'wf-humanInput': HumanInputNodeView,
  'wf-sharedStore': SharedStoreNodeView,
  'wf-note': NoteNodeView,
  'wf-pattern': PatternNodeView,
};
