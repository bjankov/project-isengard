import {
  SkillMdError,
  extraFrontmatterFromYaml,
  extraFrontmatterToYaml,
  parseAllowedTools,
  type EntityInput,
} from '@app/schema';
import { CircleAlert, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { CodeEditor } from '@/components/code-editor';
import { CharCounter, Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { errorAt, type FieldErrors } from '@/lib/validation';

type SkillInput = EntityInput<'skill'>;

/** How many advanced (non-required) frontmatter fields a skill sets. */
export function countAdvancedFields(d: SkillInput): number {
  let n = 0;
  if (d.license) n++;
  if (d.compatibility) n++;
  if (d.metadata && Object.keys(d.metadata).length > 0) n++;
  if (d.allowedTools && d.allowedTools.length > 0) n++;
  n += Object.keys(d.extraFrontmatter ?? {}).length;
  return n;
}

const orUndefined = (s: string) => (s.trim() === '' ? undefined : s);

// ---- Metadata: key/value rows ----

function MetadataEditor({
  value,
  onChange,
  error,
}: {
  value: Record<string, string> | undefined;
  onChange: (v: Record<string, string> | undefined) => void;
  error?: string;
}) {
  // Rows are local so half-typed rows (empty key, duplicate key) are not lost while editing.
  const [rows, setRows] = useState(() =>
    Object.entries(value ?? {}).map(([key, val]) => ({ key, value: val })),
  );
  const commit = (next: { key: string; value: string }[]) => {
    setRows(next);
    const record: Record<string, string> = {};
    for (const r of next) if (r.key.trim()) record[r.key.trim()] = r.value;
    onChange(Object.keys(record).length > 0 ? record : undefined);
  };
  const keys = rows.map((r) => r.key.trim());
  const duplicate = (k: string) => k !== '' && keys.filter((x) => x === k).length > 1;

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={row.key}
            onChange={(e) =>
              commit(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
            }
            placeholder="author"
            className="h-8 w-40 shrink-0 font-mono text-xs"
            aria-label={`Metadata key ${i + 1}`}
            aria-invalid={duplicate(row.key.trim())}
          />
          <Input
            value={row.value}
            onChange={(e) =>
              commit(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
            }
            placeholder="value"
            className="h-8 text-xs"
            aria-label={`Metadata value ${i + 1}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove metadata ${i + 1}`}
            onClick={() => commit(rows.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
      {keys.some(duplicate) && (
        <p className="text-xs text-destructive">Duplicate keys: only the last one is kept.</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRows([...rows, { key: '', value: '' }])}
      >
        <Plus />
        Add entry
      </Button>
    </div>
  );
}

// ---- allowed-tools: chips ----

function AllowedToolsEditor({
  value,
  onChange,
}: {
  value: string[] | undefined;
  onChange: (v: string[] | undefined) => void;
}) {
  const [input, setInput] = useState('');
  const items = value ?? [];
  const add = () => {
    const next = [...items, ...parseAllowedTools(input).filter((t) => !items.includes(t))];
    onChange(next.length > 0 ? next : undefined);
    setInput('');
  };
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md border py-0.5 pr-1 pl-2 font-mono text-xs"
            >
              {t}
              <button
                type="button"
                className="rounded p-0.5 hover:bg-accent"
                aria-label={`Remove ${t}`}
                onClick={() => {
                  const next = items.filter((x) => x !== t);
                  onChange(next.length > 0 ? next : undefined);
                }}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
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
          placeholder="Bash(git:*) Read"
          className="h-8 font-mono text-xs"
          aria-label="Add allowed tool"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!input.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

// ---- Other fields: YAML ----

function OtherFieldsEditor({
  value,
  onChange,
  onYamlError,
  error,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown> | undefined) => void;
  onYamlError: (message: string | undefined) => void;
  error?: string;
}) {
  const [text, setText] = useState(() => extraFrontmatterToYaml(value));
  const [yamlError, setYamlError] = useState<string>();
  return (
    <div className="space-y-1.5">
      <CodeEditor
        language="yaml"
        value={text}
        onChange={(t) => {
          setText(t);
          try {
            onChange(extraFrontmatterFromYaml(t));
            setYamlError(undefined);
            onYamlError(undefined);
          } catch (err) {
            const msg = err instanceof SkillMdError ? err.message : String(err);
            setYamlError(msg);
            onYamlError(msg);
          }
        }}
        height={120}
        ariaLabel="Other frontmatter fields (YAML)"
      />
      {(yamlError ?? error) && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <CircleAlert className="size-3.5 shrink-0" />
          {yamlError ?? error}
        </p>
      )}
    </div>
  );
}

// ---- The panel ----

export function AdvancedSkillFields({
  draft,
  update,
  errors,
  onYamlError,
}: {
  draft: SkillInput;
  update: (fn: (d: SkillInput) => SkillInput) => void;
  errors: FieldErrors;
  onYamlError: (message: string | undefined) => void;
}) {
  return (
    <div className="space-y-5 rounded-xl border bg-muted/30 p-5 duration-300 animate-in fade-in slide-in-from-right-4">
      <div>
        <h3 className="text-sm font-semibold">Advanced frontmatter</h3>
        <p className="text-xs text-muted-foreground">
          Optional fields from the Agent Skills format. Most skills don&apos;t need them.
        </p>
      </div>
      <Field
        label="License"
        htmlFor="skill-license"
        error={errors.license}
        hint="A license name, or a license file bundled with the skill."
      >
        <Input
          id="skill-license"
          value={draft.license ?? ''}
          onChange={(e) => update((d) => ({ ...d, license: orUndefined(e.target.value) }))}
          placeholder="Apache-2.0 or LICENSE.txt"
        />
      </Field>
      <Field
        label="Compatibility"
        htmlFor="skill-compatibility"
        error={errors.compatibility}
        aside={<CharCounter value={draft.compatibility ?? ''} max={500} />}
        hint="Environment requirements, e.g. system packages or network access."
      >
        <Textarea
          id="skill-compatibility"
          value={draft.compatibility ?? ''}
          onChange={(e) => update((d) => ({ ...d, compatibility: orUndefined(e.target.value) }))}
          rows={2}
          placeholder="Requires git and network access"
        />
      </Field>
      <Field label="Metadata" hint="Free-form string key/value pairs.">
        <MetadataEditor
          value={draft.metadata}
          onChange={(metadata) => update((d) => ({ ...d, metadata }))}
          error={errorAt(errors, 'metadata')}
        />
      </Field>
      <Field
        label="Allowed tools"
        error={errorAt(errors, 'allowedTools')}
        hint="Written as allowed-tools (experimental in the standard). Informational here: an agent's tool access comes only from its tool presets."
      >
        <AllowedToolsEditor
          value={draft.allowedTools}
          onChange={(allowedTools) => update((d) => ({ ...d, allowedTools }))}
        />
      </Field>
      <Field label="Other fields" hint="Any other frontmatter, as YAML. Kept exactly as written.">
        <OtherFieldsEditor
          value={draft.extraFrontmatter}
          onChange={(extraFrontmatter) => update((d) => ({ ...d, extraFrontmatter }))}
          onYamlError={onYamlError}
          error={errorAt(errors, 'extraFrontmatter')}
        />
      </Field>
    </div>
  );
}

// ---- Raw SKILL.md ----

const FIELD_LABELS: Record<string, string> = {
  allowedTools: 'allowed-tools',
  extraFrontmatter: 'other fields',
};

export function RawSkillProblems({
  parseError,
  errors,
}: {
  parseError: string | undefined;
  errors: FieldErrors;
}) {
  const entries = Object.entries(errors);
  if (!parseError && entries.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      {parseError && (
        <li className="flex items-center gap-1.5 text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          {parseError}
        </li>
      )}
      {entries.map(([path, message]) => {
        const [field, ...rest] = path.split('.');
        const label = [FIELD_LABELS[field ?? ''] ?? field, ...rest].join('.');
        return (
          <li key={path} className="flex items-center gap-1.5 text-destructive">
            <CircleAlert className="size-4 shrink-0" />
            <span className="font-mono text-xs">{label}</span>: {message}
          </li>
        );
      })}
    </ul>
  );
}
