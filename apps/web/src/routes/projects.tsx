import { slugify, type EntityInput, type Template, type WorkspaceCheck } from '@app/schema';
import { ReactFlowProvider } from '@xyflow/react';
import { FolderGit2, FolderKanban, LayoutTemplate, Plus, Workflow } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { WorkflowEditor } from '@/canvas/workflow-editor';
import { Field } from '@/components/field';
import { NotFound } from '@/components/library-layout';
import { DraftBadge } from '@/components/versioning';
import { NewWorkspaceFields, WorkspaceField, joinPath } from '@/components/workspace-field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { readPreference, writePreference } from '@/hooks/use-preference';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useEditorSource } from '@/hooks/use-entity-editor';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { issuesToErrors } from '@/lib/validation';
import { useEntities, useLibrary, useVersions } from '@/stores/library';

/** The last location a new workspace folder was created in (per browser). */
const LOCATION_KEY = 'app.newWorkspaceLocation';

/** A new blank workflow: an Input and an Output, ready to be connected. */
function blankWorkflow(): Pick<EntityInput<'project'>, 'workflow' | 'layout'> {
  return {
    workflow: {
      nodes: [
        { id: 'input', type: 'input', name: 'Task', payloadType: 'text', content: '', files: [] },
        { id: 'output', type: 'output', name: 'Result', payloadType: 'text' },
      ],
      edges: [],
    },
    layout: { nodes: { input: { x: 0, y: 0 }, output: { x: 640, y: 0 } }, expanded: [] },
  };
}

export function ProjectsPage() {
  const projects = useEntities('project');
  const templates = useEntities('template');
  const versions = useVersions('project');
  const [creating, setCreating] = useState<{ template?: Template } | null>(null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-10 px-8 py-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
            <p className="text-sm text-muted-foreground">
              One project is one workflow, working on one workspace repo.
            </p>
          </div>
          <Button onClick={() => setCreating({})}>
            <Plus />
            New project
          </Button>
        </header>

        <section aria-label="Projects">
          {!projects ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FolderKanban className="size-6" />
              </div>
              <p className="mt-4 text-sm font-medium">No projects yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                A project connects a workflow of agents to the git repo it works on.
              </p>
              <Button className="mt-4" size="sm" onClick={() => setCreating({})}>
                New project
              </Button>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/projects/${p.id}`}
                    className="flex h-full flex-col rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-foreground/20 hover:bg-accent/40"
                  >
                    <div className="flex items-start gap-2">
                      <Workflow className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 font-medium">{p.name}</span>
                      {versions[p.id]?.version && (
                        <Badge
                          variant="outline"
                          className="rounded-md px-1.5 py-0 font-mono text-[11px]"
                        >
                          {versions[p.id]?.version}
                        </Badge>
                      )}
                      {versions[p.id]?.hasDraft && <DraftBadge />}
                    </div>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {p.description}
                      </p>
                    )}
                    <div className="mt-auto pt-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5 truncate font-mono">
                        <FolderGit2 className="size-3.5 shrink-0" />
                        <span className="truncate">{p.workspacePath}</span>
                      </div>
                      <div className="mt-1">
                        {p.workflow.nodes.length} nodes · {p.workflow.edges.length} edges
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Workflow templates" className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Workflow templates</h2>
            <p className="text-sm text-muted-foreground">
              Start a project from a saved workflow. Save one with “Save as template” on a project.
            </p>
          </div>
          {templates && templates.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => (
                <li key={t.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <LayoutTemplate className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.workflow.nodes.length} nodes
                    </div>
                  </div>
                  <Button size="xs" variant="ghost" asChild>
                    <Link to={`/templates/${t.id}`}>Open</Link>
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => setCreating({ template: t })}>
                    Use
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No templates yet.</p>
          )}
        </section>
      </div>

      <Dialog open={creating !== null} onOpenChange={(open) => !open && setCreating(null)}>
        <DialogContent className="sm:max-w-xl">
          {creating && (
            <NewProjectForm
              initialTemplate={creating.template}
              templates={templates ?? []}
              onCancel={() => setCreating(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewProjectForm({
  initialTemplate,
  templates,
  onCancel,
}: {
  initialTemplate: Template | undefined;
  templates: Template[];
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const upsert = useLibrary((s) => s.upsert);
  const setVersion = useLibrary((s) => s.setVersion);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [workspacePath, setWorkspacePath] = useState('');
  const [location, setLocation] = useState(() => readPreference(LOCATION_KEY) ?? '~/');
  /** Follows the project name until edited by hand. */
  const [folder, setFolder] = useState<string>();
  const folderName = folder ?? (name.trim() ? slugify(name) : '');
  const [templateId, setTemplateId] = useState<string | undefined>(initialTemplate?.id);
  const [check, setCheck] = useState<WorkspaceCheck>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const onCheck = useCallback((c: WorkspaceCheck | undefined) => setCheck(c), []);

  const template = templates.find((t) => t.id === templateId);
  const ready = name.trim() !== '' && check?.status === 'ok';

  const create = async () => {
    setSaving(true);
    try {
      const start = template
        ? { workflow: template.workflow, layout: template.layout }
        : blankWorkflow();
      const res = await api.createProject(
        {
          name: name.trim(),
          description,
          workspacePath: mode === 'new' ? joinPath(location, folderName) : workspacePath,
          overrides: {},
          ...start,
        },
        { createWorkspace: mode === 'new' },
      );
      if (mode === 'new') writePreference(LOCATION_KEY, location);
      upsert('project', res.entity);
      setVersion('project', res.entity.id, { version: res.status.current, hasDraft: false });
      toast.success(`Created “${res.entity.name}”`);
      void navigate(`/projects/${res.entity.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(issuesToErrors(err.issues));
      toast.error('Could not create the project', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void create();
      }}
    >
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          A project is one workflow that works on one git repo (the workspace).
        </DialogDescription>
      </DialogHeader>
      <Field label="Name" htmlFor="new-project-name" error={errors.name}>
        <Input
          id="new-project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Checkout service"
          autoFocus
        />
      </Field>
      <Field label="Description" htmlFor="new-project-description">
        <Textarea
          id="new-project-description"
          value={description}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional."
        />
      </Field>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Workspace</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(v) => {
              if (!v) return;
              setMode(v as 'new' | 'existing');
              setCheck(undefined);
            }}
            aria-label="Workspace mode"
          >
            <ToggleGroupItem value="new" className="px-3 text-xs">
              New folder
            </ToggleGroupItem>
            <ToggleGroupItem value="existing" className="px-3 text-xs">
              Existing repo
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {mode === 'new' ? (
          <NewWorkspaceFields
            location={location}
            folder={folderName}
            onLocationChange={setLocation}
            onFolderChange={setFolder}
            onCheck={onCheck}
            error={errors.workspacePath}
          />
        ) : (
          <WorkspaceField
            id="new-project-workspace"
            label="Repo folder"
            value={workspacePath}
            onChange={setWorkspacePath}
            onCheck={onCheck}
            error={errors.workspacePath}
          />
        )}
        <p className="text-xs text-muted-foreground">
          The git repo of the product this workflow works on. The app only stores its path.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Start from</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <StartOption
            selected={!templateId}
            onSelect={() => setTemplateId(undefined)}
            title="Blank"
            description="An Input and an Output to build between."
          />
          {templates.map((t) => (
            <StartOption
              key={t.id}
              selected={templateId === t.id}
              onSelect={() => setTemplateId(t.id)}
              title={t.name}
              description={`Template · ${t.workflow.nodes.length} nodes`}
            />
          ))}
        </div>
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready || saving}>
          Create project
        </Button>
      </DialogFooter>
    </form>
  );
}

function StartOption({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'rounded-lg border p-3 text-left transition-colors hover:bg-accent',
        selected && 'border-primary ring-1 ring-primary',
      )}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </button>
  );
}

export function TemplateCanvasRoute() {
  const { id } = useParams();
  const source = useEditorSource('template', id, () => undefined);
  if (source.state === 'notFound') return <NotFound what="template" backHref="/projects" />;
  if (source.state === 'loading') return null;
  return (
    <ReactFlowProvider>
      <WorkflowEditor key={id} kind="template" source={source} />
    </ReactFlowProvider>
  );
}

export function ProjectCanvasRoute() {
  const { id } = useParams();
  const source = useEditorSource('project', id, () => undefined);
  if (source.state === 'notFound') return <NotFound what="project" backHref="/projects" />;
  if (source.state === 'loading') return null;
  return (
    <ReactFlowProvider>
      <WorkflowEditor key={id} kind="project" source={source} />
    </ReactFlowProvider>
  );
}
