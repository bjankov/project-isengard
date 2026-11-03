import type { DomainScope, PathScope, ShellCommandRule, ShellScope } from '@app/schema';
import { Plus, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UNRESTRICTED_SHELL_EXPLANATION } from '@/components/tools';
import { errorAt, type FieldErrors } from '@/lib/validation';
import { cn } from '@/lib/utils';

function RowError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" onClick={onClick} aria-label={label}>
      <X />
    </Button>
  );
}

// ---- Paths ----

export function PathScopeEditor({
  value,
  onChange,
  errors,
  verb,
}: {
  value: PathScope;
  onChange: (v: PathScope) => void;
  errors: FieldErrors;
  verb: string;
}) {
  const paths = value.paths;
  const set = (i: number, p: string) => onChange({ paths: paths.map((x, j) => (j === i ? p : x)) });
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Agents may {verb} files matching any of these globs. Paths are relative to the project
        workspace, e.g. <code className="rounded bg-muted px-1 font-mono text-xs">src/**</code>.
      </p>
      {paths.map((p, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center gap-2">
            <Input
              value={p}
              onChange={(e) => set(i, e.target.value)}
              placeholder="src/**"
              className="font-mono"
              aria-label={`Path glob ${i + 1}`}
              aria-invalid={!!errors[`scope.paths.${i}`]}
            />
            <RemoveButton
              label={`Remove path ${i + 1}`}
              onClick={() => onChange({ paths: paths.filter((_, j) => j !== i) })}
            />
          </div>
          <RowError message={errors[`scope.paths.${i}`]} />
        </div>
      ))}
      {errors['scope.paths'] && <RowError message="Add at least one path glob." />}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange({ paths: [...paths, ''] })}
      >
        <Plus />
        Add path
      </Button>
    </div>
  );
}

// ---- Shell ----

export function ShellScopeEditor({
  value,
  onChange,
  errors,
}: {
  value: ShellScope;
  onChange: (v: ShellScope) => void;
  errors: FieldErrors;
}) {
  const commands = value.commands;
  const set = (i: number, rule: ShellCommandRule) =>
    onChange({ commands: commands.map((x, j) => (j === i ? rule : x)) });

  return (
    <div className="space-y-3">
      {commands.length === 0 ? (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">Unrestricted shell</p>
            <p className="mt-1 text-muted-foreground">{UNRESTRICTED_SHELL_EXPLANATION}</p>
            <p className="mt-1 text-muted-foreground">Add allowed commands below to restrict it.</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Agents may only run these commands. <strong>Exact</strong> allows the command as written;{' '}
          <strong>prefix</strong> also allows extra arguments after it.
        </p>
      )}
      {commands.map((rule, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center gap-2">
            <Select
              value={rule.match}
              onValueChange={(match) =>
                set(i, { ...rule, match: match as ShellCommandRule['match'] })
              }
            >
              <SelectTrigger className="w-28 shrink-0" aria-label={`Match type ${i + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exact">Exact</SelectItem>
                <SelectItem value="prefix">Prefix</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={rule.command}
              onChange={(e) => set(i, { ...rule, command: e.target.value })}
              placeholder={rule.match === 'exact' ? 'npm test' : 'git diff'}
              className="font-mono"
              aria-label={`Command ${i + 1}`}
              aria-invalid={!!errorAt(errors, `scope.commands.${i}`)}
            />
            <RemoveButton
              label={`Remove command ${i + 1}`}
              onClick={() => onChange({ commands: commands.filter((_, j) => j !== i) })}
            />
          </div>
          <RowError message={errorAt(errors, `scope.commands.${i}`)} />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange({ commands: [...commands, { match: 'exact', command: '' }] })}
      >
        <Plus />
        Add command
      </Button>
    </div>
  );
}

// ---- Domains ----

function DomainList({
  label,
  hint,
  items,
  onChange,
  errors,
  path,
  tone,
}: {
  label: string;
  hint: string;
  items: string[];
  onChange: (items: string[]) => void;
  errors: FieldErrors;
  path: string;
  tone: 'allow' | 'deny';
}) {
  const [input, setInput] = useState('');
  const add = () => {
    const parts = input
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .filter((s) => !items.includes(s));
    if (parts.length) onChange([...items, ...parts]);
    setInput('');
  };
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((d, i) => (
          <span
            key={d}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border py-0.5 pr-1 pl-2 font-mono text-xs',
              tone === 'deny' && 'border-destructive/30 bg-destructive/5',
              errors[`${path}.${i}`] && 'border-destructive text-destructive',
            )}
            title={errors[`${path}.${i}`]}
          >
            {d}
            <button
              type="button"
              className="rounded p-0.5 hover:bg-accent"
              aria-label={`Remove ${d}`}
              onClick={() => onChange(items.filter((x) => x !== d))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-xs text-muted-foreground italic">none</span>}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="docs.python.org or *.example.com"
          className="font-mono"
          aria-label={`Add domain to ${label.toLowerCase()}`}
        />
        <Button type="button" variant="outline" onClick={add} disabled={!input.trim()}>
          Add
        </Button>
      </div>
      <RowError message={errorAt(errors, path)} />
    </div>
  );
}

export function DomainScopeEditor({
  value,
  onChange,
  errors,
}: {
  value: DomainScope;
  onChange: (v: DomainScope) => void;
  errors: FieldErrors;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <DomainList
        label="Allowed domains"
        hint="Empty means any domain."
        items={value.allow}
        onChange={(allow) => onChange({ ...value, allow })}
        errors={errors}
        path="scope.allow"
        tone="allow"
      />
      <DomainList
        label="Blocked domains"
        hint="Always refused, even if allowed above."
        items={value.deny}
        onChange={(deny) => onChange({ ...value, deny })}
        errors={errors}
        path="scope.deny"
        tone="deny"
      />
    </div>
  );
}
