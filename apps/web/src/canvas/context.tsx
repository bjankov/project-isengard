import type {
  AgentOverride,
  LoopAnalysis,
  RepeatGroup,
  Settings,
  ToolPreset,
  WorkflowGraph,
} from '@app/schema';
import { createContext, useContext } from 'react';
import type { CanvasKind } from './doc';
import type { WorkflowCheck } from './use-workflow-check';

/** Data the canvas nodes and edges need besides their own content. */
export interface CanvasContextValue {
  kind: CanvasKind;
  graph: WorkflowGraph;
  overrides: Record<string, AgentOverride>;
  /** The pattern's repeat groups (empty for projects). */
  repeat: RepeatGroup[];
  loops: LoopAnalysis;
  check: WorkflowCheck;
  settings: Settings | undefined;
  tools: ToolPreset[] | undefined;
  /** Expanded pattern instances (paths), and expanding or collapsing one. */
  expanded: ReadonlySet<string>;
  toggleExpanded: (path: string) => void;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvasContext(): CanvasContextValue {
  const value = useContext(CanvasContext);
  if (!value) throw new Error('CanvasContext missing');
  return value;
}
