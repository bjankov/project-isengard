import { describeScope, type BuiltinToolId, type ToolPreset } from '@app/schema';
import {
  Download,
  FilePen,
  FilePlus2,
  FileSearch,
  FileText,
  Globe,
  ShieldAlert,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export const BUILTIN_ICONS: Record<BuiltinToolId, LucideIcon> = {
  read_file: FileText,
  write_file: FilePlus2,
  edit_file: FilePen,
  search_files: FileSearch,
  shell: SquareTerminal,
  web_search: Globe,
  web_fetch: Download,
};

export function BuiltinIcon({ id, className }: { id: BuiltinToolId; className?: string }) {
  const Icon = BUILTIN_ICONS[id];
  return <Icon className={cn('size-4', className)} />;
}

export const UNRESTRICTED_SHELL_EXPLANATION =
  'This shell preset has no command allowlist, so an agent can run any command. Unrestricted shell bypasses every other restriction (file scopes, web domains).';

/** Must appear everywhere an unrestricted shell preset appears (PLAN.md 6.2). */
export function UnrestrictedShellBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="destructive"
          className={cn('gap-1 rounded-md px-1.5 py-0 text-[11px]', className)}
        >
          <ShieldAlert />
          Unrestricted shell
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{UNRESTRICTED_SHELL_EXPLANATION}</TooltipContent>
    </Tooltip>
  );
}

/** One-line scope summary with the unrestricted badge when relevant. */
export function ScopeSummary({ preset, className }: { preset: ToolPreset; className?: string }) {
  const d = describeScope(preset);
  if (d.unrestricted) return <UnrestrictedShellBadge className={className} />;
  return (
    <span className={cn('truncate font-mono text-xs text-muted-foreground', className)}>
      {d.summary}
    </span>
  );
}
