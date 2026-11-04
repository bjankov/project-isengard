/**
 * SKILL.md codec, shared by the server (files on disk) and the web app (raw SKILL.md editing),
 * so both always produce identical files.
 */
import { YAMLParseError, parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { SKILL_STANDARD_KEYS, type Skill } from './skill.js';

/** A skill's content without its id (what SKILL.md holds). */
export type SkillContent = Omit<Skill, 'id'>;

export class SkillMdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillMdError';
  }
}

export function toYaml(value: unknown): string {
  return stringifyYaml(value, { lineWidth: 0, aliasDuplicateObjects: false });
}

function parseYamlMapping(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (err) {
    const msg = err instanceof YAMLParseError ? err.message.split('\n')[0] : String(err);
    throw new SkillMdError(`${what} is not valid YAML: ${msg}`);
  }
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SkillMdError(`${what} must be a set of "key: value" lines`);
  }
  return value as Record<string, unknown>;
}

/** Opening `---`, YAML, closing `---` at the start of its own line, then the body. */
const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)([\s\S]*)$/;

export function splitFrontmatter(text: string): { yaml: string | undefined; body: string } {
  const m = FRONTMATTER.exec(text);
  if (!m) return { yaml: undefined, body: text };
  return { yaml: m[1] ?? '', body: (m[2] ?? '').replace(/^\r?\n/, '') };
}

/**
 * `allowed-tools` is space-delimited. Spaces inside parentheses belong to one entry,
 * e.g. `Bash(git commit:*) Read` → ["Bash(git commit:*)", "Read"].
 */
export function parseAllowedTools(value: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

export function formatAllowedTools(tools: string[]): string {
  return tools.join(' ');
}

const isScalar = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** Frontmatter object in the standard key order, omitting empty optional fields. */
export function skillFrontmatter(skill: SkillContent): Record<string, unknown> {
  const fm: Record<string, unknown> = { name: skill.name, description: skill.description };
  if (skill.license) fm.license = skill.license;
  if (skill.compatibility) fm.compatibility = skill.compatibility;
  if (skill.metadata && Object.keys(skill.metadata).length > 0) fm.metadata = skill.metadata;
  if (skill.allowedTools && skill.allowedTools.length > 0) {
    fm['allowed-tools'] = formatAllowedTools(skill.allowedTools);
  }
  return { ...fm, ...skill.extraFrontmatter };
}

export function skillToMarkdown(skill: SkillContent): string {
  return `---\n${toYaml(skillFrontmatter(skill))}---\n\n${skill.body}`;
}

/**
 * Parse SKILL.md text into (unvalidated) skill content. Throws SkillMdError when the
 * frontmatter is not valid YAML. Scalar metadata values are read as strings.
 */
export function skillFromMarkdown(text: string): Record<string, unknown> {
  const { yaml, body } = splitFrontmatter(text);
  const fm = yaml === undefined ? {} : parseYamlMapping(yaml, 'The frontmatter');
  const out: Record<string, unknown> = { name: fm.name, description: fm.description };

  if (fm.license !== undefined && fm.license !== null) {
    out.license = isScalar(fm.license) ? String(fm.license) : fm.license;
  }
  if (fm.compatibility !== undefined && fm.compatibility !== null) {
    out.compatibility = isScalar(fm.compatibility) ? String(fm.compatibility) : fm.compatibility;
  }
  if (fm.metadata !== undefined && fm.metadata !== null) {
    const m = fm.metadata;
    out.metadata =
      typeof m === 'object' && !Array.isArray(m)
        ? Object.fromEntries(
            Object.entries(m as Record<string, unknown>).map(([k, v]) => [
              k,
              isScalar(v) ? String(v) : v,
            ]),
          )
        : m;
  }
  const tools = fm['allowed-tools'];
  if (typeof tools === 'string') out.allowedTools = parseAllowedTools(tools);
  else if (Array.isArray(tools)) out.allowedTools = tools.map(String);
  else if (tools !== undefined && tools !== null) out.allowedTools = tools;

  const extra = Object.fromEntries(
    Object.entries(fm).filter(([k]) => !(SKILL_STANDARD_KEYS as readonly string[]).includes(k)),
  );
  if (Object.keys(extra).length > 0) out.extraFrontmatter = extra;
  out.body = body;
  return out;
}

/** The "other fields" YAML shown in the editor. Empty string when there are none. */
export function extraFrontmatterToYaml(extra: Record<string, unknown> | undefined): string {
  return extra && Object.keys(extra).length > 0 ? toYaml(extra) : '';
}

/** Parse the "other fields" YAML. Throws SkillMdError when it is not a YAML mapping. */
export function extraFrontmatterFromYaml(text: string): Record<string, unknown> | undefined {
  const value = parseYamlMapping(text, 'Other fields');
  return Object.keys(value).length > 0 ? value : undefined;
}
