import type { EntityInput } from '@app/schema';
import { Bot, Sparkles } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { CodeEditor } from '@/components/code-editor';
import { EditorHeader } from '@/components/editor-header';
import { CharCounter, Field, Section } from '@/components/field';
import { EditorBody, EmptySelection, LibraryLayout, NotFound } from '@/components/library-layout';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
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

function SkillEditor({ source }: { source: EditorSourceReady<'skill'> }) {
  const editor = useEntityEditor('skill', source);
  const agents = useEntities('agent');
  const { draft, errors, update } = editor;
  useSaveShortcut(() => void editor.save());

  const id = editor.saved?.id;
  const usedBy = id ? (agents ?? []).filter((a) => a.skills.some((r) => r.id === id)) : [];
  const description = draft.description ?? '';

  return (
    <>
      <UnsavedChangesGuard dirty={editor.dirty} />
      <EditorHeader
        eyebrow={editor.isNew ? 'New skill' : 'Skill'}
        title={editor.saved?.name ?? (draft.name || 'Untitled skill')}
        dirty={editor.dirty}
        saving={editor.saving}
        onSave={() => void editor.save()}
        onDelete={editor.saved ? editor.remove : undefined}
      />
      <EditorBody>
        <Section title="Frontmatter" description="Stored as YAML at the top of SKILL.md.">
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
        </Section>

        <Section title="Instructions" description="The markdown body of SKILL.md.">
          <CodeEditor
            language="markdown"
            value={draft.body ?? ''}
            onChange={(body) => update((d) => ({ ...d, body }))}
            height={420}
            ariaLabel="Skill instructions"
            placeholder="# Write unit tests&#10;&#10;- One behaviour per test"
          />
        </Section>

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
