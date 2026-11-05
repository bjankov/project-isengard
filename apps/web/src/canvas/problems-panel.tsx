import type { WorkflowProblem } from '@app/schema';
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Lock,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkflowCheck } from './use-workflow-check';

export function ProblemIcon({
  severity,
  className,
}: {
  severity: WorkflowProblem['severity'];
  className?: string;
}) {
  return severity === 'error' ? (
    <CircleAlert className={cn('size-4 shrink-0 text-destructive', className)} />
  ) : (
    <TriangleAlert className={cn('size-4 shrink-0 text-amber-500', className)} />
  );
}

/** One problem: icon, message, what it blocks, and its one-click fix. */
export function ProblemRow({
  problem,
  onSelect,
  onFix,
  compact,
}: {
  problem: WorkflowProblem;
  onSelect?: (p: WorkflowProblem) => void;
  onFix: (p: WorkflowProblem) => void;
  compact?: boolean;
}) {
  return (
    <li
      className={cn(
        'group flex items-start gap-2 rounded-md px-2 py-1.5 text-sm',
        onSelect && 'cursor-pointer hover:bg-accent',
      )}
      onClick={() => onSelect?.(problem)}
      data-problem-rule={problem.rule}
      data-severity={problem.severity}
    >
      <ProblemIcon severity={problem.severity} className="mt-0.5" />
      <span className="min-w-0 flex-1 leading-snug">
        {problem.message}
        {!compact && problem.blocksSave && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-destructive/10 px-1 text-[11px] font-medium text-destructive">
            <Lock className="size-3" />
            blocks saving
          </span>
        )}
      </span>
      {problem.fix && (
        <Button
          size="xs"
          variant="outline"
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onFix(problem);
          }}
        >
          {problem.fix.label}
        </Button>
      )}
    </li>
  );
}

/** Collapsible list of every problem in the workflow, under the canvas (PLAN.md 9.5). */
export function ProblemsPanel({
  check,
  open,
  onOpenChange,
  onSelect,
  onFix,
}: {
  check: WorkflowCheck;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (p: WorkflowProblem) => void;
  onFix: (p: WorkflowProblem) => void;
}) {
  const { problems, errors, warnings } = check;
  const sorted = [...problems].sort(
    (a, b) =>
      Number(b.blocksSave) - Number(a.blocksSave) ||
      Number(b.severity === 'error') - Number(a.severity === 'error'),
  );
  return (
    <section className="shrink-0 border-t bg-background" aria-label="Problems">
      <button
        type="button"
        className="flex h-9 w-full items-center gap-3 px-3 text-sm hover:bg-accent/50"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        data-testid="problems-toggle"
      >
        <span className="font-medium">Problems</span>
        {problems.length === 0 ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <CircleCheck className="size-4 text-emerald-600" />
            None
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1" data-testid="problems-errors">
              <CircleAlert className="size-4 text-destructive" />
              {errors} {errors === 1 ? 'error' : 'errors'}
            </span>
            <span className="flex items-center gap-1" data-testid="problems-warnings">
              <TriangleAlert className="size-4 text-amber-500" />
              {warnings} {warnings === 1 ? 'warning' : 'warnings'}
            </span>
          </>
        )}
        {check.blocking.length > 0 ? (
          <span className="text-xs text-destructive">Saving is blocked</span>
        ) : errors > 0 ? (
          <span className="text-xs text-muted-foreground">
            Merging is blocked until errors are fixed
          </span>
        ) : null}
        <span className="ml-auto text-muted-foreground">
          {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </span>
      </button>
      {open && (
        <ul className="max-h-52 overflow-y-auto px-1 pb-2" data-testid="problems-list">
          {sorted.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              Nothing to fix. Every rule passes.
            </li>
          )}
          {sorted.map((p) => (
            <ProblemRow key={p.id} problem={p} onSelect={onSelect} onFix={onFix} />
          ))}
        </ul>
      )}
    </section>
  );
}
