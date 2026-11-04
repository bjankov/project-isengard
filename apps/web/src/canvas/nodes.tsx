import {
  describeScope,
  isBranchVersion,
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
import { GitFork as ForkIcon, ShieldAlert } from 'lucide-react';
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

function Card({
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
  return (
    <div
      className={cn(
        'w-56 rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow',
        selected && 'ring-2 ring-primary ring-offset-1',
        className,
      )}
      data-node-type={type}
    >
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
      {badges && <div className="flex flex-wrap gap-1 px-2.5 pb-2">{badges}</div>}
      {children}
      {outHandle && <Handle type="source" position={Position.Right} className={handleClass} />}
    </div>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
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

function InputNodeView({ data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'input') return null;
  return (
    <Card
      type="input"
      selected={selected}
      inHandle={false}
      title={n.label || n.name}
      subtitle={firstLine(n.content) || 'Input'}
      badges={<Chip>{n.payloadType}</Chip>}
    />
  );
}

function OutputNodeView({ data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'output') return null;
  return (
    <Card
      type="output"
      selected={selected}
      outHandle={false}
      title={n.label || n.name}
      subtitle="Output"
      badges={<Chip>{n.payloadType}</Chip>}
    />
  );
}

function AgentNodeView({ id, data, selected }: NodeProps<FlowNode>) {
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

function ArtifactNodeView({ data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'artifact') return null;
  return (
    <Card
      type="artifact"
      selected={selected}
      className="rounded-tr-2xl border-dashed"
      title={<span className="font-mono text-[13px]">{n.label || n.path}</span>}
      subtitle={n.label ? n.path : 'Artifact'}
      badges={<Chip>{n.fileType}</Chip>}
    />
  );
}

function ToolStepNodeView({ data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  const { tools } = useCanvasContext();
  if (n.type !== 'toolStep') return null;
  const preset = tools?.find((t) => t.id === n.tool.id);
  const args = Object.values(n.args).filter(Boolean).join(' ');
  return (
    <Card
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

function HumanInputNodeView({ data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'humanInput') return null;
  return (
    <Card
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

function SharedStoreNodeView({ data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'sharedStore') return null;
  return (
    <Card
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

function DecisionNodeView({ data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  if (n.type !== 'decision') return null;
  const evaluator =
    n.evaluator.type === 'deterministic'
      ? 'code'
      : n.evaluator.type === 'agent'
        ? 'agent'
        : 'human';
  return (
    <div className="flex items-center" data-node-type="decision">
      <div className="relative size-28 shrink-0">
        <Handle type="target" position={Position.Left} className={handleClass} />
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible">
          <polygon
            points="50,2 98,50 50,98 2,50"
            className={cn(
              'fill-amber-50 stroke-amber-300 transition-all',
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
};
