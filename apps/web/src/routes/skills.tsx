import { skillFromMarkdown, skillToMarkdown, type EntityInput } from '@app/schema';
import { Bot, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Link, useParams } from 'react-router';
import { CodeEditor } from '@/components/code-editor';
import { EditorHeader } from '@/components/editor-header';
import { CharCounter, Field, Section } from '@/components/field';
import { EditorBody, EmptySelection, LibraryLayout, NotFound } from '@/components/library-layout';
import {
  AdvancedSkillFields,
  RawSkillProblems,
  countAdvancedFields,
} from '@/components/skill-advanced';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  useEditorSource,
  useEntityEditor,
  type EditorSourceReady,
} from '@/hooks/use-entity-editor';
import { useBooleanPreference } from '@/hooks/use-preference';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { cn } from '@/lib/utils';
import { useEntities, useLibrary, useVersions } from '@/stores/library';
import { DraftBadge } from '@/components/versioning';

/** Agent Skills names: lowercase letters, digits and single hyphens. Normalised as you type. */
export function toSkillName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64);
}

export function SkillsLayout() {
  const skills = useEntities('skill');
  const versions = useVersions('skill');
  const error = useLibrary((s) => s.errors.skill);
  return (
    <LibraryLayout
      title="Skills"
      newHref="/skills/new"
      newLabel="New skill"
      error={error}
      groups={
        skills && [
          {
            items: skills.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              href: `/skills/${s.id}`,
              icon: <Sparkles className="size-4" />,
              extra: versions[s.id]?.hasDraft ? <DraftBadge /> : undefined,
            })),
            empty: 'No skills yet.',
          },
        ]
      }
    />
  );
}

export function SkillsIndex() {
  return (
    <EmptySelection
      icon={<Sparkles />}
      title="Skills are instructions an agent can load"
      description="Markdown files in the Agent Skills format: a name, a description that tells agents when to use it, and the instructions themselves."
      action={
        <Button asChild size="sm">
          <Link to="/skills/new">New skill</Link>
        </Button>
      }
    />
  );
}

const NEW_SKILL: EntityInput<'skill'> = { name: '', description: '', body: '' };

export function SkillEditorRoute() {
  const { id } = useParams();
  const source = useEditorSource('skill', id, () => NEW_SKILL);
  if (source.state === 'notFound') return <NotFound what="skill" backHref="/skills" />;
  if (source.state === 'loading') return null;
  return <SkillEditor key={id ?? 'new'} source={source} />;
}

type SkillInput = EntityInput<'skill'>;

function SkillEditor({ source }: { source: EditorSourceReady<'skill'> }) {
  const editor = useEntityEditor('skill', source);
  const agents = useEntities('agent');
  const { draft, errors, update } = editor;

  // Advanced options stay hidden unless the user asks for them (remembered per browser).
  const [advanced, setAdvanced] = useBooleanPreference('skills.showAdvanced');
  const [mode, setMode] = useState<'form' | 'raw'>('form');
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState<string>();
  const [otherFieldsError, setOtherFieldsError] = useState<string>();
  const blockingError = mode === 'raw' ? rawError : advanced ? otherFieldsError : undefined;

  const save = () => {
    if (blockingError) {
      toast.error('Fix the YAML before saving', { description: blockingError });
      return;
    }
    void editor.save();
  };
  useSaveShortcut(save);

  const toRaw = () => {
    setRawText(skillToMarkdown({ ...draft, body: draft.body ?? '' }));
    setRawError(undefined);
    setMode('raw');
  };
  const toForm = (): boolean => {
    if (rawError) {
      toast.error('Fix the SKILL.md before switching back', { description: rawError });
      return false;
    }
    setOtherFieldsError(undefined);
    setMode('form');
    return true;
  };
  const onRawChange = (text: string) => {
    setRawText(text);
    try {
      const parsed = skillFromMarkdown(text);
      const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
      // Keep name/description strings so the form inputs stay controlled.
      update(() => ({
        ...(parsed as SkillInput),
        name: str(parsed.name),
        description: str(parsed.description),
      }));
      setRawError(undefined);
    } catch (err) {
      setRawError(err instanceof Error ? err.message : String(err));
    }
  };
  const toggleAdvanced = () => {
    if (advanced && mode === 'raw' && !toForm()) return;
    if (advanced) setOtherFieldsError(undefined);
    setAdvanced(!advanced);
  };

  const id = editor.saved?.id;
  const usedBy = id ? (agents ?? []).filter((a) => a.skills.some((r) => r.id === id)) : [];
  const description = draft.description ?? '';
  const advancedCount = countAdvancedFields(draft);

  return (
    <>
      <UnsavedChangesGuard dirty={editor.dirty} />
      <EditorHeader
        eyebrow={editor.isNew ? 'New skill' : 'Skill'}
        title={editor.saved?.name ?? (draft.name || 'Untitled skill')}
        dirty={editor.dirty}
        saving={editor.saving}
        onSave={save}
        onDelete={editor.saved ? editor.remove : undefined}
        onDeleteWithReferences={editor.removeWithReferences}
        versioning={editor.versioning}
        actions={
          <>
            {advanced && (
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={mode}
                onValueChange={(v) => {
                  if (v === 'raw' && mode !== 'raw') toRaw();
                  if (v === 'form' && mode !== 'form') toForm();
                }}
                aria-label="Edit as"
                className="duration-200 animate-in fade-in"
              >
                <ToggleGroupItem value="form" className="px-3">
                  Form
                </ToggleGroupItem>
                <ToggleGroupItem value="raw" className="px-3 font-mono">
                  SKILL.md
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            <Button
              type="button"
              variant={advanced ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={advanced}
              onClick={toggleAdvanced}
            >
              <SlidersHorizontal />
              {advanced ? 'Hide advanced' : 'Advanced'}
              {!advanced && advancedCount > 0 && (
                <Badge variant="secondary" className="ml-0.5 rounded-md px-1.5 py-0 text-[11px]">
                  {advancedCount}
                </Badge>
              )}
            </Button>
          </>
        }
      />
      <EditorBody wide={advanced}>
        {mode === 'raw' ? (
          <Section
            title="SKILL.md"
            description="The whole file: YAML frontmatter between the --- lines, then the markdown body. Changes show up in the form."
          >
            <CodeEditor
              language="markdown"
              value={rawText}
              onChange={onRawChange}
              height={560}
              ariaLabel="SKILL.md"
            />
            <RawSkillProblems parseError={rawError} errors={rawError ? {} : errors} />
          </Section>
        ) : (
          <>
            <Section title="Frontmatter" description="Stored as YAML at the top of SKILL.md.">
              <div className={cn('grid items-start gap-6', advanced && 'lg:grid-cols-2')}>
                <div className="space-y-4">
                  <Field
                    label="Name"
                    htmlFor="skill-name"
                    error={errors.name}
                    hint="Lowercase letters, digits and hyphens (Agent Skills format). Spaces become hyphens."
                  >
                    <Input
                      id="skill-name"
                      value={draft.name}
                      onChange={(e) => update((d) => ({ ...d, name: toSkillName(e.target.value) }))}
                      placeholder="write-unit-tests"
                      className="font-mono"
                      autoFocus={editor.isNew}
                      aria-invalid={!!errors.name}
                    />
                  </Field>
                  <Field
                    label="Description"
                    htmlFor="skill-description"
                    error={errors.description}
                    aside={<CharCounter value={description} max={1024} />}
                    hint="What the skill does and when an agent should use it. Agents see this before deciding to load the body."
                  >
                    <Textarea
                      id="skill-description"
                      value={description}
                      onChange={(e) => update((d) => ({ ...d, description: e.target.value }))}
                      placeholder="Write focused unit tests for changed code. Use when adding or changing behaviour."
                      rows={3}
                      aria-invalid={!!errors.description}
                    />
                  </Field>
                </div>
                {advanced && (
                  <AdvancedSkillFields
                    draft={draft}
                    update={update}
                    errors={errors}
                    onYamlError={setOtherFieldsError}
                  />
                )}
              </div>
            </Section>

            <Section title="Instructions" description="The markdown body of SKILL.md.">
              <CodeEditor
                language="markdown"
                value={draft.body ?? ''}
                onChange={(body) => update((d) => ({ ...d, body }))}
                height={420}
                ariaLabel="Skill instructions"
              />
            </Section>
          </>
        )}

        {!editor.isNew && (
          <Section title="Used by">
            {usedBy.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agent uses this skill yet.</p>
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
