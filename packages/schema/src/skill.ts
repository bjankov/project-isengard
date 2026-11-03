import { z } from 'zod';
import { EntityId } from './ids.js';

/**
 * A skill in the Agent Skills format: `SKILL.md` with `name` and `description` frontmatter
 * and a markdown body. The entity id is the folder name and is not part of the frontmatter.
 */
export const SkillName = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'skill names use lowercase letters, digits and single hyphens (Agent Skills standard)',
  );

export const Skill = z.object({
  id: EntityId,
  name: SkillName,
  description: z.string().trim().min(1).max(1024),
  body: z.string().default(''),
});
export type Skill = z.infer<typeof Skill>;
