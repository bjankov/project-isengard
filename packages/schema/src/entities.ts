import { z } from 'zod';
import { Agent, AgentDefaults, AgentOverride, ModelRef } from './agent.js';
import { EntityKind, EntityMeta, LocalId, type Ref } from './ids.js';
import { Skill } from './skill.js';
import { ToolPreset } from './tool.js';
import { Layout, WorkflowGraph } from './workflow/graph.js';
import type { AgentBinding, WorkflowNode } from './workflow/nodes.js';

/**
 * A reusable sub-graph. Input/Output nodes are its ports; agent nodes bound to slots are its
 * slots. Patterns may contain other patterns.
 */
export const Pattern = EntityMeta.extend({
  workflow: WorkflowGraph,
  layout: Layout,
});
export type Pattern = z.infer<typeof Pattern>;

/** A saved workflow that new projects can start from. */
export const Template = EntityMeta.extend({
  workflow: WorkflowGraph,
  layout: Layout,
});
export type Template = z.infer<typeof Template>;

/** One project = one workflow, plus a workspace repo and per-instance overrides. */
export const Project = EntityMeta.extend({
  /** Absolute path of the workspace git repo (validated by the server). */
  workspacePath: z.string().trim().min(1),
  /** Overrides keyed by agent-node id. */
  overrides: z.record(LocalId, AgentOverride).default({}),
  workflow: WorkflowGraph,
  layout: Layout,
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

// ---- References ----

function bindingRefs(b: AgentBinding): Ref[] {
  if (b.kind === 'agent') return [b.agent];
  return b.defaultAgent ? [b.defaultAgent] : [];
}

function nodeRefs(n: WorkflowNode): Ref[] {
  switch (n.type) {
    case 'agent':
      return bindingRefs(n.binding);
    case 'decision':
      return n.evaluator.type === 'agent' ? bindingRefs(n.evaluator.agent) : [];
    case 'toolStep':
      return [n.tool];
    case 'pattern':
      return [n.pattern, ...Object.values(n.bindings).flatMap(bindingRefs)];
    default:
      return [];
  }
}

/** Every outgoing reference from an entity to another library entity (direct, not transitive). */
export function collectRefs<K extends EntityKind>(kind: K, entity: EntityByKind[K]): Ref[] {
  let refs: Ref[];
  switch (kind) {
    case 'agent': {
      const a = entity as Agent;
      refs = [...a.skills, ...a.tools];
      break;
    }
    case 'pattern':
    case 'template':
    case 'project':
      refs = (entity as Pattern | Template | Project).workflow.nodes.flatMap(nodeRefs);
      break;
    default:
      refs = [];
  }
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.kind}/${r.id}@${r.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
