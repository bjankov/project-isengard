import {
  CANVAS_NODE_TYPES,
  NODE_TYPE_INFO,
  type CanvasNodeType,
  type NodeNeeds,
} from '@app/schema';
import { BuiltinIcon } from '@/components/tools';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Kbd } from './kbd';
import { useEntities, useVersions } from '@/stores/library';
import { cn } from '@/lib/utils';
import type { CanvasKind } from './doc';
import { NODE_META } from './node-meta';

export const NODE_DRAG_TYPE = 'application/x-workflow-node';

/**
 * Whether a node type needs a library entity picked first. In a pattern, agent nodes are
 * slots: they start empty (an agent can be picked as the slot's default in quick-add).
 */
export function needsPick(kind: CanvasKind, type: CanvasNodeType): 'agent' | 'tool' | undefined {
  if (type === 'toolStep') return 'tool';
  if (type === 'agent' && kind === 'project') return 'agent';
  return undefined;
}

/** Palette label and description of a node type; agents are "Slots" in a pattern. */
export function nodeTypeInfo(kind: CanvasKind, type: CanvasNodeType) {
  if (kind === 'pattern' && type === 'agent') {
    return {
      label: 'Slot',
      description: 'A role (e.g. “Maker”) bound to an agent when the pattern is inserted.',
    };
  }
  if (kind === 'pattern' && type === 'input') {
    return { label: 'Input', description: 'An input port: where work comes into the pattern.' };
  }
  if (kind === 'pattern' && type === 'output') {
    return { label: 'Output', description: 'An output port: where results leave the pattern.' };
  }
  return NODE_TYPE_INFO[type];
}

/** Left sidebar: drag a node type onto the canvas, or click to add it. */
export function Palette({
  kind,
  onPick,
}: {
  kind: CanvasKind;
  onPick: (type: CanvasNodeType) => void;
}) {
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r bg-muted/30" aria-label="Node palette">
      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        Add node
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {CANVAS_NODE_TYPES.map((type) => {
          const meta = NODE_META[type];
          const Icon = meta.icon;
          return (
            <li key={type}>
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(NODE_DRAG_TYPE, type);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => onPick(type)}
                title={nodeTypeInfo(kind, type).description}
                className="flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent active:cursor-grabbing"
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded border',
                    meta.accent,
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                {nodeTypeInfo(kind, type).label}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="border-t p-3 text-xs text-muted-foreground">
        Drag onto the canvas, or press <Kbd>Ctrl K</Kbd>. With one node selected, new nodes are
        added after it and connected.
      </p>
    </aside>
  );
}

/** Searchable list of everything that can be added: node types, agents and tool presets. */
export function QuickAdd({
  kind,
  open,
  onOpenChange,
  only,
  afterLabel,
  onAdd,
}: {
  kind: CanvasKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Restrict to agents or tool presets (after picking that node type). */
  only?: 'agent' | 'tool';
  /** Title of the node new nodes are connected after, if any. */
  afterLabel?: string;
  onAdd: (type: CanvasNodeType, needs?: NodeNeeds) => void;
}) {
  const agents = useEntities('agent');
  const tools = useEntities('tool');
  const agentVersions = useVersions('agent');
  const toolVersions = useVersions('tool');
  const add = (type: CanvasNodeType, needs?: NodeNeeds) => {
    onAdd(type, needs);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a node"
      description="Search node types, agents and tool presets"
    >
      <CommandInput
        placeholder={
          only === 'agent'
            ? 'Which agent?'
            : only === 'tool'
              ? 'Which tool preset?'
              : 'Add a node, an agent or a tool step…'
        }
      />
      {afterLabel && !only && (
        <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">
          Adds after <span className="font-medium text-foreground">{afterLabel}</span> and connects
          it.
        </div>
      )}
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {!only && (
          <CommandGroup heading="Nodes">
            {CANVAS_NODE_TYPES.filter((t) => !needsPick(kind, t)).map((type) => {
              const Icon = NODE_META[type].icon;
              const info = nodeTypeInfo(kind, type);
              return (
                <CommandItem
                  key={type}
                  value={`node ${info.label}`}
                  onSelect={() =>
                    add(type, type === 'agent' ? { slot: { role: 'Agent' } } : undefined)
                  }
                >
                  <Icon />
                  <span>{info.label}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {info.description}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {only !== 'tool' && (
          <CommandGroup heading={kind === 'pattern' ? 'Slots with a default agent' : 'Agents'}>
            {(agents ?? []).map((a) => {
              const Icon = NODE_META.agent.icon;
              const ref = {
                kind: 'agent' as const,
                id: a.id,
                version: agentVersions[a.id]?.version ?? 'v1',
              };
              return (
                <CommandItem
                  key={a.id}
                  value={`agent ${a.name} ${a.description}`}
                  onSelect={() =>
                    add(
                      'agent',
                      kind === 'pattern'
                        ? { slot: { role: a.name, defaultAgent: ref } }
                        : { agent: ref },
                    )
                  }
                >
                  <Icon />
                  <span>{a.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {a.description}
                  </span>
                </CommandItem>
              );
            })}
            {agents?.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No agents yet. Create one in the Agents tab.
              </div>
            )}
          </CommandGroup>
        )}
        {only !== 'agent' && (
          <CommandGroup heading="Tool steps">
            {(tools ?? []).map((t) => (
              <CommandItem
                key={t.id}
                value={`tool step ${t.name} ${t.builtin}`}
                onSelect={() =>
                  add('toolStep', {
                    tool: { kind: 'tool', id: t.id, version: toolVersions[t.id]?.version ?? 'v1' },
                  })
                }
              >
                <BuiltinIcon id={t.builtin} />
                <span>{t.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">tool step</span>
              </CommandItem>
            ))}
            {tools?.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No tool presets yet. Create one in the Tools tab.
              </div>
            )}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
