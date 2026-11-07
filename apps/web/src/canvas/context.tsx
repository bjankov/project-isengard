import type { AgentOverride, PatternLookup, RepeatGroup, Settings, ToolPreset } from '@app/schema';
import { createContext, useContext } from 'react';
import type { CanvasKind } from './doc';

/**
 * Data the canvas nodes need besides their own content. Only things that change rarely: every
 * node re-renders when this changes. What changes with each edit (problems, joins) reaches a
 * node through its own `data.status`, so editing one node re-renders only the nodes it affects.
 */
export interface CanvasContextValue {
  kind: CanvasKind;
  overrides: Record<string, AgentOverride>;
  /** The pattern's repeat groups (empty for projects). */
  repeat: RepeatGroup[];
  /** Pinned patterns, for the slots of an instance. */
  patterns: PatternLookup | undefined;
  settings: Settings | undefined;
  tools: ToolPreset[] | undefined;
  /** Expanded pattern instances (paths), and expanding or collapsing one. */
  expanded: ReadonlySet<string>;
  toggleExpanded: (path: string) => void;
  /** Pin the reference at a location (see `RefLocation.key`) to another version. */
  repin: (location: string, version: string) => void;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvasContext(): CanvasContextValue {
  const value = useContext(CanvasContext);
  if (!value) throw new Error('CanvasContext missing');
  return value;
}
