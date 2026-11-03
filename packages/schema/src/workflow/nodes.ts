import { z } from 'zod';
import { AgentRef, LocalId, PatternRef, ToolRef } from '../ids.js';
import { WorkspaceGlob } from '../tool.js';

/** What travels along an edge. `none` means pure sequencing ("start after"). */
export const PayloadType = z.enum(['text', 'file', 'code', 'none']);
export type PayloadType = z.infer<typeof PayloadType>;

/** How a node with more than one incoming edge waits for its inputs. */
export const JoinMode = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('any') }),
  z.object({ mode: z.literal('n-of-m'), n: z.int().positive() }),
]);
export type JoinMode = z.infer<typeof JoinMode>;

/**
 * Who fills an agent position. In workflows it is a concrete agent; inside patterns it is a
 * slot (a role placeholder bound when the pattern is inserted).
 */
export const AgentBinding = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), agent: AgentRef }),
  z.object({
    kind: z.literal('slot'),
    role: z.string().trim().min(1).max(100),
    description: z.string().max(2000).default(''),
    defaultAgent: AgentRef.optional(),
  }),
]);
export type AgentBinding = z.infer<typeof AgentBinding>;

const nodeBase = z.object({
  id: LocalId,
  label: z.string().max(200).optional(),
  /** Required (by validation) when the node has more than one incoming edge. */
  join: JoinMode.optional(),
});

export const InputNode = nodeBase.extend({
  type: z.literal('input'),
  name: z.string().trim().min(1),
  payloadType: PayloadType,
  /** The initial prompt/task. Unused when the node is a pattern boundary port. */
  content: z.string().default(''),
  files: z.array(WorkspaceGlob).default([]),
});

export const OutputNode = nodeBase.extend({
  type: z.literal('output'),
  name: z.string().trim().min(1),
  payloadType: PayloadType,
});

export const AgentNode = nodeBase.extend({
  type: z.literal('agent'),
  binding: AgentBinding,
});

// ---- Decision ----

export const EvaluatorLanguage = z.enum(['python']);
export type EvaluatorLanguage = z.infer<typeof EvaluatorLanguage>;

export const DeterministicEvaluator = z.object({
  type: z.literal('deterministic'),
  language: EvaluatorLanguage,
  code: z.string().default(''),
  /** Original file name when the code was dropped in from a file. */
  sourceFileName: z.string().optional(),
});

export const AgentEvaluator = z.object({
  type: z.literal('agent'),
  agent: AgentBinding,
  criteria: z.string().default(''),
});

export const HumanEvaluator = z.object({
  type: z.literal('human'),
  instructions: z.string().default(''),
  allowFeedback: z.boolean().default(true),
});

export const Evaluator = z.discriminatedUnion('type', [
  DeterministicEvaluator,
  AgentEvaluator,
  HumanEvaluator,
]);
export type Evaluator = z.infer<typeof Evaluator>;

/** What happens when a capped exit hits its `maxIterations`. */
export const OnExhausted = z.discriminatedUnion('action', [
  /** Default: the run halts and requests human attention. */
  z.object({ action: z.literal('halt') }),
  z.object({ action: z.literal('exit'), exit: LocalId }),
]);
export type OnExhausted = z.infer<typeof OnExhausted>;

/**
 * A labeled decision exit. Its id is the source port of the outgoing edge. Exits whose edge
 * forms a cycle (back-edges) must set `maxIterations` (enforced by validation).
 */
export const DecisionExit = z.object({
  id: LocalId,
  label: z.string().trim().min(1).max(100),
  maxIterations: z.int().positive().optional(),
  onExhausted: OnExhausted.optional(),
});
export type DecisionExit = z.infer<typeof DecisionExit>;

export const DecisionNode = nodeBase.extend({
  type: z.literal('decision'),
  evaluator: Evaluator,
  /** Ordered: for deterministic evaluators exit code 0 selects the first exit. */
  exits: z.array(DecisionExit),
});

// ---- Other nodes ----

export const ArtifactFileType = z.enum(['markdown', 'json', 'xml', 'yaml', 'text', 'code', 'other']);
export type ArtifactFileType = z.infer<typeof ArtifactFileType>;

export const ArtifactNode = nodeBase.extend({
  type: z.literal('artifact'),
  path: WorkspaceGlob,
  fileType: ArtifactFileType,
});

export const ToolStepNode = nodeBase.extend({
  type: z.literal('toolStep'),
  tool: ToolRef,
  /** Arguments for the preset's built-in, e.g. `{ command: "npm test" }` for shell. */
  args: z.record(z.string(), z.string()).default({}),
});

export const HumanInputField = z.object({
  id: LocalId,
  label: z.string().trim().min(1),
  kind: z.enum(['text', 'longText', 'file']),
  required: z.boolean().default(true),
});
export type HumanInputField = z.infer<typeof HumanInputField>;

export const HumanInputNode = nodeBase.extend({
  type: z.literal('humanInput'),
  instructions: z.string().default(''),
  fields: z.array(HumanInputField).default([]),
});

export const SharedStoreNode = nodeBase.extend({
  type: z.literal('sharedStore'),
  name: z.string().trim().min(1),
  format: z.enum(['markdown', 'json', 'text']),
});

export const PatternNode = nodeBase.extend({
  type: z.literal('pattern'),
  pattern: PatternRef,
  /** Slot bindings keyed by the slot's agent-node id inside the pattern. */
  bindings: z.record(LocalId, AgentBinding).default({}),
});

export const NoteNode = nodeBase.extend({
  type: z.literal('note'),
  text: z.string().default(''),
});

export const WorkflowNode = z.discriminatedUnion('type', [
  InputNode,
  OutputNode,
  AgentNode,
  DecisionNode,
  ArtifactNode,
  ToolStepNode,
  HumanInputNode,
  SharedStoreNode,
  PatternNode,
  NoteNode,
]);
export type WorkflowNode = z.infer<typeof WorkflowNode>;
export type WorkflowNodeType = WorkflowNode['type'];
export const WORKFLOW_NODE_TYPES = WorkflowNode.options.map((o) => o.shape.type.value);
