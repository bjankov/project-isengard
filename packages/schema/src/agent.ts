import { z } from 'zod';
import { EntityMeta, SkillRef, ToolRef } from './ids.js';

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

export const Agent = EntityMeta.extend({
  prompt: z.string().default(''),
  skills: z.array(SkillRef).default([]),
  tools: z.array(ToolRef).default([]),
  defaults: AgentDefaults,
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
