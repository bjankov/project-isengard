import { describe, expect, it } from 'vitest';
import {
  ENTITY_KINDS,
  EntityId,
  ToolPreset,
  Version,
  WorkflowGraph,
  collectRefs,
  isUnrestrictedShell,
  kindFromPlural,
  makeEntityId,
  parseEntity,
  safeParseEntity,
  slugify,
} from './index.js';
import { SAMPLE_INPUTS, sampleShellTool } from './testing.js';

describe('ids', () => {
  it('slugifies names', () => {
    expect(slugify('Code Review — Checklist!')).toBe('code-review-checklist');
    expect(slugify('Čevapi Ž')).toBe('cevapi-z');
    expect(slugify('???')).toBe('entity');
  });

  it('makes valid, unique entity ids', () => {
    const a = makeEntityId('Planner');
    const b = makeEntityId('Planner');
    expect(a).toMatch(/^planner-[a-z0-9]{6}$/);
    expect(a).not.toBe(b);
    expect(EntityId.safeParse(a).success).toBe(true);
    expect(EntityId.safeParse(makeEntityId('!!!')).success).toBe(true);
    expect(EntityId.safeParse('Planner').success).toBe(false);
  });

  it('accepts main versions and branch names', () => {
    expect(Version.safeParse('v3').success).toBe(true);
    expect(Version.safeParse('draft').success).toBe(true);
    expect(Version.safeParse('v0').success).toBe(false);
    expect(Version.safeParse('has space').success).toBe(false);
  });

  it('maps API plurals to kinds', () => {
    expect(kindFromPlural('agents')).toBe('agent');
    expect(kindFromPlural('nope')).toBeUndefined();
  });
});

describe('entities', () => {
  it.each(ENTITY_KINDS)('parses the sample %s and is stable under re-parse', (kind) => {
    const parsed = parseEntity(kind, { ...SAMPLE_INPUTS[kind], id: makeEntityId('x') });
    expect(parseEntity(kind, JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('rejects skill names that break the Agent Skills format', () => {
    const r = safeParseEntity('skill', { ...SAMPLE_INPUTS.skill, id: 'a-aaaaaa', name: 'Write Tests' });
    expect(r.success).toBe(false);
  });

  it('flags shell presets without an allowlist as unrestricted', () => {
    const restricted = ToolPreset.parse({ ...sampleShellTool, id: 'a-aaaaaa' });
    const open = ToolPreset.parse({ ...sampleShellTool, id: 'a-aaaaaa', scope: {} });
    expect(isUnrestrictedShell(restricted)).toBe(false);
    expect(isUnrestrictedShell(open)).toBe(true);
  });

  it('rejects path scopes outside the workspace', () => {
    for (const bad of ['/etc/**', '../secrets', 'src/../../x']) {
      const r = ToolPreset.safeParse({ id: 'a-aaaaaa', name: 'x', builtin: 'read_file', scope: { paths: [bad] } });
      expect(r.success, bad).toBe(false);
    }
  });

  it('rejects scope shapes that do not match the built-in', () => {
    const r = ToolPreset.safeParse({ id: 'a-aaaaaa', name: 'x', builtin: 'shell', scope: { paths: ['src/**'] } });
    expect(r.success).toBe(false);
    const r2 = ToolPreset.safeParse({ id: 'a-aaaaaa', name: 'x', builtin: 'read_file', scope: { commands: [] } });
    expect(r2.success).toBe(false);
  });

  it('only allows model, effort and limits in overrides', () => {
    const r = safeParseEntity('project', {
      ...SAMPLE_INPUTS.project,
      id: 'p-aaaaaa',
      overrides: { executor: { prompt: 'sneaky' } },
    });
    expect(r.success).toBe(false);
  });
});

describe('workflow graph', () => {
  it('rejects duplicate node ids and dangling edges', () => {
    const r = WorkflowGraph.safeParse({
      nodes: [
        { id: 'a', type: 'note', text: '' },
        { id: 'a', type: 'note', text: '' },
      ],
      edges: [{ id: 'e', source: { node: 'a' }, target: { node: 'zzz' }, payload: 'none', context: { mode: 'full' } }],
    });
    expect(r.success).toBe(false);
    const messages = r.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('duplicate node id "a"');
    expect(messages).toContain('unknown node "zzz"');
  });

  it('requires a config for configurable context modes', () => {
    const r = WorkflowGraph.safeParse({
      nodes: [
        { id: 'a', type: 'note' },
        { id: 'b', type: 'note' },
      ],
      edges: [{ id: 'e', source: { node: 'a' }, target: { node: 'b' }, payload: 'text', context: { mode: 'excerpt' } }],
    });
    expect(r.success).toBe(false);
  });
});

describe('collectRefs', () => {
  it('collects agent skill and tool refs', () => {
    const agent = parseEntity('agent', { ...SAMPLE_INPUTS.agent, id: 'planner-aaaaaa' });
    expect(collectRefs('agent', agent).map((r) => r.kind)).toEqual(['skill', 'tool']);
  });

  it('collects refs from every node kind that has them, deduplicated', () => {
    const t = parseEntity('template', { ...SAMPLE_INPUTS.template, id: 't-aaaaaa' });
    const refs = collectRefs('template', t).map((r) => `${r.kind}/${r.id}@${r.version}`);
    expect(refs).toEqual(['agent/planner-dddddd@v1', 'pattern/maker-checker-ffffff@v1', 'agent/executor-eeeeee@v1']);
  });

  it('includes slot default agents in patterns', () => {
    const p = parseEntity('pattern', { ...SAMPLE_INPUTS.pattern, id: 'p-aaaaaa' });
    expect(collectRefs('pattern', p)).toEqual([{ kind: 'agent', id: 'executor-eeeeee', version: 'v1' }]);
  });
});
