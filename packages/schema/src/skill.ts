import { z } from 'zod';
import { EntityId } from './ids.js';

/**
 * A skill in the Agent Skills format: `SKILL.md` with YAML frontmatter and a markdown body.
 * Required frontmatter: `name`, `description`. Optional: `license`, `compatibility`, `metadata`,
 * `allowed-tools`. Any other frontmatter keys are preserved verbatim in `extraFrontmatter`.
 * The entity id is the folder name and is not part of the frontmatter.
 */
export const SkillName = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'skill names use lowercase letters, digits and single hyphens (Agent Skills standard)',
  );

/** Frontmatter keys with a dedicated field; they may not appear in `extraFrontmatter`. */
export const SKILL_STANDARD_KEYS = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
] as const;

export const Skill = z.object({
  id: EntityId,
  name: SkillName,
  description: z.string().trim().min(1).max(1024),
  /** License name, or a reference to a license file bundled with the skill. */
  license: z.string().trim().min(1).optional(),
  /** Environment requirements, e.g. required system packages or network access. */
  compatibility: z.string().trim().min(1).max(500).optional(),
  /** Arbitrary string key/value pairs. */
  metadata: z
    .record(z.string().trim().min(1, 'metadata keys cannot be empty'), z.string())
    .optional(),
  /**
   * Tools the skill expects to be pre-approved (`allowed-tools`, experimental in the standard).
   * Informational in this app: an agent's tool access comes only from its tool presets.
   */
  allowedTools: z.array(z.string().trim().min(1)).optional(),
  /** Any other frontmatter keys, preserved as written. */
  extraFrontmatter: z
    .record(z.string(), z.unknown())
    .optional()
    .superRefine((extra, ctx) => {
      for (const key of Object.keys(extra ?? {})) {
        if ((SKILL_STANDARD_KEYS as readonly string[]).includes(key)) {
          ctx.addIssue({
            code: 'custom',
            message: `"${key}" has its own field; remove it from the other fields`,
            path: [key],
          });
        }
      }
    }),
  body: z.string().default(''),
});
export type Skill = z.infer<typeof Skill>;
