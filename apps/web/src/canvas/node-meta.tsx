import type { WorkflowNodeType } from '@app/schema';
import {
  Bot,
  Database,
  FileText,
  Flag,
  GitFork,
  type LucideIcon,
  Play,
  Shapes,
  StickyNote,
  UserRound,
  Wrench,
} from 'lucide-react';

/** Icon and accent color per node type, shared by the palette, nodes and inspector. */
export const NODE_META: Record<WorkflowNodeType, { icon: LucideIcon; accent: string }> = {
  input: { icon: Play, accent: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  output: { icon: Flag, accent: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  agent: { icon: Bot, accent: 'text-sky-700 bg-sky-50 border-sky-200' },
  decision: { icon: GitFork, accent: 'text-amber-700 bg-amber-50 border-amber-200' },
  artifact: { icon: FileText, accent: 'text-slate-700 bg-slate-50 border-slate-200' },
  toolStep: { icon: Wrench, accent: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  humanInput: { icon: UserRound, accent: 'text-rose-700 bg-rose-50 border-rose-200' },
  sharedStore: { icon: Database, accent: 'text-teal-700 bg-teal-50 border-teal-200' },
  pattern: { icon: Shapes, accent: 'text-violet-700 bg-violet-50 border-violet-200' },
  note: { icon: StickyNote, accent: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
};
