import {
  describeScope,
  refKey,
  type EntityInput,
  type EntityVersionSummary,
  type Ref,
  type Settings,
  type Skill,
  type ToolPreset,
} from '@app/schema';
import { UpdateAvailable } from '@/components/update-available';
import { useRegisterLocal } from '@/stores/pinned';
import { Bot, ShieldAlert, Sparkles } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { AgentDefaultsFields, modelLabel } from '@/components/agent-defaults';
import { CodeEditor } from '@/components/code-editor';
import { EditorHeader } from '@/components/editor-header';
import { Field, Section } from '@/components/field';
import { EditorBody, EmptySelection, LibraryLayout, NotFound } from '@/components/library-layout';
import { RefCard, RefPicker } from '@/components/ref-picker';
import {
  BuiltinIcon,
  ScopeSummary,
  UNRESTRICTED_SHELL_EXPLANATION,
  UnrestrictedShellBadge,
} from '@/components/tools';
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
import { useSettings } from '@/stores/settings';

/** New references pin the target's current main version (never a floating "latest"). */
function pinnedVersion(versions: Record<string, EntityVersionSummary>, id: string): string {
  return versions[id]?.version ?? 'v1';
}

/** The version a reference pins, shown on its card. */
function LocalCopyBadge() {
  return (
    <Badge
      variant="secondary"
      className="rounded-md px-1.5 py-0 text-[11px]"
      title="Deleted from the library; this agent keeps a local copy of the version it pins"
    >
      local copy
    </Badge>
  );
}

function PinnedVersion({ version }: { version: string }) {
  return (
    <Badge
      variant="outline"
      className="rounded-md px-1.5 py-0 font-mono text-[11px] text-muted-foreground"
      title={`Pinned to ${version}`}
    >
      {version}
    </Badge>
  );
}

export function AgentsLayout() {
  const agents = useEntities('agent');
  const versions = useVersions('agent');
  const tools = useEntities('tool');
  const settings = useSettings();
  const error = useLibrary((s) => s.errors.agent);
  return (
    <LibraryLayout
      title="Agents"
      newHref="/agents/new"
      newLabel="New agent"
      error={error}
      groups={
        agents && [
          {
            empty: 'No agents yet.',
            items: agents.map((a) => {
              const unrestricted = a.tools.some((r) => {
                const p = tools?.find((t) => t.id === r.id);
                return p ? describeScope(p).unrestricted : false;
              });
              return {
                id: a.id,
                name: a.name,
                description: a.description,
                href: `/agents/${a.id}`,
                icon: <Bot className="size-4" />,
                extra: (
                  <>
                    <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[11px]">
                      {modelLabel(a.defaults.model, settings?.models ?? [])}
                    </Badge>
                    {unrestricted && <UnrestrictedShellBadge />}
                    {versions[a.id]?.hasDraft && <DraftBadge />}
                  </>
                ),
              };
            }),
          },
        ]
      }
    />
  );
}

export function AgentsIndex() {
  return (
    <EmptySelection
      icon={<Bot />}
      title="An agent gets exactly what it needs"
      description="A prompt, the skills it may load, the tool presets it may use, and defaults for model, effort and limits. Nothing more."
      action={
        <Button asChild size="sm">
          <Link to="/agents/new">New agent</Link>
        </Button>
      }
    />
  );
}

export function AgentEditorRoute() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const branch = params.get('branch') ?? undefined;
  const settings = useSettings();
  const source = useEditorSource(
    'agent',
    id,
    (): EntityInput<'agent'> | undefined =>
      settings
        ? {
            name: '',
            description: '',
            prompt: '',
            skills: [],
            tools: [],
            defaults: settings.agentDefaults,
          }
        : undefined,
    branch,
  );
  if (source.state === 'notFound') return <NotFound what="agent" backHref="/agents" />;
  if (source.state === 'loading' || !settings) return null;
  return (
    <AgentEditor
      key={`${id ?? 'new'}@${branch ?? ''}`}
      source={source}
      settings={settings}
      back={params.get('back') ?? undefined}
    />
  );
}

function AgentEditor({
  source,
  settings,
  back,
}: {
  source: EditorSourceReady<'agent'>;
  settings: Settings;
  /** Where to return to, e.g. the project whose fork is being edited. */
  back?: string;
}) {
  const editor = useEntityEditor('agent', source);
  const skills = useEntities('skill');
  const tools = useEntities('tool');
  const skillVersions = useVersions('skill');
  const toolVersions = useVersions('tool');
  const { draft, errors, update } = editor;
  useSaveShortcut(() => void editor.save());
  useRegisterLocal(draft);

  const skillRefs = draft.skills ?? [];
  const toolRefs = draft.tools ?? [];
  // Deleted skills and tools this agent keeps as local copies, or as placeholders.
  const copyOf = (ref: Ref) => draft.localCopies?.[refKey(ref)]?.entity;
  const deletedName = (ref: Ref) => draft.deletedRefs?.[refKey(ref)]?.name;
  const selectedTools = toolRefs.map((r) => {
    const copy = copyOf(r);
    return {
      ref: r,
      preset: tools?.find((t) => t.id === r.id) ?? (copy as ToolPreset | undefined),
      local: !!copy && !tools?.some((t) => t.id === r.id),
    };
  });
  const repinRef = (field: 'skills' | 'tools', id: string, version: string) =>
    update((d) => ({
      ...d,
      [field]: (d[field] ?? []).map((x) => (x.id === id ? { ...x, version } : x)),
    }));
  const hasUnrestricted = selectedTools.some(
    (t) => t.preset && describeScope(t.preset).unrestricted,
  );

  return (
    <>
      <UnsavedChangesGuard dirty={editor.dirty} />
      <EditorHeader
        eyebrow={
          editor.isNew ? 'New agent' : source.branch !== 'draft' ? 'Agent · project fork' : 'Agent'
        }
        title={editor.saved?.name ?? (draft.name || 'Untitled agent')}
        dirty={editor.dirty}
        saving={editor.saving}
        onSave={() => void editor.save()}
        onDelete={editor.saved && source.branch === 'draft' ? editor.remove : undefined}
        onDeleteWithReferences={editor.removeWithReferences}
        versioning={editor.versioning}
      >
        {hasUnrestricted && <UnrestrictedShellBadge />}
      </EditorHeader>
      {back && back.startsWith('/') && (
        <div className="border-b bg-violet-50 px-8 py-2 text-sm">
          <Link
            to={back}
            className="font-medium text-violet-800 underline-offset-4 hover:underline"
          >
            ← Back to the project
          </Link>
          <span className="ml-2 text-muted-foreground">
            Changes here affect only the project node that pins this fork.
          </span>
        </div>
      )}
      <EditorBody>
        <Section title="Identity">
          <Field label="Name" htmlFor="agent-name" error={errors.name}>
            <Input
              id="agent-name"
              value={draft.name}
              onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
              placeholder="Reviewer"
              autoFocus={editor.isNew}
              aria-invalid={!!errors.name}
            />
          </Field>
          <Field label="Description" htmlFor="agent-description" error={errors.description}>
            <Textarea
              id="agent-description"
              value={draft.description ?? ''}
              onChange={(e) => update((d) => ({ ...d, description: e.target.value }))}
              rows={2}
              placeholder="Optional. What this agent is for."
            />
          </Field>
        </Section>

        <Section title="Prompt" description="The agent's system prompt (markdown).">
          <CodeEditor
            language="markdown"
            value={draft.prompt ?? ''}
            onChange={(prompt) => update((d) => ({ ...d, prompt }))}
            height={300}
            ariaLabel="Agent prompt"
          />
        </Section>

        <Section
          title="Skills"
          description="Instructions this agent may load. Each one adds to its context."
          actions={
            <RefPicker
              items={skills?.map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description,
                icon: <Sparkles className="size-4" />,
              }))}
              selectedIds={skillRefs.map((r) => r.id)}
              onAdd={(skillId) =>
                update((d) => ({
                  ...d,
                  skills: [
                    ...(d.skills ?? []),
                    { kind: 'skill', id: skillId, version: pinnedVersion(skillVersions, skillId) },
                  ],
                }))
              }
              addLabel="Add skill"
              searchPlaceholder="Search skills"
              createHref="/skills/new"
              createLabel="Create a new skill"
            />
          }
        >
          {skillRefs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No skills. The agent only gets its prompt.
            </p>
          ) : (
            <div className="space-y-2">
              {skillRefs.map((r) => {
                const inLibrary = skills?.find((s) => s.id === r.id);
                const copy = inLibrary ? undefined : (copyOf(r) as Skill | undefined);
                const skill = inLibrary ?? copy;
                return (
                  <RefCard
                    key={r.id}
                    icon={<Sparkles className="size-4" />}
                    title={skill?.name ?? deletedName(r) ?? r.id}
                    badge={
                      <>
                        <PinnedVersion version={r.version} />
                        {copy && <LocalCopyBadge />}
                        <UpdateAvailable
                          kind="skill"
                          id={r.id}
                          version={r.version}
                          name={skill?.name ?? r.id}
                          onUpdate={(to) => repinRef('skills', r.id, to)}
                        />
                      </>
                    }
                    subtitle={skill?.description}
                    href={copy ? undefined : `/skills/${r.id}`}
                    missing={skills !== undefined && !skill}
                    missingLabel={deletedName(r) ? 'deleted from the library' : undefined}
                    onRemove={() =>
                      update((d) => ({
                        ...d,
                        skills: (d.skills ?? []).filter((x) => x.id !== r.id),
                      }))
                    }
                  />
                );
              })}
            </div>
          )}
        </Section>

        <Section
          title="Tools"
          description="Tool presets this agent may use, with their scopes."
          actions={
            <RefPicker
              items={tools?.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                icon: <BuiltinIcon id={t.builtin} />,
                extra: <ScopeSummary preset={t} />,
              }))}
              selectedIds={toolRefs.map((r) => r.id)}
              onAdd={(toolId) =>
                update((d) => ({
                  ...d,
                  tools: [
                    ...(d.tools ?? []),
                    { kind: 'tool', id: toolId, version: pinnedVersion(toolVersions, toolId) },
                  ],
                }))
              }
              addLabel="Add tool"
              searchPlaceholder="Search tool presets"
              createHref="/tools/new"
              createLabel="Create a new preset"
            />
          }
        >
          {hasUnrestricted && (
            <div
              role="alert"
              className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p>
                <span className="font-semibold text-destructive">Unrestricted shell. </span>
                <span className="text-muted-foreground">{UNRESTRICTED_SHELL_EXPLANATION}</span>
              </p>
            </div>
          )}
          {toolRefs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tools. The agent can only reply.</p>
          ) : (
            <div className="space-y-2">
              {selectedTools.map(({ ref, preset, local }) => (
                <RefCard
                  key={ref.id}
                  icon={preset ? <BuiltinIcon id={preset.builtin} /> : undefined}
                  title={preset?.name ?? deletedName(ref) ?? ref.id}
                  badge={
                    <>
                      <PinnedVersion version={ref.version} />
                      {local && <LocalCopyBadge />}
                      <UpdateAvailable
                        kind="tool"
                        id={ref.id}
                        version={ref.version}
                        name={preset?.name ?? ref.id}
                        onUpdate={(to) => repinRef('tools', ref.id, to)}
                      />
                    </>
                  }
                  subtitle={preset ? <ScopeSummary preset={preset} /> : undefined}
                  href={local ? undefined : `/tools/${ref.id}`}
                  missing={tools !== undefined && !preset}
                  missingLabel={deletedName(ref) ? 'deleted from the library' : undefined}
                  onRemove={() =>
                    update((d) => ({ ...d, tools: (d.tools ?? []).filter((x) => x.id !== ref.id) }))
                  }
                />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Defaults"
          description="Projects can override model, effort and limits per instance without forking the agent."
        >
          <AgentDefaultsFields
            value={draft.defaults}
            onChange={(defaults) => update((d) => ({ ...d, defaults }))}
            models={settings.models}
            errors={errors}
            pathPrefix="defaults"
          />
        </Section>
      </EditorBody>
    </>
  );
}
