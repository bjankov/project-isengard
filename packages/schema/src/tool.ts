import { z } from 'zod';
import { EntityMeta } from './ids.js';

/** Built-in tools shipped with the app. Fixed catalog, not stored in the library. */
export const BuiltinToolId = z.enum([
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
  'shell',
  'web_search',
  'web_fetch',
]);
export type BuiltinToolId = z.infer<typeof BuiltinToolId>;

export type BuiltinScopeKind = 'paths' | 'commands' | 'domains';

export interface BuiltinTool {
  id: BuiltinToolId;
  name: string;
  description: string;
  scopeKind: BuiltinScopeKind;
}

export const BUILTIN_TOOLS: readonly BuiltinTool[] = [
  {
    id: 'read_file',
    name: 'Read file',
    description: 'Read files in the workspace.',
    scopeKind: 'paths',
  },
  {
    id: 'write_file',
    name: 'Write file',
    description: 'Create or overwrite files in the workspace.',
    scopeKind: 'paths',
  },
  {
    id: 'edit_file',
    name: 'Edit file',
    description: 'Edit existing files in the workspace.',
    scopeKind: 'paths',
  },
  {
    id: 'search_files',
    name: 'Search files',
    description: 'Glob and grep across workspace files.',
    scopeKind: 'paths',
  },
  {
    id: 'shell',
    name: 'Shell',
    description: 'Run shell commands in the workspace.',
    scopeKind: 'commands',
  },
  { id: 'web_search', name: 'Web search', description: 'Search the web.', scopeKind: 'domains' },
  { id: 'web_fetch', name: 'Web fetch', description: 'Fetch a web page.', scopeKind: 'domains' },
];

/** Workspace-relative glob. Absolute paths and parent traversal are rejected. */
export const WorkspaceGlob = z
  .string()
  .trim()
  .min(1)
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p), 'must be workspace-relative')
  .refine((p) => !p.split(/[\\/]/).includes('..'), 'must not contain ".."');

export const PathScope = z
  .object({
    paths: z.array(WorkspaceGlob).min(1),
  })
  .strict();
export type PathScope = z.infer<typeof PathScope>;

export const ShellCommandRule = z.object({
  match: z.enum(['exact', 'prefix']),
  command: z.string().trim().min(1),
});
export type ShellCommandRule = z.infer<typeof ShellCommandRule>;

/** An empty allowlist means unrestricted shell (allowed, but always flagged). */
export const ShellScope = z
  .object({
    commands: z.array(ShellCommandRule).default([]),
  })
  .strict();
export type ShellScope = z.infer<typeof ShellScope>;

export const Domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/,
    'expected a domain such as "example.com" or "*.example.com"',
  );

export const DomainScope = z
  .object({
    allow: z.array(Domain).default([]),
    deny: z.array(Domain).default([]),
  })
  .strict();
export type DomainScope = z.infer<typeof DomainScope>;

const presetBase = EntityMeta;

export const ToolPreset = z.discriminatedUnion('builtin', [
  presetBase.extend({ builtin: z.literal('read_file'), scope: PathScope }),
  presetBase.extend({ builtin: z.literal('write_file'), scope: PathScope }),
  presetBase.extend({ builtin: z.literal('edit_file'), scope: PathScope }),
  presetBase.extend({ builtin: z.literal('search_files'), scope: PathScope }),
  presetBase.extend({ builtin: z.literal('shell'), scope: ShellScope }),
  presetBase.extend({ builtin: z.literal('web_search'), scope: DomainScope }),
  presetBase.extend({ builtin: z.literal('web_fetch'), scope: DomainScope }),
]);
export type ToolPreset = z.infer<typeof ToolPreset>;

/** Unrestricted shell bypasses every other restriction and must be flagged wherever it appears. */
export function isUnrestrictedShell(preset: ToolPreset): boolean {
  return preset.builtin === 'shell' && preset.scope.commands.length === 0;
}

export function builtinTool(id: BuiltinToolId): BuiltinTool {
  const tool = BUILTIN_TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`unknown built-in tool "${id}"`);
  return tool;
}

const PATH_VERBS: Record<'read_file' | 'write_file' | 'edit_file' | 'search_files', string> = {
  read_file: 'read',
  write_file: 'write',
  edit_file: 'edit',
  search_files: 'search',
};

function formatShellRule(rule: ShellCommandRule): string {
  return rule.match === 'exact' ? rule.command : `${rule.command} …`;
}

export interface ScopeDescription {
  /** One line in plain words, e.g. "read src/**, docs/**". */
  summary: string;
  /** Individual items (globs, commands, domains) for chip-style display. */
  items: string[];
  unrestricted: boolean;
}

/** Plain-language description of what a preset allows. */
export function describeScope(preset: ToolPreset): ScopeDescription {
  switch (preset.builtin) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'search_files': {
      const items = preset.scope.paths;
      return {
        summary: `${PATH_VERBS[preset.builtin]} ${items.join(', ')}`,
        items,
        unrestricted: false,
      };
    }
    case 'shell': {
      const items = preset.scope.commands.map(formatShellRule);
      return items.length === 0
        ? { summary: 'shell: any command (unrestricted)', items, unrestricted: true }
        : { summary: `shell: ${items.join(', ')}`, items, unrestricted: false };
    }
    case 'web_search':
    case 'web_fetch': {
      const { allow, deny } = preset.scope;
      const verb = preset.builtin === 'web_search' ? 'search' : 'fetch';
      let summary = `${verb} any domain`;
      if (allow.length > 0) summary = `${verb} only ${allow.join(', ')}`;
      if (deny.length > 0) summary += ` except ${deny.join(', ')}`;
      return { summary, items: [...allow, ...deny.map((d) => `not ${d}`)], unrestricted: false };
    }
  }
}
