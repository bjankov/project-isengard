import {
  BUILTIN_TOOLS,
  BuiltinToolId,
  builtinTool,
  describeScope,
  safeParseEntity,
  type DomainScope,
  type EntityInput,
  type PathScope,
  type ShellScope,
  type ToolPreset,
} from '@app/schema';
import { Bot, Lock, Wrench } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { EditorHeader } from '@/components/editor-header';
import { Field, Section } from '@/components/field';
import { EditorBody, EmptySelection, LibraryLayout, NotFound } from '@/components/library-layout';
import { DomainScopeEditor, PathScopeEditor, ShellScopeEditor } from '@/components/scope-editors';
import { BuiltinIcon, ScopeSummary, UnrestrictedShellBadge } from '@/components/tools';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  useEditorSource,
  useEntityEditor,
  type EditorSourceReady,
} from '@/hooks/use-entity-editor';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useEntities, useLibrary, useVersions } from '@/stores/library';
import { DraftBadge } from '@/components/versioning';

type ToolInput = EntityInput<'tool'>;

const SCOPE_KIND_TEXT = {
  paths: 'Scoped by workspace path globs.',
  commands: 'Scoped by a command allowlist. Without one it is unrestricted.',
  domains: 'Optionally scoped by allowed and blocked domains.',
} as const;

function defaultPreset(builtin: BuiltinToolId): ToolInput {
  const base = { name: '', description: '' };
  switch (builtin) {
    case 'shell':
      return { ...base, builtin, scope: { commands: [{ match: 'exact', command: '' }] } };
    case 'web_search':
    case 'web_fetch':
      return { ...base, builtin, scope: { allow: [], deny: [] } };
    default:
      return { ...base, builtin, scope: { paths: [''] } };
  }
}

/** Parsed preset for display (summary/badges) or undefined while the draft is invalid. */
function parsePreset(input: ToolInput): ToolPreset | undefined {
  const r = safeParseEntity('tool', { ...input, id: 'draft-aaaaaa' });
  return r.success ? r.data : undefined;
}

export function ToolsLayout() {
  const presets = useEntities('tool');
  const versions = useVersions('tool');
  const error = useLibrary((s) => s.errors.tool);
  return (
    <LibraryLayout
      title="Tools"
      newHref="/tools/new"
      newLabel="New preset"
      error={error}
      groups={
        presets && [
          {
            title: 'Presets',
            empty: 'No presets yet.',
            items: presets.map((p) => ({
              id: p.id,
              name: p.name,
              description: describeScope(p).unrestricted ? '' : describeScope(p).summary,
              href: `/tools/${p.id}`,
              icon: <BuiltinIcon id={p.builtin} />,
              extra:
                describeScope(p).unrestricted || versions[p.id]?.hasDraft ? (
                  <>
                    {describeScope(p).unrestricted && <UnrestrictedShellBadge />}
                    {versions[p.id]?.hasDraft && <DraftBadge />}
                  </>
                ) : undefined,
            })),
          },
          {
            title: 'Built-in tools',
            items: BUILTIN_TOOLS.map((t) => ({
              id: `builtin-${t.id}`,
              name: t.name,
              description: t.description,
              href: `/tools/builtin/${t.id}`,
              icon: <BuiltinIcon id={t.id} />,
            })),
          },
        ]
      }
    />
  );
}

export function ToolsIndex() {
  return (
    <EmptySelection
      icon={<Wrench />}
      title="Agents get presets, not raw tools"
      description="A preset is a built-in tool with a scope, such as “read src/** only” or “shell: npm test only”. Give each agent exactly the presets it needs."
      action={
        <Button asChild size="sm">
          <Link to="/tools/new">New preset</Link>
        </Button>
      }
    />
  );
}

export function BuiltinToolRoute() {
  const parsed = BuiltinToolId.safeParse(useParams().builtin);
  const presets = useEntities('tool');
  if (!parsed.success) return <NotFound what="built-in tool" backHref="/tools" />;
  const tool = builtinTool(parsed.data);
  const using = (presets ?? []).filter((p) => p.builtin === tool.id);

  return (
    <>
      <header className="flex items-center gap-4 border-b px-8 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Built-in tool
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{tool.name}</h1>
            <Badge variant="secondary" className="gap-1">
              <Lock />
              Read-only
            </Badge>
          </div>
        </div>
        <Button asChild size="sm">
          <Link to={`/tools/new?builtin=${tool.id}`}>Create preset</Link>
        </Button>
      </header>
      <EditorBody>
        <div className="flex items-start gap-4">
          <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
            <BuiltinIcon id={tool.id} className="size-6" />
          </div>
          <div>
            <p className="text-sm">{tool.description}</p>
            <p className="mt-1 text-sm text-muted-foreground">{SCOPE_KIND_TEXT[tool.scopeKind]}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{tool.id}</p>
          </div>
        </div>
        {tool.id === 'shell' && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            A shell preset without an allowlist is <strong>unrestricted</strong>: it bypasses every
            other restriction. It is allowed, but flagged everywhere it appears.
          </p>
        )}
        <Section title="Presets of this tool">
          {using.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-2">
              {using.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/tools/${p.id}`}
                    className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent"
                  >
                    <span className="text-sm font-medium">{p.name}</span>
                    <ScopeSummary preset={p} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </EditorBody>
    </>
  );
}

export function ToolEditorRoute() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const builtin = BuiltinToolId.safeParse(params.get('builtin'));
  const source = useEditorSource('tool', id, () =>
    builtin.success ? defaultPreset(builtin.data) : undefined,
  );
  if (!id && !builtin.success) return <BuiltinChooser />;
  if (source.state === 'notFound') return <NotFound what="tool preset" backHref="/tools" />;
  if (source.state === 'loading') return null;
  return <ToolEditor key={id ?? `new-${String(builtin.data)}`} source={source} />;
}

function BuiltinChooser() {
  return (
    <>
      <header className="border-b px-8 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          New tool preset
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Which built-in tool?</h1>
      </header>
      <EditorBody>
        <div className="grid gap-3 sm:grid-cols-2">
          {BUILTIN_TOOLS.map((t) => (
            <Link
              key={t.id}
              to={`/tools/new?builtin=${t.id}`}
              className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:border-foreground/20 hover:bg-accent"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <BuiltinIcon id={t.id} />
              </div>
              <div>
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.description}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {SCOPE_KIND_TEXT[t.scopeKind]}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </EditorBody>
    </>
  );
}

function ToolEditor({ source }: { source: EditorSourceReady<'tool'> }) {
  const editor = useEntityEditor('tool', source);
  const agents = useEntities('agent');
  const { draft, errors, update } = editor;
  useSaveShortcut(() => void editor.save());

  const id = editor.saved?.id;
  const tool = builtinTool(draft.builtin);
  const parsed = parsePreset(draft);
  const unrestricted = parsed ? describeScope(parsed).unrestricted : false;
  const usedBy = id ? (agents ?? []).filter((a) => a.tools.some((r) => r.id === id)) : [];
  const setScope = (scope: PathScope | ShellScope | DomainScope) =>
    update((d) => ({ ...d, scope }) as ToolInput);

  return (
    <>
      <UnsavedChangesGuard dirty={editor.dirty} />
      <EditorHeader
        eyebrow={editor.isNew ? 'New tool preset' : 'Tool preset'}
        title={editor.saved?.name ?? (draft.name || `Untitled ${tool.name.toLowerCase()} preset`)}
        dirty={editor.dirty}
        saving={editor.saving}
        onSave={() => void editor.save()}
        onDelete={editor.saved ? editor.remove : undefined}
        onDeleteWithReferences={editor.removeWithReferences}
        versioning={editor.versioning}
      >
        {unrestricted && <UnrestrictedShellBadge />}
      </EditorHeader>
      <EditorBody>
        <Section title="Preset">
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <BuiltinIcon id={tool.id} className="size-5 text-muted-foreground" />
            <div className="flex-1 text-sm">
              <span className="font-medium">{tool.name}</span>
              <span className="text-muted-foreground"> · {tool.description}</span>
            </div>
            {editor.isNew ? (
              <Button asChild variant="ghost" size="sm">
                <Link to="/tools/new">Change</Link>
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                Built-in is fixed after creation
              </span>
            )}
          </div>
          <Field label="Name" htmlFor="tool-name" error={errors.name}>
            <Input
              id="tool-name"
              value={draft.name}
              onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
              placeholder={
                tool.scopeKind === 'commands'
                  ? 'Run tests'
                  : tool.scopeKind === 'domains'
                    ? 'Search Python docs'
                    : 'Read src'
              }
              autoFocus={editor.isNew}
              aria-invalid={!!errors.name}
            />
          </Field>
          <Field label="Description" htmlFor="tool-description" error={errors.description}>
            <Textarea
              id="tool-description"
              value={draft.description ?? ''}
              onChange={(e) => update((d) => ({ ...d, description: e.target.value }))}
              rows={2}
              placeholder="Optional. What this preset is for."
            />
          </Field>
        </Section>

        <Section
          title="Scope"
          description={
            parsed ? (
              <span className="font-mono">{describeScope(parsed).summary}</span>
            ) : (
              'What this preset allows.'
            )
          }
        >
          {draft.builtin === 'shell' ? (
            <ShellScopeEditor
              value={{ commands: draft.scope.commands ?? [] }}
              onChange={setScope}
              errors={errors}
            />
          ) : draft.builtin === 'web_search' || draft.builtin === 'web_fetch' ? (
            <DomainScopeEditor
              value={{ allow: draft.scope.allow ?? [], deny: draft.scope.deny ?? [] }}
              onChange={setScope}
              errors={errors}
            />
          ) : (
            <PathScopeEditor
              value={{ paths: draft.scope.paths }}
              onChange={setScope}
              errors={errors}
              verb={tool.name.split(' ')[0]?.toLowerCase() ?? 'use'}
            />
          )}
        </Section>

        {!editor.isNew && (
          <Section title="Used by">
            {usedBy.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agent uses this preset yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {usedBy.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/agents/${a.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm hover:bg-accent"
                    >
                      <Bot className="size-3.5 text-muted-foreground" />
                      {a.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </EditorBody>
    </>
  );
}
