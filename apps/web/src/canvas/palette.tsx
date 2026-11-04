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
import { NODE_META } from './node-meta';

export const NODE_DRAG_TYPE = 'application/x-workflow-node';

/** Node types that need a library entity picked first. */
export const NEEDS_PICK: Partial<Record<CanvasNodeType, 'agent' | 'tool'>> = {
  agent: 'agent',
  toolStep: 'tool',
};

/** Left sidebar: drag a node type onto the canvas, or click to add it. */
export function Palette({ onPick }: { onPick: (type: CanvasNodeType) => void }) {
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
                title={NODE_TYPE_INFO[type].description}
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
                {NODE_TYPE_INFO[type].label}
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
  open,
  onOpenChange,
  only,
  afterLabel,
  onAdd,
}: {
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
            {CANVAS_NODE_TYPES.filter((t) => !NEEDS_PICK[t]).map((type) => {
              const Icon = NODE_META[type].icon;
              return (
                <CommandItem
                  key={type}
                  value={`node ${NODE_TYPE_INFO[type].label}`}
                  onSelect={() => add(type)}
                >
                  <Icon />
                  <span>{NODE_TYPE_INFO[type].label}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {NODE_TYPE_INFO[type].description}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {only !== 'tool' && (
          <CommandGroup heading="Agents">
            {(agents ?? []).map((a) => {
              const Icon = NODE_META.agent.icon;
              return (
                <CommandItem
                  key={a.id}
                  value={`agent ${a.name} ${a.description}`}
                  onSelect={() =>
                    add('agent', {
                      agent: {
                        kind: 'agent',
                        id: a.id,
                        version: agentVersions[a.id]?.version ?? 'v1',
                      },
                    })
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
