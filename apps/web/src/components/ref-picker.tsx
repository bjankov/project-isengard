import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface PickerItem {
  id: string;
  name: string;
  description: string;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
}

interface RefPickerProps {
  /** All candidates (already-selected ones are hidden). */
  items: PickerItem[] | undefined;
  selectedIds: string[];
  onAdd: (id: string) => void;
  addLabel: string;
  searchPlaceholder: string;
  /** Link for creating a new entity when none fits. */
  createHref: string;
  createLabel: string;
}

/** "Add …" button with a searchable list of library entities. */
export function RefPicker({
  items,
  selectedIds,
  onAdd,
  addLabel,
  searchPlaceholder,
  createHref,
  createLabel,
}: RefPickerProps) {
  const [open, setOpen] = useState(false);
  const available = (items ?? []).filter((i) => !selectedIds.includes(i.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus />
          {addLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{items === undefined ? 'Loading…' : 'Nothing left to add.'}</CommandEmpty>
            {available.length > 0 && (
              <CommandGroup>
                {available.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.description} ${item.id}`}
                    onSelect={() => {
                      onAdd(item.id);
                      setOpen(false);
                    }}
                    className="items-start"
                  >
                    {item.icon && <span className="mt-0.5 text-muted-foreground">{item.icon}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.name}</span>
                      {item.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                      {item.extra && <span className="mt-1 flex">{item.extra}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="border-t p-1">
            <Button asChild variant="ghost" size="sm" className="w-full justify-start">
              <Link to={createHref}>
                <Plus />
                {createLabel}
              </Link>
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A selected reference shown as a removable card. */
export function RefCard({
  icon,
  title,
  subtitle,
  href,
  onRemove,
  extra,
  missing,
  missingLabel = 'missing from library',
  badge,
}: {
  icon?: React.ReactNode;
  title: string;
  /** Shown next to the title, e.g. the pinned version. */
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
  href?: string;
  onRemove: () => void;
  extra?: React.ReactNode;
  missing?: boolean;
  /** What to say when missing, e.g. "deleted (placeholder)". */
  missingLabel?: string;
}) {
  return (
    <div className="group flex items-start gap-3 rounded-lg border bg-card p-3">
      {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {href && !missing ? (
            <Link
              to={href}
              className="truncate text-sm font-medium underline-offset-4 hover:underline"
            >
              {title}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium">{title}</span>
          )}
          {badge}
          {missing && <span className="text-xs text-destructive">{missingLabel}</span>}
        </div>
        {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
        {extra && <div className="mt-1.5 flex flex-wrap gap-1">{extra}</div>}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onRemove}
        className="text-muted-foreground opacity-60 group-hover:opacity-100"
      >
        Remove
      </Button>
    </div>
  );
}
