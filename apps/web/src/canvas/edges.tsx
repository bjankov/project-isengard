import type { ContextModeName, WorkflowEdge } from '@app/schema';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FlowEdgeData = {
  edge: WorkflowEdge;
  /** Closes a loop: drawn as a curve under the nodes, with the iteration cap. */
  back: boolean;
  /** `maxIterations` of the decision exit this edge leaves from, if any. */
  cap: number | undefined;
};
export type FlowEdge = Edge<FlowEdgeData>;

export const CONTEXT_LABELS: Record<ContextModeName, string> = {
  full: 'full',
  reference: 'reference',
  excerpt: 'excerpt',
  diff: 'diff',
  summary: 'summary',
  'outcome-only': 'outcome',
};

/** A loop-back curve that dips below both ends. Returns the path and its midpoint. */
function loopPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const depth = Math.max(sy, ty) + 110;
  const c1 = { x: sx + 160, y: depth };
  const c2 = { x: tx - 160, y: depth };
  const path = `M ${sx},${sy} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${tx},${ty}`;
  // Cubic Bézier at t = 0.5.
  const mx = (sx + 3 * c1.x + 3 * c2.x + tx) / 8;
  const my = (sy + 3 * c1.y + 3 * c2.y + ty) / 8;
  return [path, mx, my];
}

function WorkflowEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<FlowEdge>) {
  if (!data) return null;
  const { edge, back, cap } = data;
  const [path, labelX, labelY] = back
    ? loopPath(sourceX, sourceY, targetX, targetY)
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const sequencing = edge.payload === 'none';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={cn(
          '!stroke-[1.5] !stroke-muted-foreground/70',
          back && '!stroke-amber-500',
          selected && '!stroke-primary !stroke-2',
        )}
        style={sequencing ? { strokeDasharray: '5 4' } : undefined}
        interactionWidth={18}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          data-edge-label={id}
        >
          <span
            className={cn(
              'rounded border bg-background px-1.5 py-px text-[10px] font-medium text-muted-foreground shadow-xs',
              selected && 'border-primary text-foreground',
            )}
            title={`Context: ${edge.context.mode}${sequencing ? ' (sequencing only)' : ''}`}
          >
            {sequencing ? 'after' : CONTEXT_LABELS[edge.context.mode]}
            {edge.history === 'all' && ' · all'}
          </span>
          {back && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded border px-1.5 py-px text-[10px] font-medium shadow-xs',
                cap
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-destructive/40 bg-destructive/5 text-destructive',
              )}
              title={cap ? `Loops at most ${cap} times` : 'No iteration cap set'}
            >
              <RotateCcw className="size-2.5" />
              {cap ? `max ${cap}` : 'no cap'}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes: EdgeTypes = { workflow: WorkflowEdgeView };
