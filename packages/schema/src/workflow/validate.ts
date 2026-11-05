/**
 * Live workflow validation (PLAN.md 9.5). Pure: the canvas runs it on every change, the server
 * runs it before saving and merging.
 */
import type { Agent } from '../agent.js';
import { anyGlobCovers } from '../glob.js';
import type { AgentRef, Ref, ToolRef } from '../ids.js';
import { isUnrestrictedShell, type ToolPreset } from '../tool.js';
import { analyzeLoops, exitOf, joinInputs, traceOrigin, type LoopAnalysis } from './editing.js';
import type { WorkflowGraph } from './graph.js';
import type { WorkflowNode } from './nodes.js';
import type { PatternLookup } from './patterns.js';

/**
 * Looks up the pinned library entities a workflow uses. Returns the entity, `null` when it
 * doesn't exist, or `undefined` when it isn't known (yet); rules that need it are skipped then.
 */
export interface WorkflowResolver {
  agent(ref: AgentRef): Agent | null | undefined;
  tool(ref: ToolRef): ToolPreset | null | undefined;
  /** Pinned patterns. Without it, pattern instances are checked as opaque nodes. */
  pattern?: PatternLookup;
  /** Placeholders of deleted entities (PLAN.md 8.4), for clearer messages about them. */
  deleted?: (ref: Ref) => { name: string } | undefined;
}

/**
 * How a missing reference is described: `agent “Planner” (v3) was deleted` for a placeholder,
 * `agent planner-k3x9qa (v3) no longer exists` otherwise.
 */
export function missingRefText(
  noun: string,
  ref: Ref,
  resolver: Pick<WorkflowResolver, 'deleted'> | undefined,
): string {
  const placeholder = resolver?.deleted?.(ref);
  return placeholder
    ? `${noun} “${placeholder.name}” (${ref.version}) was deleted. Replace it`
    : `${noun} ${ref.id} (${ref.version}) no longer exists`;
}

export type ProblemRule =
  | 'no-input'
  | 'uncapped-loop'
  | 'missing-join'
  | 'join-too-large'
  | 'no-exits'
  | 'single-exit'
  | 'exit-unconnected'
  | 'exhausted-exit'
  | 'evaluator-incomplete'
  | 'unreachable'
  | 'missing-ref'
  | 'write-not-covered'
  | 'reference-not-file'
  | 'reference-not-covered'
  | 'unrestricted-shell'
  | 'slot-in-workflow'
  | 'agent-in-pattern'
  | 'unbound-slot'
  | 'port-unconnected'
  | 'unknown-port'
  | 'pattern-cycle'
  | 'repeat-invalid';

/** A one-click fix the editor can offer. Apply it with `applyFix`. */
export type ProblemFix =
  | { kind: 'join-all'; node: string }
  | { kind: 'cap-exit'; node: string; exit: string; max: number }
  | { kind: 'port-join-all'; node: string; port: string };

export interface WorkflowProblem {
  /** Stable while the problem exists, e.g. `missing-join:agent-k2f8`. */
  id: string;
  rule: ProblemRule;
  severity: 'error' | 'warning';
  message: string;
  /** Affected nodes and edges. */
  nodes: string[];
  edges: string[];
  /** Where the problem is fixed: the node or edge to select. */
  at?: { node: string } | { edge: string };
  /** Errors block merging; these also block saving (PLAN.md 7.4: uncapped loops). */
  blocksSave: boolean;
  fix?: ProblemFix & { label: string };
  /**
   * For problems inside pattern instances: the flattened node and edge paths affected
   * (`review-k2f8/maker`), so an expanded instance can highlight them. `nodes` and `edges`
   * then name the instance node.
   */
  inner?: { nodes: string[]; edges: string[] };
}

export interface ValidateOptions {
  /** A workflow (projects, templates) uses concrete agents; a pattern uses slots. */
  kind?: 'workflow' | 'pattern';
  loops?: LoopAnalysis;
  /** Boundary ports of inlined pattern instances: content passes through them. */
  ports?: ReadonlySet<string>;
}

type DecisionNode = Extract<WorkflowNode, { type: 'decision' }>;

const DEFAULT_CAP = 3;

/** Display name of a node in problem messages. */
export function nodeName(node: WorkflowNode, resolver?: WorkflowResolver): string {
  if (node.label) return node.label;
  switch (node.type) {
    case 'input':
    case 'output':
    case 'sharedStore':
      return node.name;
    case 'agent':
      return node.binding.kind === 'agent'
        ? (resolver?.agent(node.binding.agent)?.name ?? node.binding.agent.id)
        : node.binding.role;
    case 'artifact':
      return node.path;
    case 'decision':
      return 'Decision';
    case 'toolStep':
      return resolver?.tool(node.tool)?.name ?? 'Tool step';
    case 'humanInput':
      return 'Human input';
    case 'pattern':
      return resolver?.pattern?.(node.pattern)?.name ?? 'Pattern';
    case 'note':
      return 'Note';
  }
}

function listNames(names: string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1) ?? ''}`;
}

/** The agent behind an agent node or an agent evaluator, if it is a concrete agent. */
function agentRefOf(node: WorkflowNode): AgentRef | undefined {
  if (node.type === 'agent' && node.binding.kind === 'agent') return node.binding.agent;
  if (
    node.type === 'decision' &&
    node.evaluator.type === 'agent' &&
    node.evaluator.agent.kind === 'agent'
  ) {
    return node.evaluator.agent.agent;
  }
  return undefined;
}

/** The agent's tool presets, or `undefined` if any of them isn't known yet. */
function toolsOf(agent: Agent, resolver: WorkflowResolver): ToolPreset[] | undefined {
  const tools: ToolPreset[] = [];
  for (const ref of agent.tools) {
    const t = resolver.tool(ref);
    if (t === undefined) return undefined;
    if (t) tools.push(t);
  }
  return tools;
}

function pathScopes(tools: readonly ToolPreset[], builtins: readonly string[]): string[] {
  return tools.flatMap((t) =>
    builtins.includes(t.builtin) && 'paths' in t.scope ? t.scope.paths : [],
  );
}

/** Validate a workflow graph. Without a resolver, rules that need library data are skipped. */
export function validateWorkflow(
  graph: WorkflowGraph,
  resolver?: WorkflowResolver,
  options: ValidateOptions = {},
): WorkflowProblem[] {
  const { kind = 'workflow', ports = new Set<string>() } = options;
  const loops = options.loops ?? analyzeLoops(graph);
  const problems: WorkflowProblem[] = [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id: string) => {
    const n = nodes.get(id);
    return n ? nodeName(n, resolver) : id;
  };
  /** `focus: 'edge'` puts the problem on its first edge, otherwise on its first node. */
  const add = ({
    focus,
    ...p
  }: Omit<WorkflowProblem, 'id' | 'blocksSave' | 'at'> & {
    blocksSave?: boolean;
    focus?: 'edge';
  }) => {
    const edge = p.edges[0];
    const node = p.nodes[0];
    const at = focus === 'edge' && edge ? { edge } : node ? { node } : edge ? { edge } : undefined;
    const base = `${p.rule}:${edge ?? node ?? 'workflow'}`;
    let id = base;
    for (let i = 2; problems.some((x) => x.id === id); i++) id = `${base}:${i}`;
    problems.push({ ...p, id, blocksSave: p.blocksSave ?? false, ...(at ? { at } : {}) });
  };

  // ---- Structure ----
  const inputs = graph.nodes.filter((n) => n.type === 'input' && !ports.has(n.id));
  if (inputs.length === 0) {
    add({
      rule: 'no-input',
      severity: 'error',
      message:
        kind === 'pattern'
          ? 'The pattern has no Input. Add one: it becomes the port where work comes in.'
          : 'The workflow has no Input. Add one: it is where the work starts.',
      nodes: [],
      edges: [],
    });
  }

  // Workflows use concrete agents; patterns use slots (bound when the pattern is inserted).
  // Nodes inside pattern instances (paths with "/") are checked through their instance.
  for (const node of graph.nodes) {
    if (node.id.includes('/')) continue;
    const binding =
      node.type === 'agent'
        ? node.binding
        : node.type === 'decision' && node.evaluator.type === 'agent'
          ? node.evaluator.agent
          : undefined;
    if (!binding) continue;
    const who =
      node.type === 'decision' ? `The evaluating agent of ${name(node.id)}` : name(node.id);
    if (kind === 'workflow' && binding.kind === 'slot') {
      add({
        rule: 'slot-in-workflow',
        severity: 'error',
        message: `${who} is a slot (“${binding.role}”). Slots belong in patterns; pick an agent.`,
        nodes: [node.id],
        edges: [],
      });
    }
    if (kind === 'pattern' && binding.kind === 'agent') {
      add({
        rule: 'agent-in-pattern',
        severity: 'error',
        message: `${who} is a concrete agent. In a pattern, agents are slots: give it a role, and optionally a default agent.`,
        nodes: [node.id],
        edges: [],
      });
    }
  }

  for (const loop of loops.uncapped) {
    const loopEdges = graph.edges.filter((e) => loop.edges.includes(e.id));
    const exitEdges = loopEdges.filter((e) => exitOf(graph, e));
    const names = listNames(loop.nodes.map(name));
    // Prefer the exit that closes the loop, then any exit in it.
    const exitEdge = exitEdges.find((e) => loops.backEdges.has(e.id)) ?? exitEdges[0];
    const exit = exitEdge && exitOf(graph, exitEdge);
    if (exitEdge && exit) {
      add({
        rule: 'uncapped-loop',
        severity: 'error',
        blocksSave: true,
        focus: 'edge',
        message: `The loop through ${names} has no cap. Set Max loops on the “${exit.label}” exit of ${name(exitEdge.source.node)}.`,
        nodes: [exitEdge.source.node, ...loop.nodes.filter((n) => n !== exitEdge.source.node)],
        edges: [exitEdge.id, ...loop.edges.filter((e) => e !== exitEdge.id)],
        fix: {
          kind: 'cap-exit',
          node: exitEdge.source.node,
          exit: exit.id,
          max: DEFAULT_CAP,
          label: `Cap at ${DEFAULT_CAP} loops`,
        },
      });
    } else {
      const back = loopEdges.find((e) => loops.backEdges.has(e.id)) ?? loopEdges[0];
      add({
        rule: 'uncapped-loop',
        severity: 'error',
        blocksSave: true,
        focus: 'edge',
        message: `The loop through ${names} has no decision, so nothing can stop it. Loops must go through a decision exit with Max loops.`,
        nodes: loop.nodes,
        edges: back ? [back.id, ...loop.edges.filter((e) => e !== back.id)] : loop.edges,
      });
    }
  }

  for (const node of graph.nodes) {
    const inputsOf = joinInputs(graph, node.id, loops);
    if (inputsOf.length > 1 && !node.join) {
      add({
        rule: 'missing-join',
        severity: 'error',
        message: `${name(node.id)} has ${inputsOf.length} inputs. Choose whether it waits for all of them, any one, or some of them.`,
        nodes: [node.id],
        edges: inputsOf.map((e) => e.id),
        fix: { kind: 'join-all', node: node.id, label: 'Wait for all inputs' },
      });
    }
    if (node.join?.mode === 'n-of-m' && inputsOf.length > 1 && node.join.n > inputsOf.length) {
      add({
        rule: 'join-too-large',
        severity: 'error',
        message: `${name(node.id)} waits for ${node.join.n} inputs but has only ${inputsOf.length}.`,
        nodes: [node.id],
        edges: [],
      });
    }
    if (node.type === 'decision') validateDecision(node);
  }

  function validateDecision(node: DecisionNode) {
    const n = name(node.id);
    if (node.exits.length === 0) {
      add({
        rule: 'no-exits',
        severity: 'error',
        message: `${n} has no exits. Add the labels it chooses between.`,
        nodes: [node.id],
        edges: [],
      });
    } else if (node.exits.length === 1) {
      add({
        rule: 'single-exit',
        severity: 'warning',
        message: `${n} has only one exit, so it always takes it.`,
        nodes: [node.id],
        edges: [],
      });
    }
    for (const exit of node.exits) {
      if (!graph.edges.some((e) => e.source.node === node.id && e.source.port === exit.id)) {
        add({
          rule: 'exit-unconnected',
          severity: 'error',
          message: `The “${exit.label}” exit of ${n} leads nowhere. Connect it to the next step.`,
          nodes: [node.id],
          edges: [],
        });
      }
      const ex = exit.onExhausted;
      if (
        ex?.action === 'exit' &&
        (ex.exit === exit.id || !node.exits.some((x) => x.id === ex.exit))
      ) {
        add({
          rule: 'exhausted-exit',
          severity: 'error',
          message: `When “${exit.label}” of ${n} runs out of loops, it should take another exit, but that exit no longer exists. Pick one, or stop and ask a human.`,
          nodes: [node.id],
          edges: [],
        });
      }
    }
    const ev = node.evaluator;
    const incomplete =
      ev.type === 'deterministic' && !ev.code.trim()
        ? `${n} has no evaluator code yet.`
        : ev.type === 'agent' && !ev.criteria.trim()
          ? `${n} has no criteria for its evaluating agent yet.`
          : ev.type === 'human' && !ev.instructions.trim()
            ? `${n} has no instructions for the reviewer yet.`
            : undefined;
    if (incomplete) {
      add({
        rule: 'evaluator-incomplete',
        severity: 'warning',
        message: incomplete,
        nodes: [node.id],
        edges: [],
      });
    }
  }

  // ---- Reachability ----
  if (inputs.length > 0) {
    const reached = new Set(inputs.map((n) => n.id));
    const queue = [...reached];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      for (const e of graph.edges) {
        if (e.source.node === id && !reached.has(e.target.node)) {
          reached.add(e.target.node);
          queue.push(e.target.node);
        }
      }
    }
    for (const node of graph.nodes) {
      if (node.type === 'note' || reached.has(node.id)) continue;
      add({
        rule: 'unreachable',
        severity: 'warning',
        message: `${name(node.id)} can’t be reached from an Input, so it never runs.`,
        nodes: [node.id],
        edges: [],
      });
    }
  }

  if (!resolver) return problems;

  // ---- Library references and tool coverage ----
  for (const node of graph.nodes) {
    const ref = agentRefOf(node);
    if (ref) {
      const agent = resolver.agent(ref);
      if (agent === null) {
        add({
          rule: 'missing-ref',
          severity: 'error',
          message: `${missingRefText(node.type === 'decision' ? `The evaluating agent of ${name(node.id)}, agent` : 'Agent', ref, resolver)}.`,
          nodes: [node.id],
          edges: [],
        });
      } else if (agent) {
        for (const toolRef of agent.tools) {
          const tool = resolver.tool(toolRef);
          if (tool === null) {
            add({
              rule: 'missing-ref',
              severity: 'error',
              message: `${agent.name} uses a tool preset that is gone: ${missingRefText('tool preset', toolRef, resolver)}.`,
              nodes: [node.id],
              edges: [],
            });
          } else if (tool && isUnrestrictedShell(tool)) {
            add({
              rule: 'unrestricted-shell',
              severity: 'warning',
              message: `${agent.name} (in ${name(node.id)}) has ${tool.name}, an unrestricted shell. It can run any command, bypassing every other restriction.`,
              nodes: [node.id],
              edges: [],
            });
          }
        }
      }
    }
    if (node.type === 'toolStep') {
      const tool = resolver.tool(node.tool);
      if (tool === null) {
        add({
          rule: 'missing-ref',
          severity: 'error',
          message: `${missingRefText('Tool preset', node.tool, resolver)}.`,
          nodes: [node.id],
          edges: [],
        });
      } else if (tool && isUnrestrictedShell(tool)) {
        add({
          rule: 'unrestricted-shell',
          severity: 'warning',
          message: `${name(node.id)} runs ${tool.name}, an unrestricted shell. It can run any command, bypassing every other restriction.`,
          nodes: [node.id],
          edges: [],
        });
      }
    }
  }

  for (const edge of graph.edges) {
    const from = nodes.get(edge.source.node);
    const to = nodes.get(edge.target.node);
    if (!from || !to) continue;

    // An agent writing an artifact needs a write or edit tool covering its path.
    if (from.type === 'agent' && to.type === 'artifact') {
      const ref = agentRefOf(from);
      const agent = ref && resolver.agent(ref);
      const tools = agent ? toolsOf(agent, resolver) : undefined;
      if (agent && tools) {
        const scopes = pathScopes(tools, ['write_file', 'edit_file']);
        if (!anyGlobCovers(scopes, to.path)) {
          add({
            rule: 'write-not-covered',
            severity: 'error',
            focus: 'edge',
            message: `${agent.name} writes ${to.path}, but none of its tools can write there. Give it a Write file or Edit file preset covering ${to.path}${scopes.length ? ` (its write tools cover ${scopes.join(', ')})` : ''}.`,
            nodes: [from.id, to.id],
            edges: [edge.id],
          });
        }
      }
    }

    // A reference passes a workspace path: it needs a file, and a read tool covering it.
    if (edge.context.mode === 'reference') {
      const origin = traceOrigin(graph, edge, ports);
      const paths =
        origin?.type === 'artifact'
          ? [origin.path]
          : origin?.type === 'input' && origin.files.length > 0
            ? origin.files
            : [];
      if (paths.length === 0) {
        add({
          rule: 'reference-not-file',
          severity: 'error',
          focus: 'edge',
          message: `This edge passes a reference, but ${origin ? name(origin.id) : 'its source'} isn’t a file in the workspace. Connect it from an Artifact, or choose another context mode.`,
          nodes: [to.id],
          edges: [edge.id],
        });
        continue;
      }
      const ref = agentRefOf(to);
      const agent = ref && resolver.agent(ref);
      const tools = agent ? toolsOf(agent, resolver) : undefined;
      if (agent && tools) {
        const scopes = pathScopes(tools, ['read_file']);
        const uncovered = paths.filter((p) => !anyGlobCovers(scopes, p));
        if (uncovered.length > 0) {
          add({
            rule: 'reference-not-covered',
            severity: 'error',
            focus: 'edge',
            message: `${agent.name} gets ${uncovered.join(', ')} by reference, but none of its tools can read it. Give it a Read file preset covering ${uncovered.join(', ')}${scopes.length ? ` (its read tools cover ${scopes.join(', ')})` : ''}.`,
            nodes: [to.id],
            edges: [edge.id],
          });
        }
      }
    }
  }

  return problems;
}

/** Apply a problem's one-click fix. */
export function applyFix(graph: WorkflowGraph, fix: ProblemFix): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n): WorkflowNode => {
      if (n.id !== fix.node) return n;
      switch (fix.kind) {
        case 'join-all':
          return { ...n, join: { mode: 'all' } };
        case 'port-join-all':
          return n.type === 'pattern'
            ? { ...n, portJoins: { ...n.portJoins, [fix.port]: { mode: 'all' } } }
            : n;
        case 'cap-exit':
          return n.type === 'decision'
            ? {
                ...n,
                exits: n.exits.map((x) =>
                  x.id === fix.exit ? { ...x, maxIterations: fix.max } : x,
                ),
              }
            : n;
      }
    }),
  };
}

export function hasBlockingProblems(problems: readonly WorkflowProblem[]): boolean {
  return problems.some((p) => p.blocksSave);
}

export function hasErrors(problems: readonly WorkflowProblem[]): boolean {
  return problems.some((p) => p.severity === 'error');
}
