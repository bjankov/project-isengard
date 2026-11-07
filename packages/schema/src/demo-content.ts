/**
 * Demo content (PLAN.md 9.6): a few skills, tool presets, agents and the two example projects,
 * added to a library when it is first created. After that they are ordinary, editable,
 * deletable entities; Settings → Restore defaults adds missing ones back by id.
 *
 * Every reference here pins `v1`. The server re-pins references to demo entities and built-in
 * patterns to their current versions when it adds them (see `repinAll`).
 */
import type { Agent, AgentDefaults, Effort, ModelRef } from './agent.js';
import { BUILTIN_PATTERN_IDS } from './builtin-patterns.js';
import type { Project } from './entities.js';
import type { EntityKind } from './ids.js';
import type { Skill } from './skill.js';
import type { ToolPreset } from './tool.js';
import type { ContextMode, WorkflowEdge } from './workflow/edges.js';
import type { Layout } from './workflow/graph.js';
import type { PayloadType, WorkflowNode } from './workflow/nodes.js';

const model = (m: string): ModelRef => ({ provider: 'anthropic', model: m });
const OPUS = model('claude-opus-5-5');
const SONNET = model('claude-sonnet-5-5');
const HAIKU = model('claude-haiku-5-5');

const defaults = (m: ModelRef, effort: Effort, maxIterations = 20): AgentDefaults => ({
  model: m,
  effort,
  limits: { maxIterations, maxTokens: 200_000, maxWallTimeSeconds: 600 },
});

/** Fixed ids, so Restore defaults can tell which demo entities are missing. */
export const DEMO_IDS = {
  skills: {
    unitTests: 'write-unit-tests-demo00',
    review: 'code-review-checklist-demo00',
    plan: 'plan-format-demo00',
  },
  tools: {
    read: 'read-workspace-demo00',
    writePlan: 'write-plan-demo00',
    writeSource: 'write-source-demo00',
    writeTests: 'write-tests-demo00',
    runTests: 'run-tests-demo00',
    webSearch: 'web-search-demo00',
  },
  agents: {
    planner: 'planner-demo00',
    executor: 'executor-demo00',
    tester: 'tester-demo00',
    reviewer: 'reviewer-demo00',
    router: 'router-demo00',
    researcher: 'researcher-demo00',
  },
  projects: {
    planBuildTest: 'plan-build-test-demo00',
    ticketRouter: 'ticket-router-demo00',
  },
} as const;

const ids = DEMO_IDS;

function ref<K extends EntityKind>(kind: K, id: string) {
  return { kind, id, version: 'v1' } as { kind: K; id: string; version: string };
}

// ---- Skills ----

const skills: Skill[] = [
  {
    id: ids.skills.plan,
    name: 'plan-format',
    description:
      'Write and follow PLAN.md: a short goal, then a "## Tasks" checklist of small, testable steps.',
    body: `# PLAN.md format

Use this structure, and nothing else:

\`\`\`markdown
# <one-line goal>

## Context
Two or three sentences: what exists today and what has to change.

## Tasks
- [ ] One small change, with the file it touches
- [ ] …

## Out of scope
- Anything tempting that is not needed for the goal
\`\`\`

## Rules
- Every task is small enough to finish and test on its own.
- Name the files a task touches.
- When you **follow** a plan, work through \`## Tasks\` in order and tick each one off.
`,
  },
  {
    id: ids.skills.unitTests,
    name: 'write-unit-tests',
    description: 'Write focused, fast unit tests for the code that changed.',
    body: `# Write unit tests

- Test behaviour, not implementation: one behaviour per test, named after it.
- Cover the happy path, one edge case and one failure for every public function you touched.
- No network, no clock, no randomness: inject them or stub them.
- Keep each test under ~15 lines. Prefer a table of cases to copy-paste.
- Put tests next to the existing ones and follow their style.

When you report back, end with JSON on its own line:
\`{"passed": <n>, "failed": <n>, "output": "<the failing output, if any>"}\`
`,
  },
  {
    id: ids.skills.review,
    name: 'code-review-checklist',
    description:
      'Review a change for correctness first, then clarity; give concrete, actionable notes.',
    body: `# Code review checklist

1. **Correctness:** does it do what the task asked? Look for off-by-one errors, unhandled
   empty or missing input, and error paths that swallow failures.
2. **Tests:** is the new behaviour tested, including one failure case?
3. **Scope:** does the change touch anything the task didn't ask for?
4. **Clarity:** would a new teammate understand the names and the flow?

Only raise what you would block a merge for, plus at most three suggestions.

End your review with JSON on its own line:
\`{"approved": true|false, "notes": "<what must change>"}\`
`,
  },
];

// ---- Tool presets ----

const tools: ToolPreset[] = [
  {
    id: ids.tools.read,
    name: 'Read workspace',
    description: 'Read any file in the workspace.',
    builtin: 'read_file',
    scope: { paths: ['**'] },
  },
  {
    id: ids.tools.writePlan,
    name: 'Write plan',
    description: 'Write PLAN.md at the workspace root, nothing else.',
    builtin: 'write_file',
    scope: { paths: ['PLAN.md'] },
  },
  {
    id: ids.tools.writeSource,
    name: 'Write source',
    description: 'Create and change files under src/.',
    builtin: 'write_file',
    scope: { paths: ['src/**'] },
  },
  {
    id: ids.tools.writeTests,
    name: 'Write tests',
    description: 'Create and change files under tests/.',
    builtin: 'write_file',
    scope: { paths: ['tests/**'] },
  },
  {
    id: ids.tools.runTests,
    name: 'Run tests',
    description: 'Run the test suite, and only that.',
    builtin: 'shell',
    scope: { commands: [{ match: 'exact', command: 'npm test' }] },
  },
  {
    id: ids.tools.webSearch,
    name: 'Web search',
    description: 'Search the web, without fetching pages.',
    builtin: 'web_search',
    scope: { allow: [], deny: [] },
  },
];

// ---- Agents ----

const skill = (id: string) => ref('skill', id);
const tool = (id: string) => ref('tool', id);

const agents: Agent[] = [
  {
    id: ids.agents.planner,
    name: 'Planner',
    description: 'Turns a task into a short PLAN.md.',
    prompt: `You are the planner. Read the task and the parts of the workspace it touches, then write PLAN.md.

Plan only: don't change any code. Keep the plan as short as the task allows.`,
    skills: [skill(ids.skills.plan)],
    tools: [tool(ids.tools.read), tool(ids.tools.writePlan)],
    defaults: defaults(OPUS, 'high'),
  },
  {
    id: ids.agents.executor,
    name: 'Executor',
    description: 'Implements the tasks of a plan in src/.',
    prompt: `You are the executor. Implement the tasks you are given, one at a time, in src/.

If you receive test failures, fix the cause, not the test. Don't touch files outside src/.`,
    skills: [skill(ids.skills.plan)],
    tools: [tool(ids.tools.read), tool(ids.tools.writeSource)],
    defaults: defaults(SONNET, 'medium', 30),
  },
  {
    id: ids.agents.tester,
    name: 'Tester',
    description: 'Writes tests for a change and runs the suite.',
    prompt: `You are the tester. Write unit tests for the change you are shown, run the test suite, and report the result.

Never change files in src/: report failures instead.`,
    skills: [skill(ids.skills.unitTests)],
    tools: [tool(ids.tools.read), tool(ids.tools.writeTests), tool(ids.tools.runTests)],
    defaults: defaults(SONNET, 'medium'),
  },
  {
    id: ids.agents.reviewer,
    name: 'Reviewer',
    description: 'Reviews a change and approves it or asks for changes.',
    prompt: `You are the reviewer. Review the work you are given against the task. Be specific: quote the line and say what to change.`,
    skills: [skill(ids.skills.review)],
    tools: [tool(ids.tools.read)],
    defaults: defaults(OPUS, 'medium'),
  },
  {
    id: ids.agents.router,
    name: 'Router',
    description: 'A small, fast classifier that sorts incoming tickets.',
    prompt: `You classify support tickets. Read the ticket and answer with exactly one label from the list you are given. No explanation.`,
    skills: [],
    tools: [],
    defaults: defaults(HAIKU, 'low', 1),
  },
  {
    id: ids.agents.researcher,
    name: 'Researcher',
    description: 'Answers questions from the codebase and the web.',
    prompt: `You answer questions about the product. Look in the workspace first, then search the web. Cite the files or pages you used.`,
    skills: [],
    tools: [tool(ids.tools.read), tool(ids.tools.webSearch)],
    defaults: defaults(SONNET, 'low'),
  },
];

// ---- Projects ----

const TESTS_PASS_CODE = `# Runs in v2, never in the app.
# The Tester ends its report with JSON such as {"passed": 12, "failed": 0, "output": "..."}.
# Exit code 0 takes the first exit (pass), anything else the second (fail).
import json
import sys

report = json.load(sys.stdin)
print(json.dumps({"notes": report.get("output", "")[-2000:]}))
sys.exit(0 if report.get("failed", 1) == 0 else 1)
`;

const agentNode = (id: string, agentId: string): WorkflowNode => ({
  id,
  type: 'agent',
  binding: { kind: 'agent', agent: ref('agent', agentId) },
});

const note = (id: string, text: string): WorkflowNode => ({ id, type: 'note', text });

function edge(
  from: string,
  to: string,
  opts: {
    fromPort?: string;
    toPort?: string;
    payload?: PayloadType;
    context?: ContextMode;
    history?: 'latest' | 'all';
  } = {},
): WorkflowEdge {
  return {
    id: `e-${from}-${opts.fromPort ? `${opts.fromPort}-` : ''}${to}`,
    source: opts.fromPort ? { node: from, port: opts.fromPort } : { node: from },
    target: opts.toPort ? { node: to, port: opts.toPort } : { node: to },
    payload: opts.payload ?? 'text',
    context: opts.context ?? { mode: 'full' },
    ...(opts.history ? { history: opts.history } : {}),
  };
}

type Placed = Record<string, [x: number, y: number] | [x: number, y: number, w: number, h: number]>;

function layoutOf(placed: Placed): Layout {
  const nodes: Layout['nodes'] = {};
  for (const [id, [x, y, width, height]] of Object.entries(placed)) {
    nodes[id] = width && height ? { x, y, width, height } : { x, y };
  }
  return { nodes, expanded: [] };
}

function planBuildTest(workspacePath: string): Project {
  return {
    id: ids.projects.planBuildTest,
    name: 'Plan, build, test',
    description:
      'A planner writes PLAN.md, an executor implements it, a tester checks it. Failing tests go back to the executor, at most 3 times.',
    workspacePath,
    overrides: {},
    workflow: {
      nodes: [
        {
          id: 'task',
          type: 'input',
          name: 'Task',
          payloadType: 'text',
          content:
            'Add a `slugify(title)` function to src/ that turns blog post titles into URL slugs ("Hello, World!" → "hello-world"), with tests.',
          files: [],
        },
        agentNode('planner', ids.agents.planner),
        { id: 'plan', type: 'artifact', path: 'PLAN.md', fileType: 'markdown' },
        agentNode('executor', ids.agents.executor),
        { id: 'code', type: 'artifact', path: 'src/**', fileType: 'code' },
        agentNode('tester', ids.agents.tester),
        {
          id: 'tests-pass',
          type: 'decision',
          label: 'Tests pass?',
          evaluator: { type: 'deterministic', language: 'python', code: TESTS_PASS_CODE },
          exits: [
            { id: 'pass', label: 'pass' },
            { id: 'fail', label: 'fail', maxIterations: 3, onExhausted: { action: 'halt' } },
          ],
        },
        { id: 'result', type: 'output', name: 'Result', payloadType: 'text' },
        note(
          'note-start',
          'Start here. The Task is what the workflow starts with. Click any node or edge to see its settings on the right.',
        ),
        note(
          'note-context',
          'Edges decide how much each agent sees. The Executor gets only the “## Tasks” section of PLAN.md; the Tester gets only the diff of src/.',
        ),
        note(
          'note-loop',
          'Failing tests go back to the Executor, at most 3 times, as a summary of the latest failure. Click the “max 3” badge to change it.',
        ),
        note(
          'note-preview',
          'Select an agent and press P to see exactly what it receives: its prompt, skills, tools and inputs.',
        ),
      ],
      edges: [
        edge('task', 'planner'),
        edge('planner', 'plan'),
        edge('plan', 'executor', {
          payload: 'file',
          context: { mode: 'excerpt', selector: { kind: 'heading', heading: '## Tasks' } },
        }),
        edge('executor', 'code'),
        edge('code', 'tester', {
          payload: 'file',
          context: { mode: 'diff', base: 'workspace-head' },
        }),
        edge('tester', 'tests-pass'),
        edge('tests-pass', 'result', { fromPort: 'pass' }),
        edge('tests-pass', 'executor', {
          fromPort: 'fail',
          context: {
            mode: 'summary',
            model: HAIKU,
            instruction: 'Summarize which tests failed and why, in a few lines.',
          },
          history: 'latest',
        }),
      ],
    },
    layout: layoutOf({
      task: [0, 160],
      planner: [320, 160],
      plan: [640, 160],
      executor: [960, 160],
      code: [1280, 160],
      tester: [1280, 368],
      'tests-pass': [1600, 352],
      result: [1920, 368],
      'note-start': [0, 0, 256, 112],
      'note-context': [640, 0, 288, 112],
      'note-loop': [960, 480, 288, 112],
      'note-preview': [320, 336, 256, 96],
    }),
  };
}

function ticketRouter(workspacePath: string): Project {
  return {
    id: ids.projects.ticketRouter,
    name: 'Ticket router',
    description:
      'A router agent sorts each ticket into bug, feature or question, and each kind takes its own path: bugs to a maker-checker pair, features to a planner with human approval, questions to a researcher.',
    workspacePath,
    overrides: {},
    workflow: {
      nodes: [
        {
          id: 'ticket',
          type: 'input',
          name: 'Ticket',
          payloadType: 'text',
          content:
            'Exporting a report with more than 1,000 rows fails with "413 Payload Too Large". It worked last week.',
          files: [],
        },
        {
          id: 'kind',
          type: 'decision',
          label: 'What kind of ticket?',
          evaluator: {
            type: 'agent',
            agent: { kind: 'agent', agent: ref('agent', ids.agents.router) },
            criteria:
              'bug: something that used to work, or should work, is broken.\nfeature: a request for new behaviour.\nquestion: someone wants to know how something works.',
          },
          exits: [
            { id: 'bug', label: 'bug' },
            { id: 'feature', label: 'feature' },
            { id: 'question', label: 'question' },
          ],
        },
        {
          id: 'fix',
          type: 'pattern',
          label: 'Fix and review',
          pattern: ref('pattern', BUILTIN_PATTERN_IDS.makerChecker),
          bindings: {
            maker: { kind: 'agent', agent: ref('agent', ids.agents.executor) },
            checker: { kind: 'agent', agent: ref('agent', ids.agents.reviewer) },
          },
          repeat: {},
          portJoins: {},
        },
        agentNode('planner', ids.agents.planner),
        {
          id: 'approve',
          type: 'decision',
          label: 'Approve the plan?',
          evaluator: {
            type: 'human',
            instructions:
              'Read the plan. Approve it if it solves the request without scope creep; otherwise reject it and say what to change.',
            allowFeedback: true,
          },
          exits: [
            { id: 'approve', label: 'approve' },
            { id: 'reject', label: 'reject', maxIterations: 2, onExhausted: { action: 'halt' } },
          ],
        },
        agentNode('researcher', ids.agents.researcher),
        {
          id: 'reply',
          type: 'output',
          name: 'Reply',
          payloadType: 'text',
          join: { mode: 'any' },
        },
        note(
          'note-router',
          'Only decision nodes branch. Here the Router agent reads the ticket and picks exactly one exit: bug, feature or question.',
        ),
        note(
          'note-pattern',
          'Bugs go to a Maker-checker pattern: the Executor fixes, the Reviewer checks. Click the expand button on it to look inside.',
        ),
        note(
          'note-human',
          'A person approves each plan. Rejected plans go back to the Planner with all earlier feedback, at most twice.',
        ),
      ],
      edges: [
        edge('ticket', 'kind'),
        edge('kind', 'fix', { fromPort: 'bug', toPort: 'in' }),
        edge('kind', 'planner', { fromPort: 'feature' }),
        edge('kind', 'researcher', { fromPort: 'question' }),
        edge('planner', 'approve'),
        edge('approve', 'planner', { fromPort: 'reject', history: 'all' }),
        edge('fix', 'reply', { fromPort: 'out' }),
        edge('approve', 'reply', { fromPort: 'approve' }),
        edge('researcher', 'reply'),
      ],
    },
    layout: layoutOf({
      ticket: [0, 288],
      kind: [320, 272],
      fix: [672, 96],
      planner: [672, 288],
      approve: [992, 272],
      researcher: [672, 480],
      reply: [1344, 288],
      'note-router': [256, 96, 256, 112],
      'note-pattern': [992, 0, 288, 112],
      'note-human': [992, 464, 288, 112],
    }),
  };
}

export interface DemoContent {
  skills: Skill[];
  tools: ToolPreset[];
  agents: Agent[];
  projects: Project[];
}

/** The demo entities, with both projects pointing at `workspacePath` (the demo workspace). */
export function demoContent(workspacePath: string): DemoContent {
  return {
    skills,
    tools,
    agents,
    projects: [planBuildTest(workspacePath), ticketRouter(workspacePath)],
  };
}

/** README committed into the demo workspace, so the repo has a HEAD. */
export const DEMO_WORKSPACE_README = `# Demo workspace

This folder is the workspace of the example projects ("Plan, build, test" and "Ticket router")
that come with the app. It is an ordinary git repo, created by the app.

In v1 nothing reads or writes it: the app only checks that it is a git repo. You can delete it;
Settings → Restore defaults creates it again.
`;
