/**
 * Arguments of tool steps (a tool preset run directly, without an agent): which ones each
 * built-in takes, and whether a step's arguments are complete and inside what its preset allows.
 * A step that fails these checks can be saved but not merged, because v2 couldn't run it.
 */
import { anyGlobCovers } from './glob.js';
import {
  WorkspaceGlob,
  type BuiltinToolId,
  type DomainScope,
  type ShellScope,
  type ToolPreset,
} from './tool.js';

export interface ToolStepArg {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
}

export const TOOL_STEP_ARGS: Record<BuiltinToolId, readonly ToolStepArg[]> = {
  shell: [{ key: 'command', label: 'Command', placeholder: 'npm test', required: true }],
  read_file: [{ key: 'path', label: 'Path', placeholder: 'src/index.ts', required: true }],
  write_file: [{ key: 'path', label: 'Path', placeholder: 'out/report.md', required: true }],
  edit_file: [{ key: 'path', label: 'Path', placeholder: 'src/index.ts', required: true }],
  search_files: [
    { key: 'pattern', label: 'Pattern', placeholder: 'TODO', required: true },
    { key: 'path', label: 'In path', placeholder: 'src/', required: false },
  ],
  web_search: [
    { key: 'query', label: 'Query', placeholder: 'latest release notes', required: true },
  ],
  web_fetch: [{ key: 'url', label: 'URL', placeholder: 'https://example.com', required: true }],
};

/** Characters that chain, pipe, redirect or substitute commands in a shell. */
const SHELL_CONTROL = /[;&|<>`\n]|\$\(/;

/**
 * Whether a restricted shell allows `command`: it equals an exact rule, or starts with a prefix
 * rule followed by a space. Commands that chain or redirect are never allowed by a restricted
 * shell, since `npm test && rm -rf .` would otherwise pass as "npm test …".
 */
export function shellAllows(scope: ShellScope, command: string): boolean {
  if (scope.commands.length === 0) return true;
  const cmd = command.trim().replace(/\s+/g, ' ');
  if (SHELL_CONTROL.test(cmd)) return false;
  return scope.commands.some((rule) => {
    const allowed = rule.command.trim().replace(/\s+/g, ' ');
    return rule.match === 'exact'
      ? cmd === allowed
      : cmd === allowed || cmd.startsWith(`${allowed} `);
  });
}

/** `example.com` matches only that host; `*.example.com` matches its subdomains, any depth. */
function domainMatches(domain: string, host: string): boolean {
  return domain.startsWith('*.') ? host.endsWith(domain.slice(1)) : host === domain;
}

/** Whether a domain scope allows `host`: not denied, and allowed when an allow list is set. */
export function domainAllows(scope: DomainScope, host: string): boolean {
  const h = host.toLowerCase();
  if (scope.deny.some((d) => domainMatches(d, h))) return false;
  return scope.allow.length === 0 || scope.allow.some((d) => domainMatches(d, h));
}

/**
 * What is wrong with a tool step's arguments for `preset`, one sentence each (empty when
 * nothing is). `step` names the step in the messages.
 */
export function toolStepArgProblems(
  preset: ToolPreset,
  args: Record<string, string>,
  step: string,
): string[] {
  const problems: string[] = [];
  for (const arg of TOOL_STEP_ARGS[preset.builtin]) {
    if (arg.required && !args[arg.key]?.trim()) {
      problems.push(`${step} has no ${arg.label.toLowerCase()} yet.`);
    }
  }
  const value = (key: string) => args[key]?.trim() ?? '';
  switch (preset.builtin) {
    case 'shell': {
      const command = value('command');
      if (command && !shellAllows(preset.scope, command)) {
        problems.push(
          SHELL_CONTROL.test(command)
            ? `${step} chains or redirects commands, which ${preset.name} doesn’t allow.`
            : `${step} runs “${command}”, which ${preset.name} doesn’t allow.`,
        );
      }
      break;
    }
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'search_files': {
      const path = value('path').replace(/\/+$/, '');
      if (!path) break;
      if (!WorkspaceGlob.safeParse(path).success) {
        problems.push(`${step}: the path must be inside the workspace, without “..”.`);
        break;
      }
      // Searching a folder needs the whole folder.
      const target = preset.builtin === 'search_files' ? `${path}/**` : path;
      if (!anyGlobCovers(preset.scope.paths, target)) {
        problems.push(`${step}: ${preset.name} doesn’t cover “${value('path')}”.`);
      }
      break;
    }
    case 'web_fetch': {
      const url = value('url');
      if (!url) break;
      let host: string | undefined;
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') host = parsed.hostname;
      } catch {
        // not a URL
      }
      if (host === undefined) {
        problems.push(`${step}: “${url}” isn’t an http or https URL.`);
      } else if (!domainAllows(preset.scope, host)) {
        problems.push(`${step}: ${preset.name} doesn’t allow ${host}.`);
      }
      break;
    }
    case 'web_search':
      // The domain lists limit which results may be used; the query itself can't break them.
      break;
  }
  return problems;
}
