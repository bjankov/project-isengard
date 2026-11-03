import { z } from 'zod';
import { LocalId } from '../ids.js';
import { WorkflowEdge } from './edges.js';
import { WorkflowNode } from './nodes.js';

/**
 * Graph semantics (nodes + edges). Structural integrity (unique ids, edges pointing at existing
 * nodes) is checked here; workflow rules (caps, reachability, tool coverage…) are validation.
 */
export const WorkflowGraph = z
  .object({
    nodes: z.array(WorkflowNode).default([]),
    edges: z.array(WorkflowEdge).default([]),
  })
  .superRefine((g, ctx) => {
    const nodeIds = new Set<string>();
    g.nodes.forEach((n, i) => {
      if (nodeIds.has(n.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate node id "${n.id}"`, path: ['nodes', i, 'id'] });
      }
      nodeIds.add(n.id);
    });
    const edgeIds = new Set<string>();
    g.edges.forEach((e, i) => {
      if (edgeIds.has(e.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate edge id "${e.id}"`, path: ['edges', i, 'id'] });
      }
      edgeIds.add(e.id);
      for (const end of ['source', 'target'] as const) {
        if (!nodeIds.has(e[end].node)) {
          ctx.addIssue({
            code: 'custom',
            message: `edge "${e.id}" ${end} references unknown node "${e[end].node}"`,
            path: ['edges', i, end, 'node'],
          });
        }
      }
    });
  });
export type WorkflowGraph = z.infer<typeof WorkflowGraph>;

/**
 * View state only, stored in `layout.json` separately from semantics so moving boxes around
 * is not a meaningful change in history.
 */
export const Layout = z.object({
  nodes: z
    .record(
      LocalId,
      z.object({
        x: z.number(),
        y: z.number(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
      }),
    )
    .default({}),
  /** Pattern node ids shown expanded. */
  expanded: z.array(LocalId).default([]),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).optional(),
});
export type Layout = z.infer<typeof Layout>;
