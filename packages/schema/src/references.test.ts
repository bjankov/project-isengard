import { describe, expect, it } from 'vitest';
import {
  caseAvailable,
  defaultAccepted,
  enabledCases,
  type CascadeCase,
  type CascadePreview,
} from './cascade.js';
import { parseEntity } from './entities.js';
import { parseRefKey, refKey } from './ids.js';
import {
  collectRefs,
  isOutdated,
  localCopyEntries,
  localLookup,
  pruneLocal,
  refLocations,
  repin,
} from './references.js';
import { sampleAgent, samplePattern, sampleProject, sampleSkill } from './testing.js';

const agent = parseEntity('agent', { ...sampleAgent, id: 'planner-dddddd' });
const project = parseEntity('project', { ...sampleProject, id: 'demo-pppppp' });
const pattern = parseEntity('pattern', { ...samplePattern, id: 'maker-checker-ffffff' });
const skill = parseEntity('skill', { ...sampleSkill, id: 'write-unit-tests-aaaaaa' });

describe('ref keys', () => {
  it('round-trips', () => {
    const ref = { kind: 'agent' as const, id: 'planner-dddddd', version: 'fork-x-y' };
    expect(refKey(ref)).toBe('agent/planner-dddddd@fork-x-y');
    expect(parseRefKey(refKey(ref))).toEqual(ref);
    expect(parseRefKey('nonsense')).toBeUndefined();
  });
});

describe('ref locations', () => {
  it('lists an agent’s skills and tools', () => {
    expect(refLocations('agent', agent).map((l) => l.key)).toEqual(['skills/0', 'tools/0']);
  });

  it('lists workflow nodes that pin entities', () => {
    const locs = refLocations('project', project);
    expect(locs.length).toBeGreaterThan(0);
    for (const l of locs) expect(l.key.startsWith('node/')).toBe(true);
    expect(locs.map((l) => l.ref.kind)).toContain('agent');
  });

  it('repins one location and nothing else', () => {
    const next = repin('agent', agent, 'skills/0', 'v4');
    expect(next.skills[0]?.version).toBe('v4');
    expect(next.tools[0]?.version).toBe('v1');
    expect(agent.skills[0]?.version).toBe('v1');
    const [first] = refLocations('project', project);
    if (!first) throw new Error('no location');
    const moved = repin('project', project, first.key, 'v9');
    const after = refLocations('project', moved).find((l) => l.key === first.key);
    expect(after?.ref.version).toBe('v9');
    expect(moved.overrides).toEqual(project.overrides);
  });

  it('repins bindings of pattern instances', () => {
    const wf = parseEntity('project', {
      ...sampleProject,
      id: 'demo-pppppp',
      overrides: {},
      workflow: {
        nodes: [
          {
            id: 'mc',
            type: 'pattern',
            pattern: { kind: 'pattern', id: pattern.id, version: 'v1' },
            bindings: {
              maker: { kind: 'agent', agent: { kind: 'agent', id: agent.id, version: 'v1' } },
            },
          },
        ],
        edges: [],
      },
    });
    expect(refLocations('project', wf).map((l) => l.key)).toEqual([
      'node/mc',
      'node/mc/binding/maker',
    ]);
    const moved = repin('project', wf, 'node/mc/binding/maker', 'v2');
    const node = moved.workflow.nodes[0];
    expect(node?.type === 'pattern' && node.bindings.maker).toMatchObject({
      agent: { version: 'v2' },
    });
  });
});

describe('local copies', () => {
  it('resolve pinned references and count as references', () => {
    const ref = { kind: 'skill' as const, id: skill.id, version: 'v1' };
    const withCopy = { ...agent, ...localCopyEntries(ref, skill) };
    const lookup = localLookup([withCopy]);
    expect(lookup.copy(ref)?.name).toBe(skill.name);
    expect(lookup.copy({ ...ref, version: 'v2' })).toBeUndefined();
    expect(collectRefs('agent', withCopy).map(refKey)).toContain(refKey(ref));
  });

  it('move a copied entity’s own copies up next to it', () => {
    const skillRef = { kind: 'skill' as const, id: skill.id, version: 'v1' };
    const agentWithCopy = { ...agent, ...localCopyEntries(skillRef, skill) };
    const agentRef = { kind: 'agent' as const, id: agent.id, version: 'v2' };
    const entries = localCopyEntries(agentRef, agentWithCopy);
    expect(Object.keys(entries.localCopies).sort()).toEqual(
      [refKey(agentRef), refKey(skillRef)].sort(),
    );
    const copied = entries.localCopies[refKey(agentRef)];
    expect(copied?.kind === 'agent' && copied.entity.localCopies).toBeUndefined();
  });

  it('are pruned when nothing reaches them', () => {
    const ref = { kind: 'skill' as const, id: skill.id, version: 'v1' };
    const unused = { kind: 'skill' as const, id: 'other-skill-zzzzzz', version: 'v1' };
    const a = {
      ...agent,
      localCopies: {
        ...localCopyEntries(ref, skill).localCopies,
        ...localCopyEntries(unused, skill).localCopies,
      },
      deletedRefs: { [refKey(unused)]: { name: 'gone' } },
    };
    const pruned = pruneLocal('agent', a);
    expect(Object.keys(pruned.localCopies ?? {})).toEqual([refKey(ref)]);
    expect(pruned.deletedRefs).toBeUndefined();
  });
});

describe('cascade choices', () => {
  const c = (id: string, referrer: string, target: string, fork?: CascadeCase['fork']) =>
    ({
      id,
      referrer,
      target,
      fork,
      location: '',
      role: 'skill',
      label: '',
      from: 'v1',
      to: 'v2',
    }) as CascadeCase;
  const preview: CascadePreview = {
    roots: ['skill/s'],
    entities: [],
    cases: [
      c('a1', 'agent/a1', 'skill/s'),
      c('a2', 'agent/a2', 'skill/s'),
      c('p1', 'project/p1', 'agent/a1'),
      c('p2', 'project/p2', 'agent/a2'),
      c('f1', 'agent/a1#fork-x', 'skill/s', 'in-fork'),
    ],
  };

  it('accepts everything but forks by default', () => {
    expect([...defaultAccepted(preview)].sort()).toEqual(['a1', 'a2', 'p1', 'p2']);
  });

  it('drops cases whose target is declined', () => {
    const enabled = enabledCases(preview, new Set(['a2', 'p1', 'p2', 'f1']));
    expect([...enabled].sort()).toEqual(['a2', 'f1', 'p2']);
    const p1 = preview.cases.find((x) => x.id === 'p1');
    if (!p1) throw new Error();
    expect(caseAvailable(preview, p1, enabled)).toBe(false);
  });

  it('knows outdated pins', () => {
    expect(isOutdated('v1', 'v3')).toBe(true);
    expect(isOutdated('v3', 'v3')).toBe(false);
    expect(isOutdated('fork-a-b', 'v3')).toBe(false);
  });
});
