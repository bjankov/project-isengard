import { BUILTIN_PATTERN_IDS, DEMO_IDS } from '@app/schema';

/**
 * A 100-node project body (PLAN.md 11, M7: "performance on a 100-node workflow"), built from
 * the demo agents: 20 rounds of agent → artifact → reviewer → capped decision looping back,
 * 4 Maker-checker instances between rounds, the rest notes. Laid out on a 12-column grid.
 */
export function hundredNodeProject(workspacePath: string) {
  const agent = (id: string) => ({ kind: 'agent', agent: { kind: 'agent', id, version: 'v1' } });
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  const add = (n: Record<string, unknown> & { id: string }) => {
    nodes.push(n);
    return n.id;
  };
  const edge = (
    from: string,
    to: string,
    o: { fromPort?: string; toPort?: string; payload?: string; history?: string } = {},
  ) =>
    edges.push({
      id: `e${String(edges.length)}`,
      source: o.fromPort ? { node: from, port: o.fromPort } : { node: from },
      target: o.toPort ? { node: to, port: o.toPort } : { node: to },
      payload: o.payload ?? 'text',
      context: { mode: 'full' },
      ...(o.history ? { history: o.history } : {}),
    });

  let prev = add({ id: 'in', type: 'input', name: 'Task', payloadType: 'text', content: 'Go' });
  let prevPort: string | undefined;
  for (let k = 0; k < 20; k++) {
    if (k > 0 && k % 5 === 0) {
      const p = add({
        id: `mc${String(k)}`,
        type: 'pattern',
        pattern: { kind: 'pattern', id: BUILTIN_PATTERN_IDS.makerChecker, version: 'v1' },
        bindings: {
          maker: agent(DEMO_IDS.agents.executor),
          checker: agent(DEMO_IDS.agents.reviewer),
        },
      });
      edge(prev, p, { ...(prevPort ? { fromPort: prevPort } : {}), toPort: 'in' });
      prev = p;
      prevPort = 'out';
    }
    const a = add({ id: `a${String(k)}`, type: 'agent', binding: agent(DEMO_IDS.agents.executor) });
    edge(prev, a, prevPort ? { fromPort: prevPort } : {});
    const f = add({
      id: `f${String(k)}`,
      type: 'artifact',
      path: `src/m${String(k)}/**`,
      fileType: 'code',
    });
    edge(a, f);
    const t = add({ id: `t${String(k)}`, type: 'agent', binding: agent(DEMO_IDS.agents.reviewer) });
    edge(f, t, { payload: 'file' });
    const d = add({
      id: `d${String(k)}`,
      type: 'decision',
      label: `ok ${String(k)}?`,
      evaluator: { type: 'human', instructions: 'Check the change.' },
      exits: [
        { id: 'pass', label: 'pass' },
        { id: 'fail', label: 'fail', maxIterations: 3 },
      ],
    });
    edge(t, d);
    edge(d, a, { fromPort: 'fail', history: 'latest' });
    prev = d;
    prevPort = 'pass';
  }
  const out = add({ id: 'out', type: 'output', name: 'Result', payloadType: 'text' });
  edge(prev, out, { fromPort: 'pass' });
  while (nodes.length < 100)
    add({ id: `note${String(nodes.length)}`, type: 'note', text: 'A note' });

  const layout: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n, i) => {
    layout[n.id as string] = { x: (i % 12) * 288, y: Math.floor(i / 12) * 208 };
  });
  return {
    name: 'Hundred nodes',
    description: 'A large workflow, to check the canvas stays responsive.',
    workspacePath,
    workflow: { nodes, edges },
    layout: { nodes: layout },
  };
}
