import { z } from 'zod';
import { EntityMeta, RefKey, SkillRef, ToolRef } from './ids.js';
import { Skill } from './skill.js';
import { ToolPreset } from './tool.js';

/** Provider + model id. The available list is a static, user-editable list in Settings. */
export const ModelRef = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
});
export type ModelRef = z.infer<typeof ModelRef>;

export const Effort = z.enum(['low', 'medium', 'high']);
export type Effort = z.infer<typeof Effort>;

export const Limits = z.object({
  maxIterations: z.int().positive(),
  maxTokens: z.int().positive(),
  maxWallTimeSeconds: z.int().positive(),
});
export type Limits = z.infer<typeof Limits>;

export const AgentDefaults = z.object({
  model: ModelRef,
  effort: Effort,
  limits: Limits,
});
export type AgentDefaults = z.infer<typeof AgentDefaults>;

/**
 * A placeholder for a referenced entity that was deleted (PLAN.md 8.4, "replace with a
 * placeholder"). The reference stays where it was and resolves to nothing; the placeholder
 * keeps the last known name so the editor can say what is gone.
 */
export const DeletedRef = z.object({ name: z.string() });
export type DeletedRef = z.infer<typeof DeletedRef>;

/** Content of a deleted skill or tool preset an agent keeps as a local copy (PLAN.md 8.4). */
export const AgentLocalCopy = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skill'), entity: Skill }),
  z.object({ kind: z.literal('tool'), entity: ToolPreset }),
]);
export type AgentLocalCopy = z.infer<typeof AgentLocalCopy>;

export const Agent = EntityMeta.extend({
  prompt: z.string().default(''),
  skills: z.array(SkillRef).default([]),
  tools: z.array(ToolRef).default([]),
  defaults: AgentDefaults,
  /**
   * Deleted entities this agent keeps working with, keyed by the pinned reference
   * (`skill/<id>@v2`). References resolve here first. Versions are immutable, so a copy is
   * exactly what the reference pinned.
   */
  localCopies: z.record(RefKey, AgentLocalCopy).optional(),
  /** Deleted entities replaced by a placeholder, keyed by the pinned reference. */
  deletedRefs: z.record(RefKey, DeletedRef).optional(),
});
export type Agent = z.infer<typeof Agent>;

/**
 * Per-project override of an agent instance. Only model, effort and limits may be overridden;
 * changing prompt, skills or tools forks the agent instead.
 */
export const AgentOverride = z
  .object({
    model: ModelRef.optional(),
    effort: Effort.optional(),
    limits: Limits.partial().optional(),
  })
  .strict();
export type AgentOverride = z.infer<typeof AgentOverride>;
