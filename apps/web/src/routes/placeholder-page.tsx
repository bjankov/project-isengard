import type { LucideIcon } from 'lucide-react';

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

/** Empty tab content until the tab's milestone lands. */
export function PlaceholderPage({ title, description, icon: Icon }: PlaceholderPageProps) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className="size-6 text-muted-foreground" />
        </div>
        <p className="mt-4 text-sm font-medium">Nothing here yet</p>
        <p className="mt-1 text-sm text-muted-foreground">This section is not built yet.</p>
      </div>
    </div>
  );
}
