import {
  modelKey,
  type AgentDefaults,
  type Effort,
  type Limits,
  type ModelOption,
  type ModelRef,
} from '@app/schema';
import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { Field } from '@/components/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { errorAt, type FieldErrors } from '@/lib/validation';

export function modelLabel(m: ModelRef, models: ModelOption[]): string {
  const known = models.find((o) => modelKey(o) === modelKey(m));
  return known?.label ?? m.model;
}

export function ModelSelect({
  id,
  value,
  models,
  onChange,
}: {
  id?: string;
  value: ModelRef;
  models: ModelOption[];
  onChange: (m: ModelRef) => void;
}) {
  const current = modelKey(value);
  const known = models.some((m) => modelKey(m) === current);
  const providers = [...new Set(models.map((m) => m.provider))];

  return (
    <div className="space-y-1.5">
      <Select
        value={current}
        onValueChange={(key) => {
          const m = models.find((o) => modelKey(o) === key);
          if (m) onChange({ provider: m.provider, model: m.model });
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>
            <span>{modelLabel(value, models)}</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">{current}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!known && (
            <SelectItem value={current} disabled>
              {current} (not in model list)
            </SelectItem>
          )}
          {providers.map((p) => (
            <SelectGroup key={p}>
              <SelectLabel>{p}</SelectLabel>
              {models
                .filter((m) => m.provider === p)
                .map((m) => (
                  <SelectItem key={modelKey(m)} value={modelKey(m)}>
                    {m.label ?? m.model}
                    {m.label && (
                      <span className="font-mono text-xs text-muted-foreground">{m.model}</span>
                    )}
                  </SelectItem>
                ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {!known && (
        <p className="flex items-center gap-1 text-xs text-amber-700">
          <TriangleAlert className="size-3.5" />
          This model is not in the{' '}
          <Link to="/settings" className="underline underline-offset-2">
            model list
          </Link>
          .
        </p>
      )}
    </div>
  );
}

const EFFORTS: Effort[] = ['low', 'medium', 'high'];

export function EffortToggle({
  value,
  onChange,
}: {
  value: Effort;
  onChange: (e: Effort) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(v) => v && onChange(v as Effort)}
      aria-label="Effort"
    >
      {EFFORTS.map((e) => (
        <ToggleGroupItem key={e} value={e} className="px-4 capitalize">
          {e}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const LIMIT_FIELDS: { key: keyof Limits; label: string; hint: string; unit?: string }[] = [
  { key: 'maxIterations', label: 'Max iterations', hint: 'Agent loop turns per run.' },
  { key: 'maxTokens', label: 'Max tokens', hint: 'Total tokens per run.' },
  { key: 'maxWallTimeSeconds', label: 'Max wall time', hint: 'Seconds per run.', unit: 's' },
];

function toNumber(raw: string): number {
  // Keep the raw value invalid (NaN → schema error) rather than silently coercing to 0.
  return raw.trim() === '' ? Number.NaN : Number(raw);
}

export function LimitsFields({
  value,
  onChange,
  errors,
  pathPrefix,
}: {
  value: Limits;
  onChange: (l: Limits) => void;
  errors: FieldErrors;
  pathPrefix: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {LIMIT_FIELDS.map((f) => {
        const id = `${pathPrefix}.${f.key}`;
        const v = value[f.key];
        return (
          <Field key={f.key} label={f.label} htmlFor={id} hint={f.hint} error={errorAt(errors, id)}>
            <div className="relative">
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={Number.isNaN(v) ? '' : String(v)}
                onChange={(e) => onChange({ ...value, [f.key]: toNumber(e.target.value) })}
                className="tabular-nums"
                aria-invalid={!!errorAt(errors, id)}
              />
              {f.unit && (
                <span className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 text-xs text-muted-foreground">
                  {f.unit}
                </span>
              )}
            </div>
          </Field>
        );
      })}
    </div>
  );
}

/** Model + effort + limits, as used by agent defaults and the Settings defaults. */
export function AgentDefaultsFields({
  value,
  onChange,
  models,
  errors,
  pathPrefix,
}: {
  value: AgentDefaults;
  onChange: (d: AgentDefaults) => void;
  models: ModelOption[];
  errors: FieldErrors;
  pathPrefix: string;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field
          label="Model"
          htmlFor={`${pathPrefix}.model`}
          error={errorAt(errors, `${pathPrefix}.model`)}
        >
          <ModelSelect
            id={`${pathPrefix}.model`}
            value={value.model}
            models={models}
            onChange={(model) => onChange({ ...value, model })}
          />
        </Field>
        <Field label="Effort">
          <EffortToggle
            value={value.effort}
            onChange={(effort) => onChange({ ...value, effort })}
          />
        </Field>
      </div>
      <LimitsFields
        value={value.limits}
        onChange={(limits) => onChange({ ...value, limits })}
        errors={errors}
        pathPrefix={`${pathPrefix}.limits`}
      />
    </div>
  );
}
