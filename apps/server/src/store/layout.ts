/**
 * How each entity kind is laid out as files in the library store (PLAN.md 5.4).
 * The entity id is never written into the files; it is the file or folder name.
 */
import type { EntityByKind, EntityKind } from '@app/schema';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export type FileMap = Record<string, string>;

export interface KindLayout<K extends EntityKind> {
  /** Top-level folder of this kind. */
  dir: string;
  /** Path (file or folder) owned by the entity. Deleting the entity removes it. */
  root(id: string): string;
  /** Id from a direct child name of `dir`, or undefined if the child is not an entity. */
  idFromChild(child: string): string | undefined;
  /** Files written on create/update, relative to the library root. */
  serialize(entity: EntityByKind[K]): FileMap;
  /** Files needed to read the entity. */
  files(id: string): string[];
  /** Rebuild the (unvalidated) entity from file contents keyed like `files(id)`. */
  deserialize(id: string, files: Record<string, string | undefined>): unknown;
}

export function toYaml(value: unknown): string {
  return stringifyYaml(value, { lineWidth: 0, aliasDuplicateObjects: false });
}

export function fromYaml(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  const v: unknown = parseYaml(text);
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fromJson(text: string | undefined): unknown {
  return text === undefined ? undefined : JSON.parse(text);
}

// ---- SKILL.md frontmatter ----

/** Opening `---`, YAML, closing `---` at the start of its own line, then the body. */
const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)([\s\S]*)$/;

export function writeSkillMd(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${toYaml(frontmatter)}---\n\n${body}`;
}

export function readSkillMd(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = FRONTMATTER.exec(text);
  if (!m) return { frontmatter: {}, body: text };
  return { frontmatter: fromYaml(m[1] ?? ''), body: (m[2] ?? '').replace(/^\r?\n/, '') };
}

// ---- Layouts ----

function fileLayout<K extends EntityKind>(dir: string): KindLayout<K> {
  const path = (id: string) => `${dir}/${id}.yaml`;
  return {
    dir,
    root: path,
    idFromChild: (child) => (child.endsWith('.yaml') ? child.slice(0, -'.yaml'.length) : undefined),
    serialize: (entity) => {
      const { id, ...rest } = entity;
      return { [path(id)]: toYaml(rest) };
    },
    files: (id) => [path(id)],
    deserialize: (id, files) => ({ ...fromYaml(files[path(id)]), id }),
  };
}

const skills: KindLayout<'skill'> = {
  dir: 'skills',
  root: (id) => `skills/${id}`,
  idFromChild: (child) => child,
  serialize: ({ id, name, description, body }) => ({
    [`skills/${id}/SKILL.md`]: writeSkillMd({ name, description }, body),
  }),
  files: (id) => [`skills/${id}/SKILL.md`],
  deserialize: (id, files) => {
    const text = files[`skills/${id}/SKILL.md`];
    if (text === undefined) return { id };
    const { frontmatter, body } = readSkillMd(text);
    return { id, name: frontmatter.name, description: frontmatter.description, body };
  },
};

/** Patterns and templates: one semantics YAML + layout.json. */
function graphLayout<K extends 'pattern' | 'template'>(dir: string, file: string): KindLayout<K> {
  const sem = (id: string) => `${dir}/${id}/${file}`;
  const lay = (id: string) => `${dir}/${id}/layout.json`;
  return {
    dir,
    root: (id) => `${dir}/${id}`,
    idFromChild: (child) => child,
    serialize: (entity) => {
      const { id, name, description, workflow, layout } = entity;
      return { [sem(id)]: toYaml({ name, description, ...workflow }), [lay(id)]: toJson(layout) };
    },
    files: (id) => [sem(id), lay(id)],
    deserialize: (id, files) => {
      const { name, description, nodes, edges } = fromYaml(files[sem(id)]);
      return {
        id,
        name,
        description,
        workflow: { nodes, edges },
        layout: fromJson(files[lay(id)]) ?? {},
      };
    },
  };
}

const projects: KindLayout<'project'> = {
  dir: 'projects',
  root: (id) => `projects/${id}`,
  idFromChild: (child) => child,
  serialize: ({ id, workflow, layout, ...rest }) => ({
    [`projects/${id}/project.yaml`]: toYaml(rest),
    [`projects/${id}/workflow.yaml`]: toYaml(workflow),
    [`projects/${id}/layout.json`]: toJson(layout),
  }),
  files: (id) => [
    `projects/${id}/project.yaml`,
    `projects/${id}/workflow.yaml`,
    `projects/${id}/layout.json`,
  ],
  deserialize: (id, files) => ({
    ...fromYaml(files[`projects/${id}/project.yaml`]),
    id,
    workflow: fromYaml(files[`projects/${id}/workflow.yaml`]),
    layout: fromJson(files[`projects/${id}/layout.json`]) ?? {},
  }),
};

export const LAYOUTS: { [K in EntityKind]: KindLayout<K> } = {
  skill: skills,
  tool: fileLayout('tools'),
  agent: fileLayout('agents'),
  pattern: graphLayout('patterns', 'pattern.yaml'),
  template: graphLayout('templates', 'workflow.yaml'),
  project: projects,
};
