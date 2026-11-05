import { z } from 'zod';
import { Agent, AgentDefaults, AgentOverride, DeletedRef, ModelRef } from './agent.js';
import { EntityKind, EntityMeta, LocalId, NodePath, RefKey } from './ids.js';
import { Skill } from './skill.js';
import { ToolPreset } from './tool.js';
import { Layout, WorkflowGraph } from './workflow/graph.js';

/**
 * A group of pattern nodes that an instance copies N times ("Worker 1…N", PLAN.md 10). How
 * the copies are wired is defined by `expandRepeats`. Edges inside the group are copied per
 * copy. `parallel`: edges into or out of the group connect every copy, and a decision exit
 * leading into the group becomes one exit per copy. `chain`: copies run one after another
 * (copy 1 gets the group's inputs, the last copy feeds its outputs).
 */
export const RepeatGroup = z
  .object({
    id: LocalId,
    /** Shown in the insert dialog, e.g. "Workers". */
    label: z.string().trim().min(1).max(100),
    nodes: z.array(LocalId).min(1),
    mode: z.enum(['parallel', 'chain']).default('parallel'),
    min: z.int().positive().default(1),
    max: z.int().positive().default(9),
    default: z.int().positive().default(2),
  })
  .refine((g) => g.min <= g.default && g.default <= g.max, {
    message: 'expected min <= default <= max',
  });
export type RepeatGroup = z.infer<typeof RepeatGroup>;

const PatternBody = EntityMeta.extend({
  workflow: WorkflowGraph,
  layout: Layout,
  repeat: z.array(RepeatGroup).default([]),
});

/**
 * Content of a deleted entity a workflow (or pattern) keeps as a local copy (PLAN.md 8.4). A
 * copied agent's or pattern's own local copies are moved up into the container's map, so
 * copies never nest.
 */
export const LocalCopy = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skill'), entity: Skill }),
  z.object({ kind: z.literal('tool'), entity: ToolPreset }),
  z.object({ kind: z.literal('agent'), entity: Agent }),
  z.object({ kind: z.literal('pattern'), entity: PatternBody }),
]);
export type LocalCopy = z.infer<typeof LocalCopy>;

/**
 * Deleted entities kept as local copies, and placeholders for deleted entities, keyed by the
 * pinned reference (`agent/<id>@v3`). References resolve to local copies first.
 */
const localFields = {
  localCopies: z.record(RefKey, LocalCopy).optional(),
  deletedRefs: z.record(RefKey, DeletedRef).optional(),
};

/**
 * A reusable sub-graph. Input/Output nodes are its ports; agent nodes bound to slots are its
 * slots. Patterns may contain other patterns.
 */
export const Pattern = PatternBody.extend(localFields);
export type Pattern = z.infer<typeof Pattern>;

/** A saved workflow that new projects can start from. */
export const Template = EntityMeta.extend({
  workflow: WorkflowGraph,
  layout: Layout,
  ...localFields,
});
export type Template = z.infer<typeof Template>;

/** One project = one workflow, plus a workspace repo and per-instance overrides. */
export const Project = EntityMeta.extend({
  /** Absolute path of the workspace git repo (validated by the server). */
  workspacePath: z.string().trim().min(1),
  /**
   * Overrides keyed by agent-node id, or by node path for agents inside pattern instances
   * (`review-k2f8/maker`, `team-a1b2/worker@2`).
   */
  overrides: z.record(NodePath, AgentOverride).default({}),
  workflow: WorkflowGraph,
  layout: Layout,
  ...localFields,
});
export type Project = z.infer<typeof Project>;

/** Stable string key for a model, e.g. "anthropic/claude-sonnet-5-5". */
export function modelKey(m: ModelRef): string {
  return `${m.provider}/${m.model}`;
}

/** App settings: the static model list and defaults for new agents. */
export const ModelOption = ModelRef.extend({
  label: z.string().trim().min(1).optional(),
});
export type ModelOption = z.infer<typeof ModelOption>;

export const Settings = z.object({
  models: z
    .array(ModelOption)
    .default([])
    .superRefine((models, ctx) => {
      const seen = new Set<string>();
      models.forEach((m, i) => {
        const key = modelKey(m);
        if (seen.has(key)) {
          ctx.addIssue({ code: 'custom', message: `duplicate model "${key}"`, path: [i, 'model'] });
        }
        seen.add(key);
      });
    }),
  agentDefaults: AgentDefaults,
});
export type Settings = z.infer<typeof Settings>;

// ---- Kind registry ----

export const ENTITY_SCHEMAS = {
  skill: Skill,
  tool: ToolPreset,
  agent: Agent,
  pattern: Pattern,
  template: Template,
  project: Project,
} as const;

export interface EntityByKind {
  skill: Skill;
  tool: ToolPreset;
  agent: Agent;
  pattern: Pattern;
  template: Template;
  project: Project;
}
export type AnyEntity = EntityByKind[EntityKind];

/** URL segment used by the REST API for each kind. */
export const KIND_PLURALS = {
  skill: 'skills',
  tool: 'tools',
  agent: 'agents',
  pattern: 'patterns',
  template: 'templates',
  project: 'projects',
} as const satisfies Record<EntityKind, string>;

export function kindFromPlural(plural: string): EntityKind | undefined {
  return EntityKind.options.find((k) => KIND_PLURALS[k] === plural);
}

/** Validate an entity of the given kind. */
export function parseEntity<K extends EntityKind>(kind: K, data: unknown): EntityByKind[K] {
  return ENTITY_SCHEMAS[kind].parse(data) as EntityByKind[K];
}

export function safeParseEntity<K extends EntityKind>(kind: K, data: unknown) {
  return ENTITY_SCHEMAS[kind].safeParse(data) as z.ZodSafeParseResult<EntityByKind[K]>;
}

/** Lightweight listing shape (what the index stores). */
export const EntitySummary = z.object({
  kind: EntityKind,
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
export type EntitySummary = z.infer<typeof EntitySummary>;
