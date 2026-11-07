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
import { memo } from 'react';
import { cn } from '@/lib/utils';

export type FlowEdgeData = {
  edge: WorkflowEdge;
  /** Closes a loop: drawn as a curve under the nodes. */
  back: boolean;
  /** The loop cap this edge carries (a capped decision exit in a loop). */
  cap: number | undefined;
  /** Where an uncapped loop is reported: shows a `no cap` badge. */
  uncapped: boolean;
  problem: 'error' | 'warning' | undefined;
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

/**
 * An edge running right to left between nodes on about the same row (e.g. an agent writing
 * a shared store placed before it): an arc over the row, instead of an S through it.
 */
function arcPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const height = Math.min(sy, ty) - 90;
  const c1 = { x: sx + 120, y: height };
  const c2 = { x: tx - 120, y: height };
  const path = `M ${sx},${sy} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${tx},${ty}`;
  const mx = (sx + 3 * c1.x + 3 * c2.x + tx) / 8;
  const my = (sy + 3 * c1.y + 3 * c2.y + ty) / 8;
  return [path, mx, my];
}

const isBackwardOnRow = (sx: number, sy: number, tx: number, ty: number) =>
  tx < sx - 40 && Math.abs(ty - sy) < 48;

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
  const { edge, back, cap, uncapped, problem } = data;
  const [path, labelX, labelY] = back
    ? loopPath(sourceX, sourceY, targetX, targetY)
    : isBackwardOnRow(sourceX, sourceY, targetX, targetY)
      ? arcPath(sourceX, sourceY, targetX, targetY)
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
          problem === 'error' && '!stroke-destructive',
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
          data-problem={problem}
        >
          <span
            className={cn(
              'rounded border bg-background px-1.5 py-px text-[10px] font-medium text-muted-foreground shadow-xs',
              problem === 'error' && 'border-destructive/60 text-destructive',
              problem === 'warning' && 'border-amber-400',
              selected && 'border-primary text-foreground',
            )}
            title={`Context: ${edge.context.mode}${sequencing ? ' (sequencing only)' : ''}`}
          >
            {sequencing ? 'after' : CONTEXT_LABELS[edge.context.mode]}
            {edge.history === 'all' && ' · all'}
          </span>
          {(cap !== undefined || uncapped) && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded border px-1.5 py-px text-[10px] font-medium shadow-xs',
                cap
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-destructive/40 bg-destructive/5 text-destructive',
              )}
              title={
                cap
                  ? `Loops at most ${cap} times`
                  : 'This loop has no cap, so the workflow can’t be saved'
              }
              data-loop-badge
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

/** Memoized: the editor keeps an edge's props identical while nothing about it changed. */
export const edgeTypes: EdgeTypes = { workflow: memo(WorkflowEdgeView) };
