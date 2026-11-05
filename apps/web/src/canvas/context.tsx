import type { AgentOverride, LoopAnalysis, Settings, ToolPreset, WorkflowGraph } from '@app/schema';
import { createContext, useContext } from 'react';
import type { WorkflowCheck } from './use-workflow-check';

/** Data the canvas nodes and edges need besides their own content. */
export interface CanvasContextValue {
  graph: WorkflowGraph;
  overrides: Record<string, AgentOverride>;
  loops: LoopAnalysis;
  check: WorkflowCheck;
  settings: Settings | undefined;
  tools: ToolPreset[] | undefined;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvasContext(): CanvasContextValue {
  const value = useContext(CanvasContext);
  if (!value) throw new Error('CanvasContext missing');
  return value;
}
