/**
 * The 10 built-in patterns (PLAN.md 10), seeded into every library once. After that they are
 * ordinary, editable, deletable patterns (PLAN.md 8.4); Settings → Restore defaults (M6)
 * re-adds missing ones by id.
 *
 * Routing decisions that follow an agent's choice (Supervisor, Handoff, discussion,
 * Blackboard) are deterministic: the agent names the next step and a few lines of Python pick
 * that exit. Every loop goes through a capped decision exit (PLAN.md 7.4).
 */
import type { Pattern, RepeatGroup } from './entities.js';
import type { ModelRef } from './agent.js';
import type { ContextMode, WorkflowEdge } from './workflow/edges.js';
import type { Layout } from './workflow/graph.js';
import type { AgentBinding, DecisionExit, PayloadType, WorkflowNode } from './workflow/nodes.js';

const SUMMARY_MODEL: ModelRef = { provider: 'anthropic', model: 'claude-haiku-5-5' };
const DEFAULT_CAP = 5;

const ROUTE_CODE = `# Runs in v2, never in the app.
# The previous agent ends its reply with JSON naming the next step, e.g. {"next": "Worker 2"}.
# Printing {"exit": "<label>"} takes the exit with that label.
import json
import sys

reply = json.load(sys.stdin)
print(json.dumps({"exit": reply.get("next", "done")}))
`;

const VERDICT_CODE = `# Runs in v2, never in the app.
# The checker ends its reply with JSON such as {"approved": false, "notes": "..."}.
# Exit code 0 takes the first exit (approved), anything else the second (changes needed).
import json
import sys

verdict = json.load(sys.stdin)
print(json.dumps({"notes": verdict.get("notes", "")}))
sys.exit(0 if verdict.get("approved") else 1)
`;

// ---- A tiny builder ----

type Pos = [number, number];

class Builder {
  nodes: WorkflowNode[] = [];
  edges: WorkflowEdge[] = [];
  layout: Layout = { nodes: {}, expanded: [] };
  repeat: RepeatGroup[] = [];

  private place(id: string, [col, row]: Pos) {
    this.layout.nodes[id] = { x: col * 288, y: row * 144 };
  }

  input(id: string, name: string, at: Pos, payloadType: PayloadType = 'text') {
    this.nodes.push({ id, type: 'input', name, payloadType, content: '', files: [] });
    this.place(id, at);
    return this;
  }

  output(id: string, name: string, at: Pos, extra: Partial<WorkflowNode> = {}) {
    this.nodes.push({ id, type: 'output', name, payloadType: 'text', ...extra } as WorkflowNode);
    this.place(id, at);
    return this;
  }

  slot(id: string, role: string, description: string, at: Pos, extra: Partial<WorkflowNode> = {}) {
    const binding: AgentBinding = { kind: 'slot', role, description };
    this.nodes.push({ id, type: 'agent', binding, ...extra } as WorkflowNode);
    this.place(id, at);
    return this;
  }

  decision(
    id: string,
    label: string,
    at: Pos,
    exits: DecisionExit[],
    evaluator: Extract<WorkflowNode, { type: 'decision' }>['evaluator'],
  ) {
    this.nodes.push({ id, type: 'decision', label, evaluator, exits });
    this.place(id, at);
    return this;
  }

  store(id: string, name: string, at: Pos) {
    this.nodes.push({ id, type: 'sharedStore', name, format: 'markdown' });
    this.place(id, at);
    return this;
  }

  pattern(id: string, ref: { id: string }, at: Pos, label?: string) {
    this.nodes.push({
      id,
      type: 'pattern',
      ...(label ? { label } : {}),
      pattern: { kind: 'pattern', id: ref.id, version: 'v1' },
      bindings: {},
      repeat: {},
      portJoins: {},
    });
    this.place(id, at);
    return this;
  }

  edge(
    from: string,
    to: string,
    opts: {
      fromPort?: string;
      toPort?: string;
      context?: ContextMode;
      history?: 'latest' | 'all';
      access?: 'read' | 'write';
      payload?: PayloadType;
    } = {},
  ) {
    const id = `e-${from}-${opts.fromPort ?? ''}-${to}`.replace(/-+/g, '-');
    this.edges.push({
      id,
      source: opts.fromPort ? { node: from, port: opts.fromPort } : { node: from },
      target: opts.toPort ? { node: to, port: opts.toPort } : { node: to },
      payload: opts.payload ?? 'text',
      context: opts.context ?? { mode: 'full' },
      ...(opts.history ? { history: opts.history } : {}),
      ...(opts.access ? { access: opts.access } : {}),
    });
    return this;
  }

  group(id: string, label: string, nodes: string[], mode: 'parallel' | 'chain' = 'parallel') {
    this.repeat.push({ id, label, nodes, mode, min: 1, max: 9, default: mode === 'chain' ? 3 : 2 });
    return this;
  }

  build(id: string, name: string, description: string): Pattern {
    return {
      id,
      name,
      description,
      workflow: { nodes: this.nodes, edges: this.edges },
      layout: this.layout,
      repeat: this.repeat,
    };
  }
}

const routeEvaluator = { type: 'deterministic', language: 'python', code: ROUTE_CODE } as const;
const capped = (id: string, label: string, max = DEFAULT_CAP): DecisionExit => ({
  id,
  label,
  maxIterations: max,
});
const exit = (id: string, label: string): DecisionExit => ({ id, label });
const summary = (instruction: string): ContextMode => ({
  mode: 'summary',
  model: SUMMARY_MODEL,
  instruction,
});

// ---- The patterns ----

export const BUILTIN_PATTERN_IDS = {
  pipeline: 'pipeline-builtn',
  router: 'router-builtn',
  fanOut: 'fan-out-fan-in-builtn',
  supervisor: 'supervisor-builtn',
  hierarchy: 'hierarchy-builtn',
  handoff: 'handoff-builtn',
  makerChecker: 'maker-checker-builtn',
  ensemble: 'ensemble-builtn',
  discussion: 'moderated-discussion-builtn',
  blackboard: 'blackboard-builtn',
} as const;

const ids = BUILTIN_PATTERN_IDS;

const pipeline = new Builder()
  .input('in', 'Task', [0, 0])
  .slot(
    'step',
    'Step',
    'One stage of the pipeline. Each step works on the previous one’s output.',
    [1, 0],
  )
  .output('out', 'Result', [2, 0])
  .edge('in', 'step')
  .edge('step', 'out')
  .group('steps', 'Steps', ['step'], 'chain')
  .build(
    ids.pipeline,
    'Pipeline',
    'Steps run one after another, each on the previous step’s output.',
  );

const router = new Builder()
  .input('in', 'Request', [0, 1])
  .decision('route', 'Route', [1, 1], [exit('branch', 'Branch')], {
    type: 'agent',
    agent: {
      kind: 'slot',
      role: 'Router',
      description: 'A small classifier that picks the branch for each request.',
    },
    criteria: 'Choose the one branch that should handle this request.',
  })
  .slot('branch', 'Branch', 'Handles the requests routed to it.', [2, 1])
  .output('out', 'Result', [3, 1], { join: { mode: 'any' } })
  .edge('in', 'route')
  .edge('route', 'branch', { fromPort: 'branch' })
  .edge('branch', 'out')
  .group('branches', 'Branches', ['branch'])
  .build(ids.router, 'Router', 'A router agent sends each request down exactly one branch.');

const fanOut = new Builder()
  .input('in', 'Task', [0, 1])
  .slot('worker', 'Worker', 'Works on the task in parallel with the other workers.', [1, 1])
  .slot('aggregator', 'Aggregator', 'Combines the workers’ results into one.', [2, 1], {
    join: { mode: 'all' },
  })
  .output('out', 'Result', [3, 1])
  .edge('in', 'worker')
  .edge('worker', 'aggregator')
  .edge('aggregator', 'out')
  .group('workers', 'Workers', ['worker'])
  .build(
    ids.fanOut,
    'Fan-out / fan-in',
    'Workers run in parallel; an aggregator waits for all of them and combines the results.',
  );

const supervisor = new Builder()
  .input('in', 'Task', [0, 1])
  .slot(
    'supervisor',
    'Supervisor',
    'Plans the work, delegates each part to a worker, and decides when it is done. Ends each reply with {"next": "<worker>"} or {"next": "done"}.',
    [1, 1],
  )
  .decision(
    'delegate',
    'Delegate?',
    [2, 1],
    [capped('worker', 'Worker'), exit('done', 'done')],
    routeEvaluator,
  )
  .slot('worker', 'Worker', 'Does the part of the work the supervisor hands over.', [3, 0])
  .output('out', 'Result', [3, 2])
  .edge('in', 'supervisor')
  .edge('supervisor', 'delegate')
  .edge('delegate', 'worker', { fromPort: 'worker' })
  .edge('worker', 'supervisor', { history: 'latest' })
  .edge('delegate', 'out', { fromPort: 'done' })
  .group('workers', 'Workers', ['worker'])
  .build(
    ids.supervisor,
    'Supervisor',
    'A supervisor delegates to workers one at a time and decides when the work is done.',
  );

const hierarchy = new Builder()
  .input('in', 'Task', [0, 1])
  .slot(
    'top',
    'Top supervisor',
    'Splits the work between teams and decides when it is done. Ends each reply with {"next": "<team>"} or {"next": "done"}.',
    [1, 1],
  )
  .decision(
    'delegate',
    'Delegate?',
    [2, 1],
    [capped('team', 'Team'), exit('done', 'done')],
    routeEvaluator,
  )
  .pattern('team', { id: ids.supervisor }, [3, 0], 'Team')
  .output('out', 'Result', [3, 2])
  .edge('in', 'top')
  .edge('top', 'delegate')
  .edge('delegate', 'team', { fromPort: 'team', toPort: 'in' })
  .edge('team', 'top', { fromPort: 'out', history: 'latest' })
  .edge('delegate', 'out', { fromPort: 'done' })
  .group('teams', 'Teams', ['team'])
  .build(
    ids.hierarchy,
    'Hierarchy',
    'A top supervisor delegates to teams, each of them a Supervisor pattern with its own workers.',
  );

const handoff = new Builder()
  .input('in', 'Task', [0, 1])
  .decision(
    'handoff',
    'Hand off to',
    [1, 1],
    [capped('agent', 'Agent'), exit('finish', 'finish')],
    routeEvaluator,
  )
  .slot(
    'agent',
    'Agent',
    'Works on the task, then names who takes over next. Ends each reply with {"next": "<agent>"} or {"next": "finish"}.',
    [2, 0],
  )
  .output('out', 'Result', [2, 2])
  .edge('in', 'handoff')
  .edge('handoff', 'agent', { fromPort: 'agent' })
  .edge('agent', 'handoff', { history: 'latest' })
  .edge('handoff', 'out', { fromPort: 'finish' })
  .group('agents', 'Agents', ['agent'])
  .build(
    ids.handoff,
    'Handoff',
    'The active agent decides who takes over next, after every turn, until one of them finishes.',
  );

const makerChecker = new Builder()
  .input('in', 'Task', [0, 0])
  .slot('maker', 'Maker', 'Produces the work, and revises it from the checker’s feedback.', [1, 0])
  .slot(
    'checker',
    'Checker',
    'Reviews the maker’s work. Ends with {"approved": true|false, "notes": "..."}.',
    [2, 0],
  )
  .decision(
    'approved',
    'Approved?',
    [3, 0],
    [exit('yes', 'approved'), capped('no', 'changes needed', 3)],
    {
      type: 'deterministic',
      language: 'python',
      code: VERDICT_CODE,
    },
  )
  .output('out', 'Result', [4, 0])
  .edge('in', 'maker')
  .edge('maker', 'checker')
  .edge('checker', 'approved')
  .edge('approved', 'out', { fromPort: 'yes' })
  .edge('approved', 'maker', {
    fromPort: 'no',
    context: summary('Summarize what the checker asked to change.'),
    history: 'latest',
  })
  .build(
    ids.makerChecker,
    'Maker-checker',
    'A maker produces, a checker reviews; rejected work goes back to the maker with a summary of the feedback.',
  );

const ensemble = new Builder()
  .input('in', 'Task', [0, 1])
  .slot('member', 'Member', 'Answers the same task independently of the other members.', [1, 1])
  .slot(
    'aggregator',
    'Aggregator',
    'Compares the members’ answers and picks or merges the best one.',
    [2, 1],
    {
      join: { mode: 'all' },
    },
  )
  .output('out', 'Result', [3, 1])
  .edge('in', 'member')
  .edge('member', 'aggregator')
  .edge('aggregator', 'out')
  .group('members', 'Members', ['member'])
  .build(
    ids.ensemble,
    'Ensemble',
    'Several members answer the same task in parallel; an aggregator combines or votes on their answers.',
  );

// The shared store sits top left, before both readers: only the write edge runs backwards,
// and the canvas draws it as an arc over the top row.
const discussion = new Builder()
  .input('in', 'Topic', [0, 1])
  .slot(
    'moderator',
    'Moderator',
    'Runs the discussion: picks the next speaker or concludes. Ends each reply with {"next": "<participant>"} or {"next": "conclude"}.',
    [1, 1],
  )
  .decision(
    'next',
    'Next speaker',
    [2, 1],
    [capped('participant', 'Participant', 8), exit('conclude', 'conclude')],
    routeEvaluator,
  )
  .slot('participant', 'Participant', 'Reads the transcript and adds one contribution.', [3, 0])
  .store('transcript', 'Transcript', [0, 0])
  .output('out', 'Conclusion', [3, 2])
  .edge('in', 'moderator')
  .edge('moderator', 'next')
  .edge('next', 'participant', { fromPort: 'participant' })
  .edge('participant', 'moderator', { history: 'latest' })
  .edge('next', 'out', { fromPort: 'conclude' })
  .edge('transcript', 'moderator', { access: 'read' })
  .edge('transcript', 'participant', { access: 'read' })
  .edge('participant', 'transcript', { access: 'write' })
  .group('participants', 'Participants', ['participant'])
  .build(
    ids.discussion,
    'Moderated discussion',
    'A moderator gives participants turns on a shared transcript, then concludes.',
  );

const blackboard = new Builder()
  .input('in', 'Problem', [0, 1])
  .slot(
    'controller',
    'Controller',
    'Looks at the blackboard and picks the specialist who can move the solution forward, or decides it is done. Ends each reply with {"next": "<specialist>"} or {"next": "done"}.',
    [1, 1],
  )
  .decision(
    'pick',
    'Which specialist?',
    [2, 1],
    [capped('specialist', 'Specialist', 8), exit('done', 'done')],
    routeEvaluator,
  )
  .slot(
    'specialist',
    'Specialist',
    'Reads the blackboard and improves the part of the solution it knows about.',
    [3, 0],
  )
  .store('board', 'Blackboard', [0, 0])
  .output('out', 'Solution', [3, 2])
  .edge('in', 'controller')
  .edge('controller', 'pick')
  .edge('pick', 'specialist', { fromPort: 'specialist' })
  .edge('specialist', 'controller', { history: 'latest' })
  .edge('pick', 'out', { fromPort: 'done' })
  .edge('board', 'controller', { access: 'read' })
  .edge('board', 'specialist', { access: 'read' })
  .edge('specialist', 'board', { access: 'write' })
  .group('specialists', 'Specialists', ['specialist'])
  .build(
    ids.blackboard,
    'Blackboard',
    'Specialists take turns improving a shared solution; a controller picks who goes next.',
  );

/** In dependency order: a pattern comes after the patterns it nests (Hierarchy after Supervisor). */
export const BUILTIN_PATTERNS: readonly Pattern[] = [
  pipeline,
  router,
  fanOut,
  supervisor,
  hierarchy,
  handoff,
  makerChecker,
  ensemble,
  discussion,
  blackboard,
];
