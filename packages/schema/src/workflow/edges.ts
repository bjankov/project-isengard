import { z } from 'zod';
import { ModelRef } from '../agent.js';
import { LocalId } from '../ids.js';
import { PayloadType } from './nodes.js';

export const ExcerptSelector = z.discriminatedUnion('kind', [
  /** A markdown section, e.g. `## Tasks`. */
  z.object({ kind: z.literal('heading'), heading: z.string().trim().min(1) }),
  z.object({ kind: z.literal('jsonPath'), path: z.string().trim().min(1) }),
  z
    .object({ kind: z.literal('lines'), start: z.int().positive(), end: z.int().positive() })
    .refine((s) => s.end >= s.start, 'end must be >= start'),
]);
export type ExcerptSelector = z.infer<typeof ExcerptSelector>;

/** How much of the upstream output the receiving node sees. */
export const ContextMode = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('full') }),
  /** A workspace path the agent reads on demand (needs a read tool covering it). */
  z.object({ mode: z.literal('reference') }),
  z.object({ mode: z.literal('excerpt'), selector: ExcerptSelector }),
  z.object({ mode: z.literal('diff'), base: z.enum(['workspace-head', 'previous-iteration']) }),
  /** Configurable in v1; the summarizer LLM call only happens in v2. */
  z.object({ mode: z.literal('summary'), model: ModelRef, instruction: z.string().default('') }),
  z.object({ mode: z.literal('outcome-only') }),
]);
export type ContextMode = z.infer<typeof ContextMode>;
export type ContextModeName = ContextMode['mode'];
export const CONTEXT_MODES = ContextMode.options.map((o) => o.shape.mode.value);

export const EdgeEndpoint = z.object({
  node: LocalId,
  /** Decision exit id, or a pattern port (boundary node id). Omitted for plain nodes. */
  port: LocalId.optional(),
});
export type EdgeEndpoint = z.infer<typeof EdgeEndpoint>;

/**
 * An edge says what flows and how much of it the receiver sees. Edges never carry conditions;
 * only decision nodes branch.
 */
export const WorkflowEdge = z.object({
  id: LocalId,
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  /** Inferred from the source by the editor, but stored so the graph is fully specified. */
  payload: PayloadType,
  context: ContextMode,
  /** Only meaningful on edges that are part of a loop. */
  history: z.enum(['latest', 'all']).optional(),
  /** Only meaningful on edges to/from a shared store. */
  access: z.enum(['read', 'write']).optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdge>;
