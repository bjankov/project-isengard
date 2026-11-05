import {
  DRAFT_BRANCH,
  analyzeLoops,
  applyFix,
  canConnect,
  cloneSubgraph,
  createEdge,
  createNode,
  createPatternNode,
  flattenWorkflow,
  patternPorts,
  type PatternLookup,
  type WorkflowEdge,
  type WorkflowNode,
  extractSubgraph,
  newLocalId,
  type AgentOverride,
  type CanvasNodeType,
  type EdgeEndpoint,
  type NodeNeeds,
  type Subgraph,
  type WorkflowGraph,
  type WorkflowProblem,
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
import { Link } from 'react-router';
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
import {
  fromDoc,
  nodeTitle,
  removeItems,
  toDoc,
  type CanvasKind,
  type Change,
  type WorkflowDoc,
} from './doc';
import { edgeTypes, type FlowEdge } from './edges';
import { Inspector, type Selection } from './inspector';
import { flowNodeType, nodeTypes, type FlowNode } from './nodes';
import { NODE_DRAG_TYPE, PATTERN_ITEM, Palette, QuickAdd, needsPick } from './palette';
import { InsertPatternDialog, type PatternInsert } from './insert-pattern';
import {
  attach,
  collapsedSize,
  frameLayout,
  lerpSize,
  type ExpandContext,
  type Size,
} from './expand-layout';
import { useExpanded } from './use-expanded';
import { ContextPreview } from './context-preview';
import { ProblemsPanel } from './problems-panel';
import { SaveAsTemplateDialog } from './save-as-template';
import { useWorkflowCheck } from './use-workflow-check';

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

/**
 * The workflow canvas, for a project's workflow or a pattern's graph (PLAN.md 7.7: patterns
 * are edited on the same canvas). Patterns use slots instead of agents and have repeat groups;
 * projects have overrides, a workspace, templates and the context preview.
 */
export function WorkflowEditor({
  kind,
  source,
  back,
}: {
  kind: CanvasKind;
  source: EditorSourceReady<CanvasKind>;
  /** Where "Back" goes when editing a fork opened from a project. */
  back?: string;
}) {
  const editor = useEntityEditor(kind, source);
  const settings = useSettings();
  const tools = useEntities('tool');
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const entityId = source.saved?.id ?? '';
  const isPattern = kind === 'pattern';

  const doc = useMemo(() => toDoc(kind, editor.draft), [kind, editor.draft]);
  const { update } = editor;
  const restore = useCallback(
    (next: WorkflowDoc) => update(() => fromDoc(kind, next)),
    [kind, update],
  );
  const history = useUndoHistory(doc, restore);
  const change: Change = useCallback(
    (fn, key) => {
      history.record(doc, key);
      update((d) => fromDoc(kind, fn(toDoc(kind, d))));
    },
    [history, doc, update, kind],
  );

  // A change that must be saved right away (re-pinning a promoted fork): save once the
  // changed document has rendered, so the save sees it.
  const pendingSave = useRef(false);
  const changeAndSave: Change = useCallback(
    (fn, key) => {
      pendingSave.current = true;
      change(fn, key);
    },
    [change],
  );
  const { save: saveNow } = editor;
  useEffect(() => {
    if (!pendingSave.current) return;
    pendingSave.current = false;
    void saveNow();
  }, [editor.draft, saveNow]);
  const onFork = source.branch !== DRAFT_BRANCH;

  const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [] });
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [quickAdd, setQuickAdd] = useState<{
    only?: 'agent' | 'tool';
    at?: { x: number; y: number };
  } | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const pasteCount = useRef(0);

  // Forks may have been edited since they were cached.
  useEffect(() => usePinnedStore.getState().forgetBranches(), []);

  const graph = doc.workflow as WorkflowGraph;
  const loops = useMemo(() => analyzeLoops(graph), [graph]);
  const check = useWorkflowCheck(graph, {
    kind,
    repeat: doc.repeat,
    ...(isPattern && entityId ? { selfId: entityId } : {}),
  });
  const patterns = check.resolver.pattern;

  // ---- Problems ----

  /** Select the node or edge a problem is about, and bring it into view. */
  const selectProblem = useCallback(
    (p: WorkflowProblem) => {
      if (!p.at) return;
      const nodeIds =
        'node' in p.at
          ? [p.at.node]
          : (() => {
              const e = graph.edges.find((x) => p.at && 'edge' in p.at && x.id === p.at.edge);
              return e ? [e.source.node, e.target.node] : [];
            })();
      setSelection(
        'node' in p.at ? { nodes: [p.at.node], edges: [] } : { nodes: [], edges: [p.at.edge] },
      );
      void flow.fitView({
        nodes: nodeIds.map((id) => ({ id })),
        duration: 300,
        padding: 0.6,
        maxZoom: 1,
      });
    },
    [graph.edges, flow],
  );

  const fix = useCallback(
    (p: WorkflowProblem) => {
      const f = p.fix;
      if (!f) return;
      change((d) => ({ ...d, workflow: applyFix(d.workflow, f) }));
      toast.success(f.label);
    },
    [change],
  );

  /** Saving is refused while a loop has no cap (PLAN.md 7.4); the server checks too. */
  const save = useCallback(() => {
    const first = check.blocking[0];
    if (first) {
      toast.error('Can’t save: a loop has no cap', { description: first.message });
      setProblemsOpen(true);
      selectProblem(first);
      return;
    }
    void editor.save();
  }, [check.blocking, editor, selectProblem]);

  useSaveShortcut(save);

  // ---- React Flow view of the document ----

  // Expanded instances are view state per browser, never saved (DECISIONS.md, M5).
  const {
    expanded,
    progress,
    toggle: toggleFrame,
  } = useExpanded(`app.expanded.${kind}.${entityId || 'new'}`);
  /** Expand or collapse; collapsing drops selections inside the frame (they disappear). */
  const toggleExpanded = useCallback(
    (path: string) => {
      if (expanded.has(path)) {
        const inside = (id: string) => id.startsWith(`${path}/`);
        setSelection((sel) =>
          sel.nodes.some(inside) ? { ...sel, nodes: sel.nodes.filter((id) => !inside(id)) } : sel,
        );
      }
      toggleFrame(path);
    },
    [expanded, toggleFrame],
  );
  const lookup = useMemo<PatternLookup>(() => patterns ?? (() => undefined), [patterns]);
  const bound = useMemo(() => {
    const flat = flattenWorkflow(graph, lookup);
    return new Map(flat.graph.nodes.map((n) => [n.id, n]));
  }, [graph, lookup]);

  const view = useMemo(() => {
    const ctx: ExpandContext = { lookup, expanded, bound, progress };
    const flowNodes: FlowNode[] = [];
    const innerEdges: FlowEdge[] = [];
    /** Expanded frames actually drawn (their pattern is loaded). */
    const drawn = new Set<string>();
    /** How far each top-level node is moved to make room for expanded frames. */
    const shift: Record<string, { x: number; y: number }> = {};

    const edgeOf = (
      id: string,
      edge: WorkflowEdge,
      source: { node: string; handle?: string },
      target: { node: string; handle?: string },
      extra: Partial<FlowEdge['data']> & { opacity?: number; inner?: boolean },
    ): FlowEdge => {
      const problem = check.edges.get(id);
      const back = extra.back ?? false;
      return {
        id,
        type: 'workflow',
        source: source.node,
        sourceHandle: source.handle ?? null,
        target: target.node,
        targetHandle: target.handle ?? null,
        selected: selection.edges.includes(id),
        ...(extra.inner ? { selectable: false, focusable: false, zIndex: 1 } : {}),
        ...(extra.opacity !== undefined && extra.opacity < 1
          ? { style: { opacity: extra.opacity } }
          : {}),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: problem === 'error' ? '#dc2626' : back ? '#f59e0b' : '#94a3b8',
        },
        data: {
          edge,
          back,
          cap: extra.cap,
          uncapped: extra.uncapped ?? false,
          problem,
        },
      };
    };

    /** The children of an expanded frame (recursively), faded in by `opacity`. */
    const addFrame = (
      path: string,
      instance: Extract<WorkflowNode, { type: 'pattern' }>,
      opacity: number,
    ) => {
      const layout = frameLayout(path, instance, ctx);
      if (!layout) return;
      drawn.add(path);
      for (const inner of layout.nodes) {
        const open = inner.frame ? (progress.get(inner.id) ?? 1) : undefined;
        const nested = inner.node.type === 'pattern' ? lookup(inner.node.pattern) : undefined;
        const box =
          inner.frame && nested
            ? lerpSize(collapsedSize(nested), inner.frame, open ?? 1)
            : undefined;
        flowNodes.push({
          id: inner.id,
          type: inner.port
            ? 'wf-port'
            : inner.frame
              ? 'wf-pattern-frame'
              : flowNodeType(inner.node.type),
          parentId: inner.parent,
          position: inner.position,
          data: {
            node: inner.node,
            inner: true,
            ...(open !== undefined ? { open } : {}),
            ...(box ? { box } : {}),
          },
          draggable: false,
          // Agents inside take per-project overrides, so they can be selected (in a project).
          selectable:
            kind === 'project' &&
            inner.node.type === 'agent' &&
            inner.node.binding.kind === 'agent',
          selected: selection.nodes.includes(inner.id),
          connectable: false,
          measured: measured[inner.id],
          ...(inner.frame ? { width: inner.frame.width, height: inner.frame.height } : {}),
          style: { opacity },
        });
        if (inner.frame && inner.node.type === 'pattern') {
          addFrame(inner.id, inner.node, opacity * (open ?? 1));
        }
      }
      for (const e of layout.edges) {
        innerEdges.push(
          edgeOf(e.id, e.edge, e.source, e.target, {
            back: e.back,
            cap: e.cap,
            opacity,
            inner: true,
          }),
        );
      }
    };

    // Top level: frames for expanded instances, and room around them.
    const frames: {
      id: string;
      at: { x: number; y: number };
      closed: Size;
      /** The size it shows now (animating), and its size when fully open. */
      open: Size;
      full: Size;
    }[] = [];
    for (const n of graph.nodes) {
      if (n.type !== 'pattern' || !expanded.has(n.id)) continue;
      const layout = frameLayout(n.id, n, ctx);
      const pattern = lookup(n.pattern);
      if (!layout || !pattern) continue;
      // Not the measured size: once expanded, the frame (same id) is what gets measured.
      const closed = collapsedSize(pattern);
      const t = progress.get(n.id) ?? 1;
      frames.push({
        id: n.id,
        at: doc.layout.nodes[n.id] ?? { x: 0, y: 0 },
        closed,
        open: lerpSize(closed, layout.size, t),
        full: layout.size,
      });
    }
    for (const n of graph.nodes) {
      const p = doc.layout.nodes[n.id] ?? { x: 0, y: 0 };
      let dx = 0;
      let dy = 0;
      for (const f of frames) {
        if (f.id === n.id) continue;
        const extraX = Math.max(0, f.open.width - f.closed.width);
        const extraY = Math.max(0, f.open.height - f.closed.height);
        if (p.x > f.at.x + f.closed.width / 2) dx += extraX;
        else if (p.y > f.at.y + f.closed.height / 2) dy += extraY;
      }
      if (dx || dy) shift[n.id] = { x: dx, y: dy };
    }

    for (const n of graph.nodes) {
      const pos = doc.layout.nodes[n.id] ?? { x: 0, y: 0 };
      const s = shift[n.id];
      const position = s ? { x: pos.x + s.x, y: pos.y + s.y } : { x: pos.x, y: pos.y };
      const frame = frames.find((f) => f.id === n.id);
      if (frame && n.type === 'pattern') {
        const open = progress.get(n.id) ?? 1;
        flowNodes.push({
          id: n.id,
          type: 'wf-pattern-frame',
          position,
          // The node has its final size from the start (resizing it every animation frame
          // makes the resize observer loop); only the box drawn inside it grows.
          data: { node: n, open, box: frame.open },
          selected: selection.nodes.includes(n.id),
          width: frame.full.width,
          height: frame.full.height,
          measured: measured[n.id],
        });
        addFrame(n.id, n, open);
        continue;
      }
      const base: FlowNode = {
        id: n.id,
        type: flowNodeType(n.type),
        position,
        data: { node: n },
        selected: selection.nodes.includes(n.id),
        measured: measured[n.id],
      };
      flowNodes.push(
        n.type === 'note'
          ? { ...base, width: pos.width ?? NOTE_SIZE.width, height: pos.height ?? NOTE_SIZE.height }
          : base,
      );
    }

    const edges: FlowEdge[] = graph.edges.map((e) => {
      const from = graph.nodes.find((n) => n.id === e.source.node);
      const exit =
        from?.type === 'decision' ? from.exits.find((x) => x.id === e.source.port) : undefined;
      const toPort = (end: EdgeEndpoint) => attach('', end, graph, drawn);
      return edgeOf(e.id, e, toPort(e.source), toPort(e.target), {
        back: loops.backEdges.has(e.id),
        cap: loops.capEdges.has(e.id) ? exit?.maxIterations : undefined,
        uncapped: check.uncappedEdges.has(e.id),
        ...(drawn.has(e.source.node) || drawn.has(e.target.node) ? { inner: false } : {}),
      });
    });

    return { nodes: flowNodes, edges: [...edges, ...innerEdges], shift };
  }, [
    kind,
    graph,
    doc.layout.nodes,
    selection,
    measured,
    expanded,
    progress,
    lookup,
    bound,
    loops,
    check,
  ]);

  const nodes = view.nodes;
  const edges = view.edges;
  const shift = view.shift;

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const positions: Record<string, { x: number; y: number }> = {};
      const sizes: Record<string, { width: number; height: number }> = {};
      const measures: Record<string, { width: number; height: number }> = {};
      let nextSelected: Set<string> | undefined;
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          // Nodes moved aside for an expanded frame are saved where they really are.
          const s = shift[c.id];
          positions[c.id] = s ? { x: c.position.x - s.x, y: c.position.y - s.y } : c.position;
        } else if (c.type === 'dimensions' && c.dimensions) {
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
    [change, selection.nodes, shift],
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
      return canConnect(graph, source, target, patterns).ok;
    },
    [graph, patterns],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const { source, target } = endpoints(c);
      const check = canConnect(graph, source, target, patterns);
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
          patterns,
        );
        return { ...d, workflow: { ...g, edges: [...g.edges, edge] } };
      });
    },
    [graph, change, patterns],
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
      const check = fromIsSource
        ? canConnect(graph, a, b, patterns)
        : canConnect(graph, b, a, patterns);
      if (!check.ok) toast.error(check.reason);
    },
    [graph, patterns],
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

  /**
   * Put a new node on the canvas: at `at`, or after the selected node (connected from it, into
   * `inPort` for a pattern instance), or in the middle of the view; never on top of another.
   */
  const placeNode = useCallback(
    (node: WorkflowNode, at?: { x: number; y: number }, inPort?: string) => {
      const { id, type } = node;
      const positions = doc.layout.nodes;
      let pos = at;
      let edgeFrom: EdgeEndpoint | undefined;
      if (!pos && after && type !== 'note') {
        const p = positions[after.id] ?? { x: 0, y: 0 };
        const width = measured[after.id]?.width ?? DEFAULT_SIZE.width;
        pos = { x: p.x + width + 96, y: p.y };
        const free = (port: string) =>
          !graph.edges.some((e) => e.source.node === after.id && e.source.port === port);
        const outPorts = (() => {
          if (after.type === 'decision') return after.exits.map((x) => x.id);
          if (after.type !== 'pattern') return undefined;
          const pattern = patterns?.(after.pattern);
          return pattern ? patternPorts(pattern).outputs.map((o) => o.id) : [];
        })();
        const port = outPorts && (outPorts.find(free) ?? outPorts[0]);
        edgeFrom = outPorts ? (port ? { node: after.id, port } : undefined) : { node: after.id };
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
      const target: EdgeEndpoint = inPort ? { node: id, port: inPort } : { node: id };
      change((d) => {
        const g = { ...d.workflow, nodes: [...d.workflow.nodes, node] };
        let edges = g.edges;
        if (edgeFrom && canConnect(g, edgeFrom, target, patterns).ok) {
          edges = [
            ...edges,
            createEdge(
              g,
              newLocalId(
                'e',
                edges.map((e) => e.id),
              ),
              edgeFrom,
              target,
              patterns,
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
    [graph, doc.layout.nodes, after, measured, viewportCenter, change, revealLater, patterns],
  );

  const addNode = useCallback(
    (type: CanvasNodeType, needs?: NodeNeeds, at?: { x: number; y: number }) => {
      const id = newLocalId(
        ID_PREFIX[type],
        graph.nodes.map((n) => n.id),
      );
      placeNode(createNode(type, id, needs), at);
    },
    [graph, placeNode],
  );

  const [inserting, setInserting] = useState<{
    patternId?: string;
    at?: { x: number; y: number };
  } | null>(null);

  const insertPattern = useCallback(
    (insert: PatternInsert, at?: { x: number; y: number }) => {
      const id = newLocalId(
        'pattern',
        graph.nodes.map((n) => n.id),
      );
      const pattern = patterns?.(insert.pattern);
      const firstIn = pattern ? patternPorts(pattern).inputs[0]?.id : undefined;
      placeNode(createPatternNode(id, insert.pattern, insert.bindings, insert.repeat), at, firstIn);
    },
    [graph, placeNode, patterns],
  );

  const pick = useCallback(
    (type: CanvasNodeType, at?: { x: number; y: number }) => {
      const needs = needsPick(kind, type);
      if (needs) setQuickAdd({ only: needs, at });
      // In a pattern, agents are slots: a new one starts as a role to fill in.
      else if (type === 'agent') addNode(type, { slot: { role: 'Agent' } }, at);
      else addNode(type, undefined, at);
    },
    [addNode, kind],
  );

  const onDrop = (e: React.DragEvent) => {
    const type = e.dataTransfer.getData(NODE_DRAG_TYPE) as CanvasNodeType | typeof PATTERN_ITEM;
    if (!type) return;
    e.preventDefault();
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const at = { x: p.x - DEFAULT_SIZE.width / 2, y: p.y - DEFAULT_SIZE.height / 2 };
    if (type === PATTERN_ITEM) setInserting({ at });
    else pick(type, at);
  };

  // ---- Delete, copy, paste, undo ----

  const deleteSelection = useCallback(() => {
    // Nodes inside a pattern instance can't be deleted (they belong to the pattern).
    const own = selection.nodes.filter((id) => !id.includes('/'));
    if (own.length + selection.edges.length === 0) return;
    change((d) => removeItems(d, own, selection.edges));
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
      } else if (!mod && !e.altKey && key === 'p' && after?.type === 'agent' && !isPattern) {
        e.preventDefault();
        setPreview(after.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, copy, paste, deleteSelection, graph.nodes, after, isPattern]);

  const context: CanvasContextValue = useMemo(
    () => ({
      kind,
      graph,
      overrides: doc.overrides,
      repeat: doc.repeat,
      loops,
      check,
      settings,
      tools,
      expanded,
      toggleExpanded,
    }),
    [
      kind,
      graph,
      doc.overrides,
      doc.repeat,
      loops,
      check,
      settings,
      tools,
      expanded,
      toggleExpanded,
    ],
  );

  const shortcut = (k: string) => `${isMac ? '⌘' : 'Ctrl+'}${k}`;

  // A version on main must be complete: any error blocks merging.
  const versioning = useMemo(
    () => ({
      ...editor.versioning,
      mergeBlocked:
        check.errors > 0
          ? `Fix the ${isPattern ? 'pattern' : 'workflow'}’s ${check.errors === 1 ? 'error' : `${check.errors} errors`} first (see Problems under the canvas). A version on main must be complete.`
          : undefined,
    }),
    [editor.versioning, check.errors, isPattern],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <UnsavedChangesGuard dirty={editor.dirty} />
      <EditorHeader
        eyebrow={isPattern ? (onFork ? 'Pattern · project fork' : 'Pattern') : 'Project'}
        title={editor.saved?.name ?? doc.name}
        dirty={editor.dirty}
        saving={editor.saving}
        onSave={save}
        onDelete={editor.saved && !onFork ? editor.remove : undefined}
        versioning={versioning}
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
            {!isPattern && (
              <Button variant="ghost" size="sm" onClick={() => setTemplateOpen(true)}>
                <BookmarkPlus />
                Save as template
              </Button>
            )}
          </>
        }
      />
      {onFork && (
        <div className="border-b bg-violet-50 px-6 py-2 text-sm">
          {back?.startsWith('/') && (
            <Link
              to={back}
              className="mr-2 font-medium text-violet-800 underline-offset-4 hover:underline"
            >
              ← Back to the project
            </Link>
          )}
          <span className="text-muted-foreground">
            This is a fork: changes here affect only the node that pins it. Promote it from that
            node’s inspector.
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <Palette kind={kind} onPick={(type) => pick(type)} onPickPattern={() => setInserting({})} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={wrapper}
            className="relative min-h-0 min-w-0 flex-1"
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
                onNodeDoubleClick={(_, n) => {
                  if (n.data.node.type === 'pattern' && !n.data.inner) toggleExpanded(n.id);
                }}
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
          <ProblemsPanel
            check={check}
            open={problemsOpen}
            onOpenChange={setProblemsOpen}
            onSelect={selectProblem}
            onFix={fix}
          />
        </div>
        <Inspector
          kind={kind}
          entityId={entityId}
          dirty={editor.dirty}
          changeAndSave={changeAndSave}
          innerNodes={bound}
          doc={doc}
          change={change}
          selection={selection}
          settings={settings}
          errors={editor.errors}
          onDeleteSelection={deleteSelection}
          onWorkspaceCheck={() => undefined}
          check={check}
          onFix={fix}
          onPreview={setPreview}
        />
      </div>
      <QuickAdd
        open={quickAdd !== null}
        onOpenChange={(open) => !open && setQuickAdd(null)}
        kind={kind}
        only={quickAdd?.only}
        afterLabel={!quickAdd?.at && after ? nodeTitle(after, agentNames) : undefined}
        onAdd={(type, needs) => addNode(type, needs, quickAdd?.at)}
        onAddPattern={(patternId) => setInserting({ patternId })}
        selfId={isPattern ? entityId : undefined}
      />
      <InsertPatternDialog
        kind={kind}
        open={inserting !== null}
        onOpenChange={(open) => !open && setInserting(null)}
        initialPatternId={inserting?.patternId}
        selfId={isPattern ? entityId : undefined}
        onInsert={(insert) => insertPattern(insert, inserting?.at)}
      />
      {!isPattern && (
        <>
          <SaveAsTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} doc={doc} />
          <ContextPreview
            nodeId={preview}
            onOpenChange={(open) => !open && setPreview(null)}
            doc={doc}
            loops={loops}
            check={check}
          />
        </>
      )}
    </div>
  );
}
