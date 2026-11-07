import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router';
import {
  Bot,
  FolderKanban,
  Shapes,
  Settings,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { CascadeDialog } from '@/components/cascade-dialog';
import { ThemeSwitch } from '@/components/theme-switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useServerStatus } from '@/stores/server-status';

export interface TabDef {
  path: string;
  label: string;
  icon: LucideIcon;
}

export const TABS: TabDef[] = [
  { path: '/projects', label: 'Projects', icon: FolderKanban },
  { path: '/agents', label: 'Agents', icon: Bot },
  { path: '/skills', label: 'Skills', icon: Sparkles },
  { path: '/tools', label: 'Tools', icon: Wrench },
  { path: '/patterns', label: 'Patterns', icon: Shapes },
  { path: '/settings', label: 'Settings', icon: Settings },
];

function ServerIndicator() {
  const { status, refresh } = useServerStatus();

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const dot =
    status.state === 'online'
      ? 'bg-success'
      : status.state === 'offline'
        ? 'bg-destructive'
        : 'bg-warning animate-pulse';
  const label =
    status.state === 'online'
      ? 'Library connected'
      : status.state === 'offline'
        ? 'Server offline'
        : 'Connecting…';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <span className={cn('size-2 rounded-full', dot)} />
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-sm">
        {status.state === 'online' ? (
          <div className="space-y-0.5 font-mono text-[11px]">
            <div>{status.health.libraryDir}</div>
            <div>HEAD {status.health.libraryHead.slice(0, 10)}</div>
            <div>{status.health.gitVersion}</div>
          </div>
        ) : status.state === 'offline' ? (
          status.error
        ) : (
          'Contacting the local server'
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function AppShell() {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-6 border-b px-4">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span>Workflow Designer</span>
        </div>
        <nav className="flex items-center gap-1" aria-label="Main">
          {TABS.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-secondary text-foreground',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <ServerIndicator />
          <ThemeSwitch />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
      <CascadeDialog />
    </div>
  );
}
