import { WorkflowGraph, analyzeLoops, type ContextMode, type WorkflowEdge } from '@app/schema';
import { sampleProject } from '@app/schema/testing';
import { describe, expect, it } from 'vitest';
import { describeIncoming, incomingEdges } from './describe-context';

const demo = WorkflowGraph.parse(sampleProject.workflow);
const loops = analyzeLoops(demo);

const withContext = (id: string, context: ContextMode, extra: Partial<WorkflowEdge> = {}) => {
  const g: WorkflowGraph = {
    ...demo,
    edges: demo.edges.map((e) => (e.id === id ? { ...e, context, ...extra } : e)),
  };
  const edge = g.edges.find((e) => e.id === id)!;
  return describeIncoming(g, edge, {
    loops: analyzeLoops(g),
    modelName: (m) => (m.model === 'claude-haiku-5-5' ? 'Haiku 5.5' : m.model),
  });
};

describe('describeIncoming', () => {
  it('describes each context mode in plain words', () => {
    // PLAN.md → Executor
    expect(withContext('e3', { mode: 'full' }).sentence).toBe('PLAN.md: in full');
    expect(withContext('e3', { mode: 'reference' }).sentence).toBe(
      'PLAN.md: as a workspace path only; the agent reads it on demand',
    );
    expect(
      withContext('e3', { mode: 'excerpt', selector: { kind: 'heading', heading: '## Tasks' } })
        .sentence,
    ).toBe('PLAN.md: only the section “## Tasks”');
    expect(
      withContext('e3', { mode: 'excerpt', selector: { kind: 'lines', start: 3, end: 9 } }).what,
    ).toBe('only lines 3–9');
    expect(
      withContext('e3', { mode: 'excerpt', selector: { kind: 'jsonPath', path: '$.tasks' } }).what,
    ).toBe('only $.tasks (JSON path)');
    expect(withContext('e3', { mode: 'diff', base: 'workspace-head' }).what).toBe(
      'only the changes since the workspace’s last commit',
    );
    expect(withContext('e3', { mode: 'diff', base: 'previous-iteration' }).what).toBe(
      'only what changed since the previous attempt',
    );
  });

  it('describes the loop-back feedback: through the decision, summarized, latest only', () => {
    const d = withContext('e7', {
      mode: 'summary',
      model: { provider: 'anthropic', model: 'claude-haiku-5-5' },
      instruction: '',
    });
    expect(d.source).toBe('Tool step’s result');
    expect(d.via).toBe('Decision → fail');
    expect(d.inLoop).toBe(true);
    expect(d.sentence).toBe(
      'Tool step’s result via Decision → fail: a summary by Haiku 5.5, latest attempt only, summarized when the workflow runs (v2)',
    );
    expect(
      withContext(
        'e7',
        { mode: 'summary', model: { provider: 'x', model: 'm' }, instruction: 'failures only' },
        { history: 'all' },
      ).sentence,
    ).toMatch(/a summary by m \(“failures only”\), all attempts/);
  });

  it('describes outcome-only and sequencing edges', () => {
    expect(withContext('e7', { mode: 'outcome-only' }).what).toBe(
      'only which exit of Decision was taken (“fail”), plus the evaluator’s notes; no content',
    );
    const seq = withContext('e3', { mode: 'full' }, { payload: 'none' });
    expect(seq.mode).toBe('sequencing');
    expect(seq.sentence).toBe('PLAN.md: nothing; it only starts after PLAN.md');
  });

  it('lists forward inputs before loop-backs', () => {
    expect(incomingEdges(demo, 'executor', loops).map((e) => e.id)).toEqual(['e3', 'e7']);
  });
});
