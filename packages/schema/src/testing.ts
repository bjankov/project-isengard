/**
 * Sample entity inputs for tests. Not used by the app at runtime.
 */
import type { EntityInput } from './api.js';
import type { EntityKind } from './ids.js';

export const SKILL_ID = 'write-unit-tests-aaaaaa';
export const READ_TOOL_ID = 'read-src-bbbbbb';
export const SHELL_TOOL_ID = 'run-tests-cccccc';
export const PLANNER_ID = 'planner-dddddd';
export const EXECUTOR_ID = 'executor-eeeeee';
export const PATTERN_ID = 'maker-checker-ffffff';

const defaults = {
  model: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  effort: 'medium',
  limits: { maxIterations: 20, maxTokens: 200_000, maxWallTimeSeconds: 600 },
} as const;

export const sampleSkill: EntityInput<'skill'> = {
  name: 'write-unit-tests',
  description: 'Write focused unit tests for changed code.',
  body: '# Write unit tests\n\n- One behaviour per test.\n- No network.\n',
};

export const sampleReadTool: EntityInput<'tool'> = {
  name: 'Read src',
  description: 'Read anything under src/',
  builtin: 'read_file',
  scope: { paths: ['src/**'] },
};

export const sampleShellTool: EntityInput<'tool'> = {
  name: 'Run tests',
  description: '',
  builtin: 'shell',
  scope: { commands: [{ match: 'exact', command: 'npm test' }] },
};

export const sampleAgent: EntityInput<'agent'> = {
  name: 'Planner',
  description: 'Turns a task into PLAN.md',
  prompt: 'You are a careful planner.',
  skills: [{ kind: 'skill', id: SKILL_ID, version: 'v1' }],
  tools: [{ kind: 'tool', id: READ_TOOL_ID, version: 'v1' }],
  defaults,
};

/** Demo workflow 1 from PLAN.md 9.6, used to exercise every edge/decision feature. */
export const sampleProject: EntityInput<'project'> = {
  name: 'Demo: plan and execute',
  description: 'Prompt → Planner → PLAN.md → Executor → Tester → tests pass?',
  workspacePath: '/tmp/demo-workspace',
  overrides: { executor: { effort: 'high', limits: { maxIterations: 40 } } },
  workflow: {
    nodes: [
      {
        id: 'in',
        type: 'input',
        name: 'Task',
        payloadType: 'text',
        content: 'Add a /health route',
      },
      {
        id: 'planner',
        type: 'agent',
        binding: { kind: 'agent', agent: { kind: 'agent', id: PLANNER_ID, version: 'v1' } },
      },
      { id: 'plan', type: 'artifact', path: 'PLAN.md', fileType: 'markdown' },
      {
        id: 'executor',
        type: 'agent',
        join: { mode: 'any' },
        binding: { kind: 'agent', agent: { kind: 'agent', id: EXECUTOR_ID, version: 'v2' } },
      },
      {
        id: 'tests',
        type: 'toolStep',
        tool: { kind: 'tool', id: SHELL_TOOL_ID, version: 'v1' },
        args: { command: 'npm test' },
      },
      {
        id: 'pass',
        type: 'decision',
        evaluator: { type: 'deterministic', language: 'python', code: 'import sys\nsys.exit(0)\n' },
        exits: [
          { id: 'yes', label: 'pass' },
          { id: 'no', label: 'fail', maxIterations: 3, onExhausted: { action: 'halt' } },
        ],
      },
      { id: 'out', type: 'output', name: 'Result', payloadType: 'code' },
      { id: 'note', type: 'note', text: 'Executor retries at most 3 times.' },
    ],
    edges: [
      {
        id: 'e1',
        source: { node: 'in' },
        target: { node: 'planner' },
        payload: 'text',
        context: { mode: 'full' },
      },
      {
        id: 'e2',
        source: { node: 'planner' },
        target: { node: 'plan' },
        payload: 'file',
        context: { mode: 'full' },
      },
      {
        id: 'e3',
        source: { node: 'plan' },
        target: { node: 'executor' },
        payload: 'file',
        context: { mode: 'excerpt', selector: { kind: 'heading', heading: '## Tasks' } },
      },
      {
        id: 'e4',
        source: { node: 'executor' },
        target: { node: 'tests' },
        payload: 'none',
        context: { mode: 'full' },
      },
      {
        id: 'e5',
        source: { node: 'tests' },
        target: { node: 'pass' },
        payload: 'text',
        context: { mode: 'full' },
      },
      {
        id: 'e6',
        source: { node: 'pass', port: 'yes' },
        target: { node: 'out' },
        payload: 'code',
        context: { mode: 'diff', base: 'workspace-head' },
      },
      {
        id: 'e7',
        source: { node: 'pass', port: 'no' },
        target: { node: 'executor' },
        payload: 'text',
        context: { mode: 'summary', model: { provider: 'anthropic', model: 'claude-haiku-5-5' } },
        history: 'latest',
      },
    ],
  },
  layout: {
    nodes: { in: { x: 0, y: 0 }, planner: { x: 200, y: 0 }, out: { x: 1200, y: 0 } },
  },
};

export const samplePattern: EntityInput<'pattern'> = {
  name: 'Maker-checker',
  description: 'Maker produces, checker reviews, loop until approved.',
  workflow: {
    nodes: [
      { id: 'in', type: 'input', name: 'Task', payloadType: 'text' },
      {
        id: 'maker',
        type: 'agent',
        binding: {
          kind: 'slot',
          role: 'Maker',
          defaultAgent: { kind: 'agent', id: EXECUTOR_ID, version: 'v1' },
        },
      },
      { id: 'checker', type: 'agent', binding: { kind: 'slot', role: 'Checker' } },
      {
        id: 'approved',
        type: 'decision',
        evaluator: { type: 'human', instructions: 'Approve the change?', allowFeedback: true },
        exits: [
          { id: 'yes', label: 'approve' },
          { id: 'no', label: 'reject', maxIterations: 3 },
        ],
      },
      { id: 'out', type: 'output', name: 'Result', payloadType: 'text' },
    ],
    edges: [
      {
        id: 'e1',
        source: { node: 'in' },
        target: { node: 'maker' },
        payload: 'text',
        context: { mode: 'full' },
      },
      {
        id: 'e2',
        source: { node: 'maker' },
        target: { node: 'checker' },
        payload: 'text',
        context: { mode: 'full' },
      },
      {
        id: 'e3',
        source: { node: 'checker' },
        target: { node: 'approved' },
        payload: 'text',
        context: { mode: 'full' },
      },
      {
        id: 'e4',
        source: { node: 'approved', port: 'yes' },
        target: { node: 'out' },
        payload: 'text',
        context: { mode: 'full' },
      },
      {
        id: 'e5',
        source: { node: 'approved', port: 'no' },
        target: { node: 'maker' },
        payload: 'text',
        context: { mode: 'outcome-only' },
        history: 'all',
      },
    ],
  },
  layout: { nodes: {} },
};

export const sampleTemplate: EntityInput<'template'> = {
  name: 'Router template',
  description: 'Route tickets by type',
  workflow: {
    nodes: [
      { id: 'in', type: 'input', name: 'Ticket', payloadType: 'text' },
      {
        id: 'route',
        type: 'decision',
        evaluator: {
          type: 'agent',
          agent: { kind: 'agent', agent: { kind: 'agent', id: PLANNER_ID, version: 'v1' } },
          criteria: 'Classify the ticket',
        },
        exits: [
          { id: 'bug', label: 'bug' },
          { id: 'feature', label: 'feature' },
        ],
      },
      {
        id: 'mc',
        type: 'pattern',
        pattern: { kind: 'pattern', id: PATTERN_ID, version: 'v1' },
        bindings: {
          maker: { kind: 'agent', agent: { kind: 'agent', id: EXECUTOR_ID, version: 'v1' } },
          checker: { kind: 'agent', agent: { kind: 'agent', id: PLANNER_ID, version: 'v1' } },
        },
      },
      {
        id: 'human',
        type: 'humanInput',
        instructions: 'Describe the bug',
        fields: [{ id: 'steps', label: 'Steps', kind: 'longText' }],
      },
      { id: 'board', type: 'sharedStore', name: 'Notes', format: 'markdown' },
    ],
    edges: [
      {
        id: 'e1',
        source: { node: 'in' },
        target: { node: 'route' },
        payload: 'text',
        context: { mode: 'full' },
      },
      {
        id: 'e2',
        source: { node: 'route', port: 'feature' },
        target: { node: 'mc', port: 'in' },
        payload: 'text',
        context: { mode: 'full' },
      },
      {
        id: 'e3',
        source: { node: 'route', port: 'bug' },
        target: { node: 'human' },
        payload: 'text',
        context: { mode: 'reference' },
      },
      {
        id: 'e4',
        source: { node: 'human' },
        target: { node: 'board' },
        payload: 'text',
        context: { mode: 'full' },
        access: 'write',
      },
    ],
  },
  layout: { nodes: {}, expanded: ['mc'] },
};

export const SAMPLE_INPUTS: { [K in EntityKind]: EntityInput<K> } = {
  skill: sampleSkill,
  tool: sampleReadTool,
  agent: sampleAgent,
  pattern: samplePattern,
  template: sampleTemplate,
  project: sampleProject,
};
