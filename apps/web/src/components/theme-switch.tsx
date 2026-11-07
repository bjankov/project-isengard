import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme, type ThemePreference } from '@/stores/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Same as the system', icon: Monitor },
];

/** Light / dark / system, remembered in this browser. */
export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={preference}
      onValueChange={(v) => {
        if (v) setPreference(v as ThemePreference);
      }}
      aria-label="Theme"
      className="rounded-md border p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={value} aria-label={label} className="size-7 min-w-0 px-0">
              <Icon className="size-3.5" />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
