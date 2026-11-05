/**
 * The full workflow check: flatten pattern instances, run every rule on the flat graph, map the
 * problems back onto the nodes the user sees, and add the pattern rules (ports, slots, repeat
 * groups). Used by the canvas and the server alike.
 */
import type { RepeatGroup } from '../entities.js';
import type { WorkflowGraph } from './graph.js';
import type { WorkflowNode } from './nodes.js';
import {
  expandRepeats,
  flattenWorkflow,
  listSlots,
  ownerOf,
  patternPorts,
  type FlatWorkflow,
} from './patterns.js';
import {
  missingRefText,
  nodeName,
  validateWorkflow,
  type WorkflowProblem,
  type WorkflowResolver,
} from './validate.js';

export interface CheckOptions {
  /** A workflow (projects, templates) uses concrete agents; a pattern uses slots. */
  kind?: 'workflow' | 'pattern';
  /** Library lookups. `resolver.pattern` is what lets instances be checked inside. */
  resolver?: WorkflowResolver;
  /** When checking a pattern: its repeat groups and its own id. */
  repeat?: readonly RepeatGroup[];
  selfId?: string;
}

export interface WorkflowCheck {
  problems: WorkflowProblem[];
  flat: FlatWorkflow;
}

const isInner = (id: string) => id.includes('/');

/**
 * The template node a copy came from: `worker@2` → `worker`, `team@1/sup` → `team/sup`. Only
 * the first segment: copies inside instances stay as they are (they're inner paths).
 */
const template = (id: string) => id.replace(/^([^/@]+)@\d+(?=\/|$)/, '$1');

/** Map copies of a pattern's repeat groups back onto the template nodes the editor shows. */
function toTemplate(p: WorkflowProblem, edgeIds: ReadonlySet<string>): WorkflowProblem {
  const edges = uniq(p.edges.map(template)).filter((e) => isInner(e) || edgeIds.has(e));
  const out: WorkflowProblem = { ...p, nodes: uniq(p.nodes.map(template)), edges };
  if (p.at && 'node' in p.at) out.at = { node: template(p.at.node) };
  else if (p.at) {
    const e = template(p.at.edge);
    if (isInner(e) || edgeIds.has(e)) out.at = { edge: e };
    else delete out.at;
  }
  if (p.fix?.kind === 'cap-exit') {
    out.fix = { ...p.fix, node: template(p.fix.node), exit: p.fix.exit.replace(/@\d+$/, '') };
  } else if (p.fix) {
    out.fix = { ...p.fix, node: template(p.fix.node) };
  }
  return out;
}

function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

/** Map a problem found on the flat graph onto the original graph's nodes and edges. */
function lift(
  p: WorkflowProblem,
  flat: FlatWorkflow,
  name: (id: string) => string,
): WorkflowProblem {
  const innerNodes = p.nodes.filter(isInner);
  const innerEdges = p.edges.filter(isInner);
  if (innerNodes.length === 0 && innerEdges.length === 0) return p;

  const nodes = uniq([...p.nodes.map(ownerOf), ...innerEdges.map(ownerOf)]);
  const edges = p.edges.filter((e) => !isInner(e));
  let at: WorkflowProblem['at'];
  if (p.at && 'node' in p.at) at = { node: ownerOf(p.at.node) };
  else if (p.at) at = isInner(p.at.edge) ? { node: ownerOf(p.at.edge) } : { edge: p.at.edge };
  const owners = uniq([...innerNodes, ...innerEdges].map(ownerOf));
  const allInner = p.nodes.every(isInner) && p.edges.every(isInner);
  const only = allInner && owners.length === 1 ? owners[0] : undefined;

  let fix: WorkflowProblem['fix'];
  if (p.fix?.kind === 'join-all' && flat.ports.has(p.fix.node)) {
    const [node, port, ...rest] = p.fix.node.split('/');
    if (node && port && rest.length === 0) {
      fix = { kind: 'port-join-all', node, port, label: p.fix.label };
    }
  } else if (p.fix && !isInner(p.fix.node)) {
    fix = p.fix;
  }

  const lifted: WorkflowProblem = {
    id: p.id,
    rule: p.rule,
    severity: p.severity,
    blocksSave: p.blocksSave,
    message: only ? `In ${name(only)}: ${p.message}` : p.message,
    nodes,
    edges,
    inner: { nodes: innerNodes, edges: innerEdges },
  };
  if (at) lifted.at = at;
  if (fix) lifted.fix = fix;
  return lifted;
}

/** Check a workflow or pattern graph, including inside its pattern instances. */
export function checkWorkflow(graph: WorkflowGraph, options: CheckOptions = {}): WorkflowCheck {
  const { kind = 'workflow', resolver, repeat = [], selfId } = options;
  const lookup = resolver?.pattern;
  // A pattern is checked as it will be used: each repeat group at its default size. Problems
  // on the copies are mapped back onto the template nodes.
  const used =
    kind === 'pattern' && repeat.length > 0
      ? expandRepeats({ workflow: graph, repeat: [...repeat] })
      : graph;
  const flat = flattenWorkflow(used, lookup, selfId);
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  const original = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id: string) => {
    const n = original.get(id);
    return n ? nodeName(n, resolver) : id;
  };

  const problems: WorkflowProblem[] = [];
  const seen = new Set<string>();
  const push = (p: WorkflowProblem) => {
    let id = p.id;
    for (let i = 2; seen.has(id); i++) id = `${p.id}:${String(i)}`;
    seen.add(id);
    problems.push({ ...p, id });
  };

  // ---- Rules on the flat graph, lifted back ----
  const flatProblems = validateWorkflow(flat.graph, resolver, { kind, ports: flat.ports });
  const innerCount = new Map<string, number>();
  for (const n of flat.graph.nodes) {
    const id = template(n.id);
    if (isInner(id)) innerCount.set(ownerOf(id), (innerCount.get(ownerOf(id)) ?? 0) + 1);
  }
  const unreachableInner = new Map<string, number>();
  const duplicates = new Set<string>();
  for (const raw of flatProblems) {
    const p = used === graph ? raw : toTemplate(raw, edgeIds);
    if (p.rule === 'unreachable' && p.nodes.every(isInner)) {
      // An instance is unreachable when all of it is; partial gaps are the pattern's own.
      for (const id of p.nodes) {
        unreachableInner.set(ownerOf(id), (unreachableInner.get(ownerOf(id)) ?? 0) + 1);
      }
      continue;
    }
    const lifted = lift(p, flat, name);
    if (lifted.inner || used !== graph) {
      // A rule broken inside a pattern repeats in every copy; report it once.
      const key = `${lifted.rule}|${lifted.nodes.join(',')}|${lifted.edges.join(',')}`;
      if (duplicates.has(key)) continue;
      duplicates.add(key);
    }
    push(lifted);
  }
  for (const [owner, count] of unreachableInner) {
    if (count !== innerCount.get(owner)) continue;
    push({
      id: `unreachable:${owner}`,
      rule: 'unreachable',
      severity: 'warning',
      message: `${name(owner)} can’t be reached from an Input, so it never runs.`,
      nodes: [owner],
      edges: [],
      at: { node: owner },
      blocksSave: false,
    });
  }

  // ---- Pattern instances on this graph ----
  for (const node of graph.nodes) {
    if (node.type !== 'pattern') continue;
    checkInstance(node);
  }

  function checkInstance(node: Extract<WorkflowNode, { type: 'pattern' }>) {
    const at = { node: node.id };
    const base = { nodes: [node.id], edges: [] as string[], at, blocksSave: false };
    if (
      flat.recursive.has(node.id) ||
      [...flat.recursive.keys()].some((k) => ownerOf(k) === node.id)
    ) {
      push({
        ...base,
        id: `pattern-cycle:${node.id}`,
        rule: 'pattern-cycle',
        severity: 'error',
        message: `${name(node.id)} contains itself (directly or through a nested pattern), so it would never end.`,
        blocksSave: true,
      });
    }
    for (const [id, missing] of flat.missing) {
      if (ownerOf(id) !== node.id) continue;
      push({
        ...base,
        id: `missing-ref:${id}`,
        rule: 'missing-ref',
        severity: 'error',
        message: `${missingRefText('Pattern', missing.pattern, resolver)}${id === node.id ? '' : ` (inside ${name(node.id)})`}.`,
      });
    }
    const pattern = lookup?.(node.pattern);
    if (!pattern || !lookup) return;

    // Ports: every input port needs an edge; edges must use existing ports.
    const { inputs, outputs } = patternPorts(pattern);
    const portIds = new Set([...inputs, ...outputs].map((p) => p.id));
    for (const e of graph.edges) {
      const end =
        e.target.node === node.id ? e.target : e.source.node === node.id ? e.source : undefined;
      if (!end) continue;
      const ok =
        end.port !== undefined &&
        (end === e.target ? inputs : outputs).some((p) => p.id === end.port);
      if (!ok) {
        push({
          ...base,
          id: `unknown-port:${e.id}`,
          rule: 'unknown-port',
          severity: 'error',
          message:
            end.port && portIds.has(end.port)
              ? `This edge uses port “${end.port}” of ${name(node.id)} the wrong way round.`
              : `This edge connects to a port of ${name(node.id)} that no longer exists${end.port ? ` (“${end.port}”)` : ''}. Reconnect it to one of its ports.`,
          edges: [e.id],
          at: { edge: e.id },
        });
      }
    }
    for (const port of inputs) {
      const connected = graph.edges.some(
        (e) => e.target.node === node.id && e.target.port === port.id,
      );
      if (!connected) {
        push({
          ...base,
          id: `port-unconnected:${node.id}:${port.id}`,
          rule: 'port-unconnected',
          severity: 'error',
          message: `The “${port.name}” port of ${name(node.id)} has nothing connected. Connect what the pattern should work on.`,
        });
      }
    }

    // Slots: in a workflow every slot needs a concrete agent. In a pattern, nested slots stay
    // open (they are the outer pattern's slots), but must not be concrete agents.
    const slots = listSlots(pattern, node.repeat, lookup, new Set(selfId ? [selfId] : []));
    if (!slots) return;
    if (kind === 'workflow') {
      const unbound = slots.filter((s) => node.bindings[s.key]?.kind !== 'agent');
      if (unbound.length > 0) {
        const roles = unbound.map((s) => `“${s.role}”`);
        push({
          ...base,
          id: `unbound-slot:${node.id}`,
          rule: 'unbound-slot',
          severity: 'error',
          message: `${name(node.id)} has ${unbound.length === 1 ? 'an unbound slot' : `${String(unbound.length)} unbound slots`}: ${roles.slice(0, 3).join(', ')}${roles.length > 3 ? ` and ${String(roles.length - 3)} more` : ''}. Choose an agent for each.`,
        });
      }
    } else {
      const concrete = slots.filter((s) => node.bindings[s.key]?.kind === 'agent');
      if (concrete.length > 0) {
        push({
          ...base,
          id: `agent-in-pattern:${node.id}`,
          rule: 'agent-in-pattern',
          severity: 'error',
          message: `${name(node.id)} binds ${concrete.map((s) => `“${s.role}”`).join(', ')} to a concrete agent. In a pattern, nested slots stay slots.`,
        });
      }
    }
  }

  // ---- Repeat groups of the pattern being edited ----
  if (kind === 'pattern') {
    const owned = new Map<string, string>();
    const groupIds = new Set<string>();
    for (const group of repeat) {
      const problem = (message: string, nodes: string[] = []) =>
        push({
          id: `repeat-invalid:${group.id}:${String(problems.length)}`,
          rule: 'repeat-invalid',
          severity: 'error',
          message: `Repeat group “${group.label}”: ${message}`,
          nodes,
          edges: [],
          ...(nodes[0] ? { at: { node: nodes[0] } } : {}),
          blocksSave: false,
        });
      if (groupIds.has(group.id)) problem('its id is used by another group.');
      groupIds.add(group.id);
      for (const id of group.nodes) {
        const node = original.get(id);
        if (!node) {
          problem(`node “${id}” no longer exists.`);
        } else if (node.type === 'input' || node.type === 'output' || node.type === 'note') {
          problem(`${name(id)} can’t be repeated: ports and notes exist once.`, [id]);
        } else if (owned.has(id)) {
          problem(`${name(id)} is already in group “${owned.get(id) ?? ''}”.`, [id]);
        }
        owned.set(id, group.label);
      }
    }
  }

  return { problems, flat };
}
