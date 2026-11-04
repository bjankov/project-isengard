import {
  NODE_TYPE_INFO,
  analyzeLoops,
  inferPayload,
  newLocalId,
  type ArtifactFileType,
  type BuiltinToolId,
  type ContextMode,
  type ContextModeName,
  type Evaluator,
  type PayloadType,
  type Settings,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkspaceCheck,
} from '@app/schema';
import { Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { ModelSelect } from '@/components/agent-defaults';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WorkspaceField } from '@/components/workspace-field';
import { errorAt, type FieldErrors } from '@/lib/validation';
import { useEntities, useVersions } from '@/stores/library';
import { AgentInspector } from './agent-inspector';
import { nodeTitle, updateEdge, updateNode, type Change, type ProjectDoc } from './doc';
import { EnumSelect, OptionalNumber, StringList } from './fields';
import { NODE_META } from './node-meta';

export interface Selection {
  nodes: string[];
  edges: string[];
}

interface InspectorProps {
  projectId: string;
  doc: ProjectDoc;
  change: Change;
  selection: Selection;
  settings: Settings | undefined;
  errors: FieldErrors;
  onDeleteSelection: () => void;
  onWorkspaceCheck: (check: WorkspaceCheck | undefined) => void;
}

const PAYLOADS: { value: PayloadType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'file', label: 'File' },
  { value: 'code', label: 'Code / diff' },
  { value: 'none', label: 'None (start after)' },
];

const FILE_TYPES: { value: ArtifactFileType; label: string }[] = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'text', label: 'Text' },
  { value: 'code', label: 'Code' },
  { value: 'other', label: 'Other' },
];

const CONTEXT_MODES: { value: ContextModeName; label: string; description: string }[] = [
  { value: 'full', label: 'Full', description: 'the whole upstream output' },
  { value: 'reference', label: 'Reference', description: 'a path, read on demand' },
  { value: 'excerpt', label: 'Excerpt', description: 'a deterministic slice' },
  { value: 'diff', label: 'Diff', description: 'only the changes' },
  { value: 'summary', label: 'Summary', description: 'condensed by an LLM' },
  { value: 'outcome-only', label: 'Outcome only', description: 'the decision taken' },
];

/** Arguments a tool step asks for, per built-in tool. */
const TOOL_ARGS: Record<BuiltinToolId, { key: string; label: string; placeholder: string }[]> = {
  shell: [{ key: 'command', label: 'Command', placeholder: 'npm test' }],
  read_file: [{ key: 'path', label: 'Path', placeholder: 'src/index.ts' }],
  write_file: [{ key: 'path', label: 'Path', placeholder: 'out/report.md' }],
  edit_file: [{ key: 'path', label: 'Path', placeholder: 'src/index.ts' }],
  search_files: [
    { key: 'pattern', label: 'Pattern', placeholder: 'TODO' },
    { key: 'path', label: 'In path', placeholder: 'src/' },
  ],
  web_search: [{ key: 'query', label: 'Query', placeholder: 'latest release notes' }],
  web_fetch: [{ key: 'url', label: 'URL', placeholder: 'https://example.com' }],
};

function defaultContext(mode: ContextModeName, settings: Settings | undefined): ContextMode {
  switch (mode) {
    case 'excerpt':
      return { mode, selector: { kind: 'heading', heading: '' } };
    case 'diff':
      return { mode, base: 'workspace-head' };
    case 'summary':
      return {
        mode,
        model: settings?.agentDefaults.model ?? {
          provider: 'anthropic',
          model: 'claude-haiku-5-5',
        },
        instruction: '',
      };
    default:
      return { mode } as ContextMode;
  }
}

function PanelHeader({
  icon,
  title,
  subtitle,
  onDelete,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b px-4 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {onDelete && (
        <Button variant="ghost" size="icon-sm" aria-label="Delete selection" onClick={onDelete}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

export function Inspector(props: InspectorProps) {
  const { selection, doc } = props;
  const node =
    selection.nodes.length === 1 && selection.edges.length === 0
      ? doc.workflow.nodes.find((n) => n.id === selection.nodes[0])
      : undefined;
  const edge =
    selection.edges.length === 1 && selection.nodes.length === 0
      ? doc.workflow.edges.find((e) => e.id === selection.edges[0])
      : undefined;

  return (
    <aside
      className="flex w-[360px] shrink-0 flex-col overflow-hidden border-l bg-background"
      aria-label="Inspector"
    >
      {node ? (
        <NodePanel {...props} node={node} />
      ) : edge ? (
        <EdgePanel {...props} edge={edge} />
      ) : selection.nodes.length + selection.edges.length > 1 ? (
        <PanelHeader
          title={`${selection.nodes.length} nodes, ${selection.edges.length} edges selected`}
          subtitle="Drag to move them together, or delete them."
          onDelete={props.onDeleteSelection}
        />
      ) : (
        <ProjectPanel {...props} />
      )}
    </aside>
  );
}

// ---- Project ----

function ProjectPanel({ doc, change, errors, onWorkspaceCheck }: InspectorProps) {
  const counts = doc.workflow.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <>
      <PanelHeader title="Project" subtitle="Select a node or edge to configure it." />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Name" htmlFor="project-name" error={errors.name}>
          <Input
            id="project-name"
            value={doc.name}
            onChange={(e) => change((d) => ({ ...d, name: e.target.value }), 'project:name')}
          />
        </Field>
        <Field label="Description" htmlFor="project-description">
          <Textarea
            id="project-description"
            value={doc.description}
            rows={3}
            onChange={(e) =>
              change((d) => ({ ...d, description: e.target.value }), 'project:description')
            }
          />
        </Field>
        <Field label="Workspace" htmlFor="project-workspace">
          <WorkspaceField
            id="project-workspace"
            value={doc.workspacePath}
            onChange={(workspacePath) =>
              change((d) => ({ ...d, workspacePath }), 'project:workspace')
            }
            onCheck={onWorkspaceCheck}
            error={errors.workspacePath}
          />
        </Field>
        <div className="text-xs text-muted-foreground">
          {doc.workflow.nodes.length} nodes, {doc.workflow.edges.length} edges
          {Object.keys(counts).length > 0 &&
            ` (${Object.entries(counts)
              .map(
                ([t, n]) => `${n} ${NODE_TYPE_INFO[t as WorkflowNode['type']].label.toLowerCase()}`,
              )
              .join(', ')})`}
        </div>
      </div>
    </>
  );
}

// ---- Nodes ----

function NodePanel(props: InspectorProps & { node: WorkflowNode }) {
  const { node, doc, change, errors, projectId, settings } = props;
  const meta = NODE_META[node.type];
  const Icon = meta.icon;
  const index = doc.workflow.nodes.indexOf(node);
  const err = (field: string) => errorAt(errors, `workflow.nodes.${index}.${field}`);
  const set = (fn: (n: WorkflowNode) => WorkflowNode, key: string) =>
    change((d) => updateNode(d, node.id, fn), `node:${node.id}:${key}`);
  const agentNames = Object.fromEntries((useEntities('agent') ?? []).map((a) => [a.id, a.name]));

  return (
    <>
      <PanelHeader
        icon={
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-md border ${meta.accent}`}
          >
            <Icon className="size-4" />
          </span>
        }
        title={nodeTitle(node, agentNames)}
        subtitle={NODE_TYPE_INFO[node.type].label}
        onDelete={props.onDeleteSelection}
      />
      <div className="flex-1 space-y-4 overflow-y-auto p-4" key={node.id}>
        {node.type !== 'note' && (
          <Field
            label={node.type === 'decision' ? 'Question' : 'Label'}
            htmlFor="node-label"
            hint={
              node.type === 'decision'
                ? 'Shown in the diamond, e.g. “tests pass?”.'
                : 'Optional. Replaces the default title on the canvas.'
            }
          >
            <Input
              id="node-label"
              value={node.label ?? ''}
              onChange={(e) => set((n) => ({ ...n, label: e.target.value || undefined }), 'label')}
            />
          </Field>
        )}

        {node.type === 'input' && (
          <>
            <Field label="Name" htmlFor="node-name" error={err('name')}>
              <Input
                id="node-name"
                value={node.name}
                onChange={(e) => set((n) => ({ ...n, name: e.target.value }), 'name')}
              />
            </Field>
            <Field label="Payload" htmlFor="node-payload">
              <EnumSelect
                id="node-payload"
                value={node.payloadType}
                options={PAYLOADS.filter((p) => p.value !== 'none')}
                onChange={(payloadType) =>
                  set((n) => ({ ...n, payloadType }) as WorkflowNode, 'payload')
                }
              />
            </Field>
            <Field
              label="Task"
              htmlFor="node-content"
              hint="The initial prompt the workflow starts from."
            >
              <Textarea
                id="node-content"
                value={node.content}
                rows={6}
                onChange={(e) => set((n) => ({ ...n, content: e.target.value }), 'content')}
              />
            </Field>
            <Field
              label="Attached files"
              hint="Workspace-relative paths or globs."
              error={err('files')}
            >
              <StringList
                values={node.files}
                onChange={(files) => set((n) => ({ ...n, files }), 'files')}
                placeholder="docs/spec.md"
                addLabel="Add file"
                itemLabel="File"
              />
            </Field>
          </>
        )}

        {node.type === 'output' && (
          <>
            <Field label="Name" htmlFor="node-name" error={err('name')}>
              <Input
                id="node-name"
                value={node.name}
                onChange={(e) => set((n) => ({ ...n, name: e.target.value }), 'name')}
              />
            </Field>
            <Field label="Payload" htmlFor="node-payload">
              <EnumSelect
                id="node-payload"
                value={node.payloadType}
                options={PAYLOADS.filter((p) => p.value !== 'none')}
                onChange={(payloadType) =>
                  set((n) => ({ ...n, payloadType }) as WorkflowNode, 'payload')
                }
              />
            </Field>
          </>
        )}

        {node.type === 'agent' && (
          <AgentInspector
            projectId={projectId}
            nodeId={node.id}
            doc={doc}
            change={change}
            settings={settings}
          />
        )}

        {node.type === 'artifact' && (
          <>
            <Field
              label="Path"
              htmlFor="node-path"
              hint="Workspace-relative path or glob, e.g. PLAN.md or src/**."
              error={err('path')}
            >
              <Input
                id="node-path"
                value={node.path}
                className="font-mono text-sm"
                onChange={(e) => set((n) => ({ ...n, path: e.target.value }), 'path')}
              />
            </Field>
            <Field label="File type" htmlFor="node-filetype">
              <EnumSelect
                id="node-filetype"
                value={node.fileType}
                options={FILE_TYPES}
                onChange={(fileType) =>
                  set((n) => ({ ...n, fileType }) as WorkflowNode, 'fileType')
                }
              />
            </Field>
          </>
        )}

        {node.type === 'toolStep' && <ToolStepFields node={node} set={set} err={err} />}

        {node.type === 'humanInput' && (
          <>
            <Field label="Instructions" htmlFor="node-instructions">
              <Textarea
                id="node-instructions"
                value={node.instructions}
                rows={4}
                onChange={(e) =>
                  set((n) => ({ ...n, instructions: e.target.value }), 'instructions')
                }
              />
            </Field>
            <Field label="Requested fields" error={err('fields')}>
              <div className="space-y-2">
                {node.fields.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <Input
                      value={f.label}
                      aria-label={`Field ${i + 1} label`}
                      className="h-8 text-xs"
                      onChange={(e) =>
                        set(
                          (n) =>
                            n.type === 'humanInput'
                              ? {
                                  ...n,
                                  fields: n.fields.map((x) =>
                                    x.id === f.id ? { ...x, label: e.target.value } : x,
                                  ),
                                }
                              : n,
                          `field:${f.id}`,
                        )
                      }
                    />
                    <EnumSelect
                      value={f.kind}
                      className="h-8 w-28 text-xs"
                      options={[
                        { value: 'text', label: 'Text' },
                        { value: 'longText', label: 'Long text' },
                        { value: 'file', label: 'File' },
                      ]}
                      onChange={(kind) =>
                        set(
                          (n) =>
                            n.type === 'humanInput'
                              ? {
                                  ...n,
                                  fields: n.fields.map((x) => (x.id === f.id ? { ...x, kind } : x)),
                                }
                              : n,
                          `field:${f.id}:kind`,
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove field ${i + 1}`}
                      onClick={() =>
                        set(
                          (n) =>
                            n.type === 'humanInput'
                              ? { ...n, fields: n.fields.filter((x) => x.id !== f.id) }
                              : n,
                          'fields',
                        )
                      }
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    set(
                      (n) =>
                        n.type === 'humanInput'
                          ? {
                              ...n,
                              fields: [
                                ...n.fields,
                                {
                                  id: newLocalId(
                                    'f',
                                    n.fields.map((x) => x.id),
                                  ),
                                  label: `Field ${n.fields.length + 1}`,
                                  kind: 'text',
                                  required: true,
                                },
                              ],
                            }
                          : n,
                      'fields',
                    )
                  }
                >
                  <Plus />
                  Add field
                </Button>
              </div>
            </Field>
          </>
        )}

        {node.type === 'sharedStore' && (
          <>
            <Field label="Name" htmlFor="node-name" error={err('name')}>
              <Input
                id="node-name"
                value={node.name}
                onChange={(e) => set((n) => ({ ...n, name: e.target.value }), 'name')}
              />
            </Field>
            <Field label="Format" htmlFor="node-format">
              <EnumSelect
                id="node-format"
                value={node.format}
                options={[
                  { value: 'markdown', label: 'Markdown' },
                  { value: 'json', label: 'JSON' },
                  { value: 'text', label: 'Text' },
                ]}
                onChange={(format) => set((n) => ({ ...n, format }) as WorkflowNode, 'format')}
              />
            </Field>
          </>
        )}

        {node.type === 'note' && (
          <Field label="Text" htmlFor="node-text" hint="Notes are comments; they never run.">
            <Textarea
              id="node-text"
              value={node.text}
              rows={8}
              onChange={(e) => set((n) => ({ ...n, text: e.target.value }), 'text')}
            />
          </Field>
        )}

        {node.type === 'decision' && <DecisionFields {...props} node={node} set={set} err={err} />}
      </div>
    </>
  );
}

type SetNode = (fn: (n: WorkflowNode) => WorkflowNode, key: string) => void;

function ToolStepFields({
  node,
  set,
  err,
}: {
  node: Extract<WorkflowNode, { type: 'toolStep' }>;
  set: SetNode;
  err: (field: string) => string | undefined;
}) {
  const tools = useEntities('tool');
  const preset = tools?.find((t) => t.id === node.tool.id);
  const args = preset ? TOOL_ARGS[preset.builtin] : [];
  return (
    <>
      <Field label="Tool preset" htmlFor="node-tool" error={err('tool')}>
        <EnumSelect
          id="node-tool"
          value={node.tool.id}
          options={(tools ?? []).map((t) => ({ value: t.id, label: t.name }))}
          onChange={(id) =>
            set(
              (n) =>
                n.type === 'toolStep'
                  ? { ...n, tool: { kind: 'tool', id, version: n.tool.version }, args: {} }
                  : n,
              'tool',
            )
          }
        />
        <p className="text-xs text-muted-foreground">
          Pinned to <span className="font-mono">{node.tool.version}</span>
        </p>
      </Field>
      {args.map((a) => (
        <Field key={a.key} label={a.label} htmlFor={`arg-${a.key}`}>
          <Input
            id={`arg-${a.key}`}
            value={node.args[a.key] ?? ''}
            placeholder={a.placeholder}
            className="font-mono text-sm"
            onChange={(e) =>
              set(
                (n) =>
                  n.type === 'toolStep'
                    ? { ...n, args: { ...n.args, [a.key]: e.target.value } }
                    : n,
                `arg:${a.key}`,
              )
            }
          />
        </Field>
      ))}
    </>
  );
}

function DecisionFields({
  node,
  doc,
  change,
  set,
  err,
}: InspectorProps & {
  node: Extract<WorkflowNode, { type: 'decision' }>;
  set: SetNode;
  err: (field: string) => string | undefined;
}) {
  const agents = useEntities('agent');
  const agentVersions = useVersions('agent');
  /** New references pin the agent's current version. */
  const pinOf = (id: string) => agentVersions[id]?.version ?? 'v1';
  const loops = analyzeLoops(doc.workflow);
  const ev = node.evaluator;
  const setEvaluator = (evaluator: Evaluator, key: string) =>
    set((n) => (n.type === 'decision' ? { ...n, evaluator } : n), key);
  const firstAgent = agents?.[0];

  return (
    <>
      <Field label="Evaluator" htmlFor="node-evaluator" hint="How the decision chooses its exit.">
        <EnumSelect
          id="node-evaluator"
          value={ev.type}
          options={[
            { value: 'deterministic', label: 'Deterministic (code)' },
            {
              value: 'agent',
              label: 'Agent',
              description: firstAgent ? undefined : '(no agents yet)',
            },
            { value: 'human', label: 'Human' },
          ]}
          onChange={(type) => {
            if (type === ev.type) return;
            if (type === 'deterministic')
              setEvaluator({ type, language: 'python', code: '' }, 'evaluator');
            else if (type === 'human')
              setEvaluator({ type, instructions: '', allowFeedback: true }, 'evaluator');
            else if (firstAgent)
              setEvaluator(
                {
                  type,
                  criteria: '',
                  agent: {
                    kind: 'agent',
                    agent: { kind: 'agent', id: firstAgent.id, version: pinOf(firstAgent.id) },
                  },
                },
                'evaluator',
              );
          }}
        />
      </Field>

      {ev.type === 'deterministic' && (
        <Field
          label="Code (Python)"
          htmlFor="node-code"
          hint="Runs in v2, never in this version. It receives the decision’s input; exit code 0 picks the first exit, non-zero the second. Optional JSON on stdout adds notes or picks an exit by label."
        >
          <Textarea
            id="node-code"
            value={ev.code}
            rows={6}
            className="font-mono text-xs"
            placeholder={'import sys\nsys.exit(0)'}
            onChange={(e) => setEvaluator({ ...ev, code: e.target.value }, 'code')}
          />
        </Field>
      )}
      {ev.type === 'agent' && ev.agent.kind === 'agent' && (
        <>
          <Field label="Evaluating agent" htmlFor="node-eval-agent">
            <EnumSelect
              id="node-eval-agent"
              value={ev.agent.agent.id}
              options={(agents ?? []).map((a) => ({ value: a.id, label: a.name }))}
              onChange={(id) =>
                setEvaluator(
                  {
                    ...ev,
                    agent: { kind: 'agent', agent: { kind: 'agent', id, version: pinOf(id) } },
                  },
                  'evalAgent',
                )
              }
            />
          </Field>
          <Field label="Criteria" htmlFor="node-criteria">
            <Textarea
              id="node-criteria"
              value={ev.criteria}
              rows={4}
              onChange={(e) => setEvaluator({ ...ev, criteria: e.target.value }, 'criteria')}
            />
          </Field>
        </>
      )}
      {ev.type === 'human' && (
        <>
          <Field label="Instructions for the reviewer" htmlFor="node-review">
            <Textarea
              id="node-review"
              value={ev.instructions}
              rows={4}
              onChange={(e) =>
                setEvaluator({ ...ev, instructions: e.target.value }, 'instructions')
              }
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={ev.allowFeedback}
              onCheckedChange={(allowFeedback) =>
                setEvaluator({ ...ev, allowFeedback }, 'feedback')
              }
            />
            The reviewer may attach feedback
          </label>
        </>
      )}

      <Field
        label="Exits"
        hint="Each exit is a handle on the node. Exits that loop back need a cap."
        error={err('exits')}
      >
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_6rem_2rem] gap-2 text-[11px] font-medium text-muted-foreground">
            <span>Label</span>
            <span>Max loops</span>
            <span />
          </div>
          {node.exits.map((x, i) => {
            const loopsBack = doc.workflow.edges.some(
              (e) =>
                e.source.node === node.id && e.source.port === x.id && loops.backEdges.has(e.id),
            );
            return (
              <div key={x.id} className="grid grid-cols-[1fr_6rem_2rem] items-center gap-2">
                <Input
                  value={x.label}
                  aria-label={`Exit ${i + 1} label`}
                  className="h-8 text-sm"
                  onChange={(e) =>
                    set(
                      (n) =>
                        n.type === 'decision'
                          ? {
                              ...n,
                              exits: n.exits.map((y) =>
                                y.id === x.id ? { ...y, label: e.target.value } : y,
                              ),
                            }
                          : n,
                      `exit:${x.id}:label`,
                    )
                  }
                />
                <OptionalNumber
                  value={x.maxIterations}
                  placeholder={loopsBack ? 'needed' : '—'}
                  className="h-8"
                  onChange={(maxIterations) =>
                    set(
                      (n) =>
                        n.type === 'decision'
                          ? {
                              ...n,
                              exits: n.exits.map((y) =>
                                y.id === x.id ? { ...y, maxIterations } : y,
                              ),
                            }
                          : n,
                      `exit:${x.id}:cap`,
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove exit ${i + 1}`}
                  onClick={() =>
                    change((d) => {
                      // Removing an exit also removes the edges leaving from it.
                      const next = updateNode(d, node.id, (n) =>
                        n.type === 'decision'
                          ? { ...n, exits: n.exits.filter((y) => y.id !== x.id) }
                          : n,
                      );
                      const edges = next.workflow.edges.filter(
                        (e) => !(e.source.node === node.id && e.source.port === x.id),
                      );
                      return { ...next, workflow: { ...next.workflow, edges } };
                    })
                  }
                >
                  <X />
                </Button>
                {loopsBack && (
                  <span className="col-span-3 -mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700">
                    <RotateCcw className="size-3" /> loops back
                  </span>
                )}
              </div>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              set(
                (n) =>
                  n.type === 'decision'
                    ? {
                        ...n,
                        exits: [
                          ...n.exits,
                          {
                            id: newLocalId(
                              'x',
                              n.exits.map((y) => y.id),
                            ),
                            label: `exit ${n.exits.length + 1}`,
                          },
                        ],
                      }
                    : n,
                'exits',
              )
            }
          >
            <Plus />
            Add exit
          </Button>
        </div>
      </Field>
    </>
  );
}

// ---- Edges ----

function EdgePanel(props: InspectorProps & { edge: WorkflowEdge }) {
  const { edge, doc, change, settings, errors } = props;
  const agentNames = Object.fromEntries((useEntities('agent') ?? []).map((a) => [a.id, a.name]));
  const index = doc.workflow.edges.indexOf(edge);
  const err = (field: string) => errorAt(errors, `workflow.edges.${index}.${field}`);
  const set = (fn: (e: WorkflowEdge) => WorkflowEdge, key: string) =>
    change((d) => updateEdge(d, edge.id, fn), `edge:${edge.id}:${key}`);
  const from = doc.workflow.nodes.find((n) => n.id === edge.source.node);
  const to = doc.workflow.nodes.find((n) => n.id === edge.target.node);
  const exit =
    from?.type === 'decision' ? from.exits.find((x) => x.id === edge.source.port) : undefined;
  const loops = analyzeLoops(doc.workflow);
  const inferred = inferPayload(doc.workflow, edge.source);
  const ctx = edge.context;
  const touchesStore = from?.type === 'sharedStore' || to?.type === 'sharedStore';

  return (
    <>
      <PanelHeader
        title={`${from ? nodeTitle(from, agentNames) : '?'}${exit ? ` (${exit.label})` : ''} → ${to ? nodeTitle(to, agentNames) : '?'}`}
        subtitle={loops.backEdges.has(edge.id) ? 'Edge · loops back' : 'Edge'}
        onDelete={props.onDeleteSelection}
      />
      <div className="flex-1 space-y-4 overflow-y-auto p-4" key={edge.id}>
        <Field
          label="Payload"
          htmlFor="edge-payload"
          hint={`What flows along the edge. Inferred from the source: ${inferred}.`}
        >
          <EnumSelect
            id="edge-payload"
            value={edge.payload}
            options={PAYLOADS}
            onChange={(payload) => set((e) => ({ ...e, payload }), 'payload')}
          />
        </Field>

        <Field
          label="Context mode"
          htmlFor="edge-context"
          hint="How much of the upstream output the receiver sees."
        >
          <EnumSelect
            id="edge-context"
            value={ctx.mode}
            options={CONTEXT_MODES}
            onChange={(mode) =>
              set((e) => ({ ...e, context: defaultContext(mode, settings) }), 'context')
            }
          />
        </Field>

        {ctx.mode === 'reference' && (
          <p className="text-xs text-muted-foreground">
            The receiving agent gets a workspace path and reads it on demand, so it needs a read
            tool covering that path.
          </p>
        )}
        {ctx.mode === 'excerpt' && (
          <div className="space-y-3 rounded-lg border p-3">
            <Field label="Selector" htmlFor="edge-selector">
              <EnumSelect
                id="edge-selector"
                value={ctx.selector.kind}
                options={[
                  { value: 'heading', label: 'Markdown heading' },
                  { value: 'jsonPath', label: 'JSON path' },
                  { value: 'lines', label: 'Line range' },
                ]}
                onChange={(kind) =>
                  set(
                    (e) => ({
                      ...e,
                      context: {
                        mode: 'excerpt',
                        selector:
                          kind === 'heading'
                            ? { kind, heading: '' }
                            : kind === 'jsonPath'
                              ? { kind, path: '' }
                              : { kind, start: 1, end: 10 },
                      },
                    }),
                    'selector',
                  )
                }
              />
            </Field>
            {ctx.selector.kind === 'heading' && (
              <Field label="Heading" htmlFor="edge-heading" error={err('context')}>
                <Input
                  id="edge-heading"
                  value={ctx.selector.heading}
                  placeholder="## Tasks"
                  className="font-mono text-sm"
                  onChange={(ev) =>
                    set(
                      (e) => ({
                        ...e,
                        context: {
                          mode: 'excerpt',
                          selector: { kind: 'heading', heading: ev.target.value },
                        },
                      }),
                      'heading',
                    )
                  }
                />
              </Field>
            )}
            {ctx.selector.kind === 'jsonPath' && (
              <Field label="JSON path" htmlFor="edge-jsonpath" error={err('context')}>
                <Input
                  id="edge-jsonpath"
                  value={ctx.selector.path}
                  placeholder="$.tasks"
                  className="font-mono text-sm"
                  onChange={(ev) =>
                    set(
                      (e) => ({
                        ...e,
                        context: {
                          mode: 'excerpt',
                          selector: { kind: 'jsonPath', path: ev.target.value },
                        },
                      }),
                      'jsonpath',
                    )
                  }
                />
              </Field>
            )}
            {ctx.selector.kind === 'lines' && (
              <div className="grid grid-cols-2 gap-2">
                {(['start', 'end'] as const).map((k) => (
                  <Field
                    key={k}
                    label={k === 'start' ? 'From line' : 'To line'}
                    htmlFor={`edge-${k}`}
                    error={err('context')}
                  >
                    <OptionalNumber
                      id={`edge-${k}`}
                      value={ctx.selector.kind === 'lines' ? ctx.selector[k] : undefined}
                      onChange={(v) =>
                        set(
                          (e) =>
                            e.context.mode === 'excerpt' && e.context.selector.kind === 'lines'
                              ? {
                                  ...e,
                                  context: {
                                    ...e.context,
                                    selector: { ...e.context.selector, [k]: v ?? Number.NaN },
                                  },
                                }
                              : e,
                          `lines:${k}`,
                        )
                      }
                    />
                  </Field>
                ))}
              </div>
            )}
          </div>
        )}
        {ctx.mode === 'diff' && (
          <Field label="Diff against" htmlFor="edge-diffbase">
            <EnumSelect
              id="edge-diffbase"
              value={ctx.base}
              options={[
                { value: 'workspace-head', label: 'Workspace HEAD' },
                { value: 'previous-iteration', label: 'Previous loop iteration' },
              ]}
              onChange={(base) =>
                set((e) => ({ ...e, context: { mode: 'diff', base } }), 'diffbase')
              }
            />
          </Field>
        )}
        {ctx.mode === 'summary' && (
          <div className="space-y-3 rounded-lg border p-3">
            <Field label="Summarizer model" htmlFor="edge-summary-model">
              <ModelSelect
                id="edge-summary-model"
                value={ctx.model}
                models={settings?.models ?? []}
                onChange={(model) =>
                  set(
                    (e) =>
                      e.context.mode === 'summary' ? { ...e, context: { ...e.context, model } } : e,
                    'summaryModel',
                  )
                }
              />
            </Field>
            <Field
              label="Instruction"
              htmlFor="edge-summary-instruction"
              hint="Optional. Configured now; the summary is produced when runs arrive in v2."
            >
              <Textarea
                id="edge-summary-instruction"
                value={ctx.instruction}
                rows={3}
                placeholder="Keep only the failing tests and their errors."
                onChange={(ev) =>
                  set(
                    (e) =>
                      e.context.mode === 'summary'
                        ? { ...e, context: { ...e.context, instruction: ev.target.value } }
                        : e,
                    'summaryInstruction',
                  )
                }
              />
            </Field>
          </div>
        )}
        {ctx.mode === 'outcome-only' && (
          <p className="text-xs text-muted-foreground">
            The receiver only learns which decision exit was taken, plus the evaluator’s notes.
          </p>
        )}

        {exit && (
          <Field
            label="Max loops"
            htmlFor="edge-cap"
            hint={`Set on the decision’s “${exit.label}” exit.${loops.backEdges.has(edge.id) ? ' This edge loops back, so it needs a cap.' : ''}`}
          >
            <OptionalNumber
              id="edge-cap"
              value={exit.maxIterations}
              placeholder="no cap"
              onChange={(maxIterations) =>
                change(
                  (d) =>
                    updateNode(d, edge.source.node, (n) =>
                      n.type === 'decision'
                        ? {
                            ...n,
                            exits: n.exits.map((x) =>
                              x.id === exit.id ? { ...x, maxIterations } : x,
                            ),
                          }
                        : n,
                    ),
                  `exit:${exit.id}:cap`,
                )
              }
            />
          </Field>
        )}

        {loops.inCycle.has(edge.id) && (
          <Field
            label="History"
            hint="On a loop: does a retrying agent see only the latest round, or all of them?"
          >
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={edge.history ?? 'latest'}
              onValueChange={(v) =>
                v && set((e) => ({ ...e, history: v as 'latest' | 'all' }), 'history')
              }
              aria-label="History"
            >
              <ToggleGroupItem value="latest" className="px-3 text-xs">
                Latest only
              </ToggleGroupItem>
              <ToggleGroupItem value="all" className="px-3 text-xs">
                All attempts
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
        )}

        {touchesStore && (
          <Field label="Access" hint="Whether the agent reads from or writes to the shared store.">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={edge.access ?? (to?.type === 'sharedStore' ? 'write' : 'read')}
              onValueChange={(v) =>
                v && set((e) => ({ ...e, access: v as 'read' | 'write' }), 'access')
              }
              aria-label="Access"
            >
              <ToggleGroupItem value="read" className="px-3 text-xs">
                Read
              </ToggleGroupItem>
              <ToggleGroupItem value="write" className="px-3 text-xs">
                Write
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
        )}
      </div>
    </>
  );
}
