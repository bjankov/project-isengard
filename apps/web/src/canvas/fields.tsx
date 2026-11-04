import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** A select over a fixed set of string options. */
export function EnumSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  id?: string;
  value: T;
  options: readonly { value: T; label: string; description?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <SelectTrigger id={id} className={cn('w-full', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            <span>{o.label}</span>
            {o.description && (
              <span className="ml-1 text-xs text-muted-foreground">{o.description}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Optional positive integer input: empty means "not set". */
export function OptionalNumber({
  id,
  value,
  onChange,
  placeholder,
  className,
}: {
  id?: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      value={value === undefined || Number.isNaN(value) ? '' : String(value)}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value.trim();
        onChange(raw === '' ? undefined : Number(raw));
      }}
      className={cn('tabular-nums', className)}
    />
  );
}

/** Editable list of strings (e.g. file globs). */
export function StringList({
  values,
  onChange,
  placeholder,
  addLabel,
  itemLabel,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  addLabel: string;
  itemLabel: string;
}) {
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={v}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={placeholder}
            className="h-8 font-mono text-xs"
            aria-label={`${itemLabel} ${i + 1}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${itemLabel.toLowerCase()} ${i + 1}`}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...values, ''])}>
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}
