import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ListItem {
  id: string;
  name: string;
  description: string;
  href: string;
  icon?: React.ReactNode;
  /** Badges etc. shown under the name. */
  extra?: React.ReactNode;
}

export interface ListGroup {
  title?: string;
  items: ListItem[];
  /** Shown when the group has no items (before filtering). */
  empty?: React.ReactNode;
}

interface LibraryLayoutProps {
  title: string;
  newHref: string;
  newLabel: string;
  groups: ListGroup[] | undefined;
  error?: string;
}

/** List on the left, editor (route outlet) on the right. */
export function LibraryLayout({ title, newHref, newLabel, groups, error }: LibraryLayoutProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = (i: ListItem) =>
    !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-80 shrink-0 flex-col border-r bg-muted/30">
        <div className="space-y-3 border-b p-3">
          <div className="flex items-center justify-between">
            <h1 className="px-1 text-sm font-semibold">{title}</h1>
            <Button asChild size="sm" variant="outline">
              <Link to={newHref}>
                <Plus />
                {newLabel}
              </Link>
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="h-8 bg-background pl-8"
              aria-label={`Search ${title.toLowerCase()}`}
            />
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label={title}>
          {error && <p className="p-2 text-sm text-destructive">{error}</p>}
          {!groups && !error && <p className="p-2 text-sm text-muted-foreground">Loading…</p>}
          {groups?.map((group, gi) => {
            const items = group.items.filter(matches);
            return (
              <div key={group.title ?? gi} className="mb-3">
                {group.title && (
                  <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </div>
                )}
                {group.items.length === 0 && group.empty && !q && (
                  <div className="px-2 py-1 text-sm text-muted-foreground">{group.empty}</div>
                )}
                {q && items.length === 0 && (
                  <div className="px-2 py-1 text-sm text-muted-foreground">
                    No matches for “{query.trim()}”.{' '}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => setQuery('')}
                    >
                      Clear search
                    </button>
                  </div>
                )}
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <li key={item.id}>
                      <NavLink
                        to={item.href}
                        className={({ isActive }) =>
                          cn(
                            'flex gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent',
                            isActive &&
                              'bg-background shadow-xs ring-1 ring-border hover:bg-background',
                          )
                        }
                      >
                        {item.icon && (
                          <span className="mt-0.5 shrink-0 text-muted-foreground">{item.icon}</span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.name}</span>
                          {item.description && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          )}
                          {item.extra && (
                            <span className="mt-1 flex flex-wrap gap-1">{item.extra}</span>
                          )}
                        </span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

/** Right-hand side when nothing is selected. */
export function EmptySelection({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6">
        {icon}
      </div>
      <p className="mt-4 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function NotFound({ what, backHref }: { what: string; backHref: string }) {
  return (
    <div className="p-8 text-sm">
      <p className="font-medium">This {what} does not exist (anymore).</p>
      <Link to={backHref} className="text-muted-foreground underline underline-offset-4">
        Back to the list
      </Link>
    </div>
  );
}

export function EditorBody({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className={cn(
        'mx-auto space-y-10 px-8 py-8 transition-[max-width] duration-300 ease-out',
        wide ? 'max-w-7xl' : 'max-w-4xl',
      )}
    >
      {children}
    </div>
  );
}
