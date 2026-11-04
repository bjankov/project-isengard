import {
  analyzeLoops,
  canConnect,
  cloneSubgraph,
  createEdge,
  createNode,
  extractSubgraph,
  newLocalId,
  type AgentOverride,
  type CanvasNodeType,
  type EdgeEndpoint,
  type EntityInput,
  type NodeNeeds,
  type Subgraph,
  type WorkflowGraph,
} from '@app/schema';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BookmarkPlus, Redo2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EditorHeader } from '@/components/editor-header';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEntityEditor, type EditorSourceReady } from '@/hooks/use-entity-editor';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useUndoHistory } from '@/hooks/use-undo';
import { useEntities } from '@/stores/library';
import { usePinnedStore } from '@/stores/pinned';
import { useSettings } from '@/stores/settings';
import { CanvasContext, type CanvasContextValue } from './context';
import { removeItems, nodeTitle, type Change, type ProjectDoc } from './doc';
import { edgeTypes, type FlowEdge } from './edges';
import { Inspector, type Selection } from './inspector';
import { flowNodeType, nodeTypes, type FlowNode } from './nodes';
import { NEEDS_PICK, NODE_DRAG_TYPE, Palette, QuickAdd } from './palette';
import { SaveAsTemplateDialog } from './save-as-template';

const GRID = 16;
const FIT_VIEW = { padding: 0.25, maxZoom: 1 };
const DEFAULT_SIZE = { width: 224, height: 72 };
const NOTE_SIZE = { width: 224, height: 112 };

const ID_PREFIX: Record<CanvasNodeType, string> = {
  input: 'input',
  output: 'output',
  agent: 'agent',
  decision: 'decision',
  artifact: 'artifact',
  toolStep: 'tool',
  humanInput: 'human',
  sharedStore: 'store',
  note: 'note',
};

/** Copied nodes, kept for the session so they can be pasted into another project too. */
let clipboard: (Subgraph & { overrides: Record<string, AgentOverride> }) | undefined;

const snap = (v: number) => Math.round(v / GRID) * GRID;

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')
  );
}

function dialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]');
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export function ProjectEditor({ source }: { source: EditorSourceReady<'project'> }) {
  const editor = useEntityEditor('project', source);
  const settings = useSettings();
  const tools = useEntities('tool');
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const projectId = source.saved?.id ?? '';

  const doc = editor.draft as unknown as ProjectDoc;
  const { update } = editor;
  const restore = useCallback(
    (next: ProjectDoc) => update(() => next as unknown as EntityInput<'project'>),
    [update],
  );
  const history = useUndoHistory(doc, restore);
  const change: Change = useCallback(
    (fn, key) => {
      history.record(doc, key);
      update((d) => fn(d as unknown as ProjectDoc) as unknown as EntityInput<'project'>);
    },
    [history, doc, update],
  );

  const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [] });
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [quickAdd, setQuickAdd] = useState<{
    only?: 'agent' | 'tool';
    at?: { x: number; y: number };
  } | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const pasteCount = useRef(0);

  useSaveShortcut(() => void editor.save());

  // Forks may have been edited since they were cached.
  useEffect(() => usePinnedStore.getState().forgetBranches(), []);

  const graph = doc.workflow as WorkflowGraph;
  const loops = useMemo(() => analyzeLoops(graph), [graph]);

  // ---- React Flow view of the document ----

  const nodes: FlowNode[] = useMemo(
    () =>
      graph.nodes.map((n) => {
        const pos = doc.layout.nodes[n.id] ?? { x: 0, y: 0 };
        const base: FlowNode = {
          id: n.id,
          type: flowNodeType(n.type),
          position: { x: pos.x, y: pos.y },
          data: { node: n },
          selected: selection.nodes.includes(n.id),
          measured: measured[n.id],
        };
        if (n.type === 'note') {
          return {
            ...base,
            width: pos.width ?? NOTE_SIZE.width,
            height: pos.height ?? NOTE_SIZE.height,
          };
        }
        return base;
      }),
    [graph, doc.layout.nodes, selection.nodes, measured],
  );

  const edges: FlowEdge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const from = graph.nodes.find((n) => n.id === e.source.node);
        const exit =
          from?.type === 'decision' ? from.exits.find((x) => x.id === e.source.port) : undefined;
        const back = loops.backEdges.has(e.id);
        return {
          id: e.id,
          type: 'workflow',
          source: e.source.node,
          sourceHandle: e.source.port ?? null,
          target: e.target.node,
          targetHandle: e.target.port ?? null,
          selected: selection.edges.includes(e.id),
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: back ? '#f59e0b' : '#94a3b8',
          },
          data: { edge: e, back, cap: exit?.maxIterations },
        };
      }),
    [graph, loops, selection.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const positions: Record<string, { x: number; y: number }> = {};
      const sizes: Record<string, { width: number; height: number }> = {};
      const measures: Record<string, { width: number; height: number }> = {};
      let nextSelected: Set<string> | undefined;
      for (const c of changes) {
        if (c.type === 'position' && c.position) positions[c.id] = c.position;
        else if (c.type === 'dimensions' && c.dimensions) {
          measures[c.id] = c.dimensions;
          if (c.setAttributes) sizes[c.id] = c.dimensions;
        } else if (c.type === 'select') {
          nextSelected ??= new Set(selection.nodes);
          if (c.selected) nextSelected.add(c.id);
          else nextSelected.delete(c.id);
        }
      }
      if (Object.keys(measures).length > 0) setMeasured((m) => ({ ...m, ...measures }));
      if (nextSelected) {
        const nodesSel = [...nextSelected];
        setSelection((s) => ({ ...s, nodes: nodesSel }));
      }
      const moved = Object.keys(positions);
      const resized = Object.keys(sizes);
      if (moved.length > 0 || resized.length > 0) {
        change(
          (d) => {
            const layout = { ...d.layout.nodes };
            for (const [id, p] of Object.entries(positions)) {
              layout[id] = { ...layout[id], x: p.x, y: p.y };
            }
            for (const [id, s] of Object.entries(sizes)) {
              const prev = layout[id] ?? { x: 0, y: 0 };
              layout[id] = { ...prev, width: Math.round(s.width), height: Math.round(s.height) };
            }
            return { ...d, layout: { ...d.layout, nodes: layout } };
          },
          `move:${[...moved, ...resized].sort().join(',')}`,
        );
      }
    },
    [change, selection.nodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      let next: Set<string> | undefined;
      for (const c of changes) {
        if (c.type !== 'select') continue;
        next ??= new Set(selection.edges);
        if (c.selected) next.add(c.id);
        else next.delete(c.id);
      }
      if (next) {
        const edgesSel = [...next];
        setSelection((s) => ({ ...s, edges: edgesSel }));
      }
    },
    [selection.edges],
  );

  // ---- Connections ----

  const endpoints = (
    c:
      | Connection
      | {
          source: string;
          target: string;
          sourceHandle?: string | null;
          targetHandle?: string | null;
        },
  ) => {
    const source: EdgeEndpoint = c.sourceHandle
      ? { node: c.source, port: c.sourceHandle }
      : { node: c.source };
    const target: EdgeEndpoint = c.targetHandle
      ? { node: c.target, port: c.targetHandle }
      : { node: c.target };
    return { source, target };
  };

  const isValidConnection = useCallback(
    (c: Connection | FlowEdge) => {
      const { source, target } = endpoints(c);
      return canConnect(graph, source, target).ok;
    },
    [graph],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const { source, target } = endpoints(c);
      const check = canConnect(graph, source, target);
      if (!check.ok) {
        toast.error(check.reason);
        return;
      }
      change((d) => {
        const g = d.workflow;
        const edge = createEdge(
          g,
          newLocalId(
            'e',
            g.edges.map((e) => e.id),
          ),
          source,
          target,
        );
        return { ...d, workflow: { ...g, edges: [...g.edges, edge] } };
      });
    },
    [graph, change],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;
      // Inputs and notes have no target handle, so find the node under the pointer.
      let toId = state.toNode?.id;
      if (!toId) {
        const point = 'changedTouches' in event ? event.changedTouches[0] : event;
        const el = point && document.elementFromPoint(point.clientX, point.clientY);
        toId = el?.closest<HTMLElement>('.react-flow__node')?.dataset.id;
      }
      if (!toId || toId === state.fromNode.id) return;
      const fromIsSource = state.fromHandle?.type !== 'target';
      const a = { node: state.fromNode.id, port: state.fromHandle?.id ?? undefined };
      const b = { node: toId, port: state.toHandle?.id ?? undefined };
      const check = fromIsSource ? canConnect(graph, a, b) : canConnect(graph, b, a);
      if (!check.ok) toast.error(check.reason);
    },
    [graph],
  );

  // ---- Adding nodes ----

  const viewportCenter = useCallback(() => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const p = flow.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    return { x: p.x - DEFAULT_SIZE.width / 2, y: p.y - DEFAULT_SIZE.height / 2 };
  }, [flow]);

  /** Pan to a newly added node when it lands outside the visible area. */
  const revealLater = useCallback(
    (p: { x: number; y: number }, size: { width: number; height: number }) => {
      requestAnimationFrame(() => {
        const rect = wrapper.current?.getBoundingClientRect();
        if (!rect) return;
        const tl = flow.flowToScreenPosition(p);
        const br = flow.flowToScreenPosition({ x: p.x + size.width, y: p.y + size.height });
        const visible =
          tl.x >= rect.left && tl.y >= rect.top && br.x <= rect.right && br.y <= rect.bottom;
        if (!visible) {
          void flow.setCenter(p.x + size.width / 2, p.y + size.height / 2, {
            zoom: flow.getZoom(),
            duration: 250,
          });
        }
      });
    },
    [flow],
  );

  const after =
    selection.nodes.length === 1 && selection.edges.length === 0
      ? graph.nodes.find((n) => n.id === selection.nodes[0])
      : undefined;
  const agentNames = Object.fromEntries((useEntities('agent') ?? []).map((a) => [a.id, a.name]));

  const addNode = useCallback(
    (type: CanvasNodeType, needs?: NodeNeeds, at?: { x: number; y: number }) => {
      const id = newLocalId(
        ID_PREFIX[type],
        graph.nodes.map((n) => n.id),
      );
      const node = createNode(type, id, needs);
      const positions = doc.layout.nodes;
      let pos = at;
      let edgeFrom: EdgeEndpoint | undefined;
      if (!pos && after && type !== 'note') {
        const p = positions[after.id] ?? { x: 0, y: 0 };
        const width = measured[after.id]?.width ?? DEFAULT_SIZE.width;
        pos = { x: p.x + width + 96, y: p.y };
        const port =
          after.type === 'decision'
            ? (
                after.exits.find(
                  (x) =>
                    !graph.edges.some((e) => e.source.node === after.id && e.source.port === x.id),
                ) ?? after.exits[0]
              )?.id
            : undefined;
        edgeFrom = port ? { node: after.id, port } : { node: after.id };
      }
      const start = pos ?? viewportCenter();
      const position = { x: snap(start.x), y: snap(start.y) };
      // Don't stack exactly on top of another node.
      // Don't overlap other nodes: move down until the spot is free.
      const size = type === 'note' ? NOTE_SIZE : DEFAULT_SIZE;
      const overlaps = (x: number, y: number) =>
        Object.entries(positions).some(([nid, p]) => {
          const m = measured[nid] ?? DEFAULT_SIZE;
          return (
            x < p.x + m.width + GRID &&
            p.x < x + size.width + GRID &&
            y < p.y + m.height + GRID &&
            p.y < y + size.height + GRID
          );
        });
      while (overlaps(position.x, position.y)) position.y += size.height + 2 * GRID;
      change((d) => {
        const g = { ...d.workflow, nodes: [...d.workflow.nodes, node] };
        let edges = g.edges;
        if (edgeFrom && canConnect(g, edgeFrom, { node: id }).ok) {
          edges = [
            ...edges,
            createEdge(
              g,
              newLocalId(
                'e',
                edges.map((e) => e.id),
              ),
              edgeFrom,
              { node: id },
            ),
          ];
        }
        return {
          ...d,
          workflow: { nodes: g.nodes, edges },
          layout: { ...d.layout, nodes: { ...d.layout.nodes, [id]: position } },
        };
      });
      setSelection({ nodes: [id], edges: [] });
      revealLater(position, size);
    },
    [graph, doc.layout.nodes, after, measured, viewportCenter, change, revealLater],
  );

  const pick = useCallback(
    (type: CanvasNodeType, at?: { x: number; y: number }) => {
      const needs = NEEDS_PICK[type];
      if (needs) setQuickAdd({ only: needs, at });
      else addNode(type, undefined, at);
    },
    [addNode],
  );

  const onDrop = (e: React.DragEvent) => {
    const type = e.dataTransfer.getData(NODE_DRAG_TYPE) as CanvasNodeType;
    if (!type) return;
    e.preventDefault();
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    pick(type, { x: p.x - DEFAULT_SIZE.width / 2, y: p.y - DEFAULT_SIZE.height / 2 });
  };

  // ---- Delete, copy, paste, undo ----

  const deleteSelection = useCallback(() => {
    if (selection.nodes.length + selection.edges.length === 0) return;
    change((d) => removeItems(d, selection.nodes, selection.edges));
    setSelection({ nodes: [], edges: [] });
  }, [selection, change]);

  const copy = useCallback(() => {
    if (selection.nodes.length === 0) return;
    const sub = extractSubgraph(graph, doc.layout.nodes, selection.nodes);
    const overrides: Record<string, AgentOverride> = {};
    for (const id of selection.nodes) {
      const o = doc.overrides[id];
      if (o) overrides[id] = o;
    }
    clipboard = { ...sub, overrides };
    pasteCount.current = 0;
    toast.success(`Copied ${sub.nodes.length} node${sub.nodes.length === 1 ? '' : 's'}`);
  }, [selection.nodes, graph, doc.layout.nodes, doc.overrides]);

  const paste = useCallback(() => {
    if (!clipboard) return;
    pasteCount.current += 1;
    const offset = GRID * 3 * pasteCount.current;
    const clone = cloneSubgraph(
      clipboard,
      { nodes: graph.nodes.map((n) => n.id), edges: graph.edges.map((e) => e.id) },
      { x: offset, y: offset },
    );
    const overrides: Record<string, AgentOverride> = {};
    for (const [old, o] of Object.entries(clipboard.overrides)) {
      const id = clone.idMap[old];
      if (id) overrides[id] = structuredClone(o);
    }
    change((d) => ({
      ...d,
      overrides: { ...d.overrides, ...overrides },
      workflow: {
        nodes: [...d.workflow.nodes, ...clone.nodes],
        edges: [...d.workflow.edges, ...clone.edges],
      },
      layout: { ...d.layout, nodes: { ...d.layout.nodes, ...clone.positions } },
    }));
    setSelection({ nodes: clone.nodes.map((n) => n.id), edges: [] });
  }, [graph, change]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      if (dialogOpen()) return;
      // Quick-add works everywhere except inside code editors.
      if (mod && key === 'k') {
        if (e.target instanceof HTMLElement && e.target.closest('.monaco-editor')) return;
        e.preventDefault();
        setQuickAdd({});
        return;
      }
      if (isEditableTarget(e.target)) return;
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      } else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) {
        e.preventDefault();
        history.redo();
      } else if (mod && key === 'c') {
        copy();
      } else if (mod && key === 'v') {
        e.preventDefault();
        paste();
      } else if (mod && key === 'a') {
        e.preventDefault();
        setSelection({ nodes: graph.nodes.map((n) => n.id), edges: [] });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, copy, paste, deleteSelection, graph.nodes]);

  const context: CanvasContextValue = useMemo(
    () => ({ graph, overrides: doc.overrides, loops, settings, tools }),
    [graph, doc.overrides, loops, settings, tools],
  );

  const shortcut = (k: string) => `${isMac ? '⌘' : 'Ctrl+'}${k}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <UnsavedChangesGuard dirty={editor.dirty} />
      <EditorHeader
        eyebrow="Project"
        title={editor.saved?.name ?? doc.name}
        dirty={editor.dirty}
        saving={editor.saving}
        onSave={() => void editor.save()}
        onDelete={editor.saved ? editor.remove : undefined}
        versioning={editor.versioning}
        actions={
          <>
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Undo"
                    disabled={!history.canUndo}
                    onClick={history.undo}
                  >
                    <Undo2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Undo ({shortcut('Z')})</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Redo"
                    disabled={!history.canRedo}
                    onClick={history.redo}
                  >
                    <Redo2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Redo ({isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z'})</TooltipContent>
              </Tooltip>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setTemplateOpen(true)}>
              <BookmarkPlus />
              Save as template
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <Palette onPick={(type) => pick(type)} />
        <div
          ref={wrapper}
          className="relative min-w-0 flex-1"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(NODE_DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={onDrop}
          data-testid="canvas"
        >
          <CanvasContext.Provider value={context}>
            <ReactFlow<FlowNode, FlowEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              deleteKeyCode={null}
              selectionKeyCode="Shift"
              multiSelectionKeyCode={isMac ? 'Meta' : 'Control'}
              snapToGrid
              snapGrid={[GRID, GRID]}
              fitView
              fitViewOptions={FIT_VIEW}
              minZoom={0.2}
              maxZoom={2}
            >
              <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
              <MiniMap pannable zoomable className="!rounded-md !border" />
              <Controls showInteractive={false} fitViewOptions={FIT_VIEW} />
            </ReactFlow>
          </CanvasContext.Provider>
          {graph.nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-md bg-background/80 px-3 py-2 text-sm text-muted-foreground">
                Drag a node from the left, or press {shortcut('K')}.
              </p>
            </div>
          )}
        </div>
        <Inspector
          projectId={projectId}
          doc={doc}
          change={change}
          selection={selection}
          settings={settings}
          errors={editor.errors}
          onDeleteSelection={deleteSelection}
          onWorkspaceCheck={() => undefined}
        />
      </div>
      <QuickAdd
        open={quickAdd !== null}
        onOpenChange={(open) => !open && setQuickAdd(null)}
        only={quickAdd?.only}
        afterLabel={!quickAdd?.at && after ? nodeTitle(after, agentNames) : undefined}
        onAdd={(type, needs) => addNode(type, needs, quickAdd?.at)}
      />
      <SaveAsTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} doc={doc} />
    </div>
  );
}
