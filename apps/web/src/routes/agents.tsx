import { describeScope, type EntityInput, type Settings } from '@app/schema';
import { Bot, ShieldAlert, Sparkles } from 'lucide-react';
import { Link, useParams } from 'react-router';
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
import { useEntities, useLibrary } from '@/stores/library';
import { useSettings } from '@/stores/settings';

/**
 * Version pinned by new references. Versioning arrives in M2, which tags each entity's
 * pre-existing state as v1 (see DECISIONS.md).
 */
const PINNED_VERSION = 'v1';

export function AgentsLayout() {
  const agents = useEntities('agent');
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
  const settings = useSettings();
  const source = useEditorSource('agent', id, (): EntityInput<'agent'> | undefined =>
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
  );
  if (source.state === 'notFound') return <NotFound what="agent" backHref="/agents" />;
  if (source.state === 'loading' || !settings) return null;
  return <AgentEditor key={id ?? 'new'} source={source} settings={settings} />;
}

function AgentEditor({
  source,
  settings,
}: {
  source: EditorSourceReady<'agent'>;
  settings: Settings;
}) {
  const editor = useEntityEditor('agent', source);
  const skills = useEntities('skill');
  const tools = useEntities('tool');
  const { draft, errors, update } = editor;
  useSaveShortcut(() => void editor.save());

  const skillRefs = draft.skills ?? [];
  const toolRefs = draft.tools ?? [];
  const selectedTools = toolRefs.map((r) => ({
    ref: r,
    preset: tools?.find((t) => t.id === r.id),
  }));
  const hasUnrestricted = selectedTools.some(
    (t) => t.preset && describeScope(t.preset).unrestricted,
  );

  return (
    <>
      <UnsavedChangesGuard dirty={editor.dirty} />
      <EditorHeader
        eyebrow={editor.isNew ? 'New agent' : 'Agent'}
        title={editor.saved?.name ?? (draft.name || 'Untitled agent')}
        dirty={editor.dirty}
        saving={editor.saving}
        onSave={() => void editor.save()}
        onDelete={editor.saved ? editor.remove : undefined}
      >
        {hasUnrestricted && <UnrestrictedShellBadge />}
      </EditorHeader>
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
                    { kind: 'skill', id: skillId, version: PINNED_VERSION },
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
                const skill = skills?.find((s) => s.id === r.id);
                return (
                  <RefCard
                    key={r.id}
                    icon={<Sparkles className="size-4" />}
                    title={skill?.name ?? r.id}
                    subtitle={skill?.description}
                    href={`/skills/${r.id}`}
                    missing={skills !== undefined && !skill}
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
                    { kind: 'tool', id: toolId, version: PINNED_VERSION },
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
              {selectedTools.map(({ ref, preset }) => (
                <RefCard
                  key={ref.id}
                  icon={preset ? <BuiltinIcon id={preset.builtin} /> : undefined}
                  title={preset?.name ?? ref.id}
                  subtitle={preset ? <ScopeSummary preset={preset} /> : undefined}
                  href={`/tools/${ref.id}`}
                  missing={tools !== undefined && !preset}
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
