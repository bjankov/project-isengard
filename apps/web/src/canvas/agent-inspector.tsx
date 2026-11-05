import {
  KIND_PLURALS,
  forkBranchName,
  isBranchVersion,
  modelKey,
  type Agent,
  type AgentOverride,
  type Effort,
  type Limits,
  type Settings,
  type WorkflowNode,
} from '@app/schema';
import { GitFork, Loader2, ScanEye, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { modelLabel } from '@/components/agent-defaults';
import { Field } from '@/components/field';
import { BuiltinIcon } from '@/components/tools';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ApiError, api } from '@/lib/api';
import { compact, omit } from '@/lib/same';
import { PromoteFork } from '@/components/promote-fork';
import { usePinned } from '@/stores/pinned';
import { useEntities, useVersions } from '@/stores/library';
import { UpdateAvailable } from '@/components/update-available';
import { updateNode, type CanvasKind, type Change, type WorkflowDoc } from './doc';
import { OptionalNumber } from './fields';
import { Kbd } from './kbd';

const INHERIT = '__inherit__';

/** Set (or clear, with undefined) one override field; empty overrides are removed. */
function withOverride(
  overrides: Record<string, AgentOverride>,
  nodeId: string,
  patch: Partial<AgentOverride>,
): Record<string, AgentOverride> {
  const next = compact({ ...overrides[nodeId], ...patch });
  if (next.limits) {
    const limits = compact(next.limits);
    next.limits = Object.keys(limits).length > 0 ? limits : undefined;
  }
  const cleaned = compact(next);
  return Object.keys(cleaned).length === 0
    ? omit(overrides, nodeId)
    : { ...overrides, [nodeId]: cleaned };
}

const LIMITS: { key: keyof Limits; label: string }[] = [
  { key: 'maxIterations', label: 'Max iterations' },
  { key: 'maxTokens', label: 'Max tokens' },
  { key: 'maxWallTimeSeconds', label: 'Max wall time (s)' },
];

export function AgentInspector({
  kind = 'project',
  projectId,
  nodeId,
  doc,
  change,
  changeAndSave,
  dirty,
  settings,
  onPreview,
}: {
  /** Templates have no overrides and no context preview (those are per project). */
  kind?: CanvasKind;
  /** The id of the workflow (project or template) the node is in. */
  projectId: string;
  nodeId: string;
  doc: WorkflowDoc;
  change: Change;
  changeAndSave: Change;
  dirty: boolean;
  settings: Settings | undefined;
  onPreview: () => void;
}) {
  const node = doc.workflow.nodes.find((n) => n.id === nodeId);
  const ref =
    node?.type === 'agent' && node.binding.kind === 'agent' ? node.binding.agent : undefined;
  const agents = useEntities('agent');
  const skills = useEntities('skill');
  const tools = useEntities('tool');
  const versions = useVersions('agent');
  const pinned = usePinned('agent', ref?.id, ref?.version);
  const [confirmFork, setConfirmFork] = useState(false);
  const [forking, setForking] = useState(false);
  if (!ref) return null;

  const agent = pinned.state === 'ready' ? pinned.entity : undefined;
  const models = settings?.models ?? [];
  const forked = isBranchVersion(ref.version);
  const latest = versions[ref.id]?.version ?? undefined;

  const pin = (version: string, id = ref.id, apply: Change = change) =>
    apply((d) =>
      updateNode(d, nodeId, (n) =>
        n.type === 'agent'
          ? { ...n, binding: { kind: 'agent', agent: { kind: 'agent', id, version } } }
          : n,
      ),
    );
  const fork = async () => {
    setForking(true);
    const branch = forkBranchName(projectId, nodeId);
    try {
      await api.createBranch('agent', ref.id, branch, ref.version);
    } catch (err) {
      // Re-forking a node whose fork branch still exists: pin it again.
      if (!(err instanceof ApiError && /already exists/.test(err.message))) {
        toast.error('Could not fork the agent', {
          description: err instanceof Error ? err.message : String(err),
        });
        setForking(false);
        return;
      }
    }
    pin(branch);
    setForking(false);
    setConfirmFork(false);
    toast.success('Forked for this project', {
      description: 'Save the project, then use “Edit fork” to change the prompt, skills or tools.',
    });
  };

  return (
    <div className="space-y-6">
      {kind === 'project' && (
        <Button variant="secondary" className="w-full justify-start" onClick={onPreview}>
          <ScanEye />
          Context preview
          <Kbd className="ml-auto">P</Kbd>
        </Button>
      )}
      <Field label="Agent" htmlFor="node-agent">
        <Select
          value={ref.id}
          onValueChange={(id) => {
            const v = versions[id]?.version ?? 'v1';
            change((d) =>
              updateNode(d, nodeId, (n) =>
                n.type === 'agent'
                  ? { ...n, binding: { kind: 'agent', agent: { kind: 'agent', id, version: v } } }
                  : n,
              ),
            );
          }}
        >
          <SelectTrigger id="node-agent" className="w-full">
            <SelectValue placeholder={ref.id} />
          </SelectTrigger>
          <SelectContent>
            {(agents ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {forked ? (
            <span className="inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-px font-medium text-violet-800">
              <GitFork className="size-3" />
              Modified: pinned to this project’s fork
            </span>
          ) : (
            <>
              Pinned to <span className="font-mono text-foreground">{ref.version}</span>
              {pinned.state === 'ready' && pinned.local && (
                <span>· deleted from the library, kept as a local copy</span>
              )}
              <UpdateAvailable
                kind="agent"
                id={ref.id}
                version={ref.version}
                name={agent?.name ?? ref.id}
                onUpdate={(to) => pin(to)}
              />
            </>
          )}
        </p>
      </Field>

      {kind === 'project' && (
        <OverridesSection nodeId={nodeId} agent={agent} doc={doc} change={change} models={models} />
      )}

      {/* Definition: changing it forks */}
      <section
        className="space-y-3 rounded-lg border border-dashed p-3"
        aria-label="Agent definition"
      >
        <div>
          <h3 className="text-sm font-semibold">Agent definition</h3>
          <p className="text-xs text-muted-foreground">
            Prompt, skills and tools come from the agent. Changing them for this project forks it.
          </p>
        </div>
        {pinned.state === 'loading' && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
        {pinned.state === 'missing' && (
          <p className="text-xs text-destructive">
            {pinned.deleted
              ? `“${pinned.deleted}” was deleted from the library. Choose another agent above.`
              : 'This agent version no longer exists.'}
          </p>
        )}
        {agent && (
          <>
            <pre className="max-h-32 overflow-hidden rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap text-muted-foreground">
              {agent.prompt.trim() || 'No prompt.'}
            </pre>
            <ul className="space-y-1 text-xs">
              {agent.skills.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  {skills?.find((x) => x.id === s.id)?.name ?? s.id}
                  <span className="font-mono text-muted-foreground">{s.version}</span>
                </li>
              ))}
              {agent.tools.map((t) => {
                const preset = tools?.find((x) => x.id === t.id);
                return (
                  <li key={t.id} className="flex items-center gap-1.5">
                    {preset && (
                      <BuiltinIcon id={preset.builtin} className="size-3.5 text-muted-foreground" />
                    )}
                    {preset?.name ?? t.id}
                    <span className="font-mono text-muted-foreground">{t.version}</span>
                  </li>
                );
              })}
              {agent.skills.length + agent.tools.length === 0 && (
                <li className="text-muted-foreground">No skills or tools.</li>
              )}
            </ul>
          </>
        )}
        {forked ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link
                to={`/agents/${ref.id}?branch=${encodeURIComponent(ref.version)}&back=${encodeURIComponent(`/${KIND_PLURALS[kind]}/${projectId}`)}`}
              >
                <GitFork />
                Edit fork
              </Link>
            </Button>
            {latest && (
              <Button size="sm" variant="ghost" onClick={() => pin(latest)}>
                Use library version ({latest})
              </Button>
            )}
          </div>
        ) : null}
        {forked ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              Promote the fork: make it the library agent’s next version, or a new agent.
            </p>
            <PromoteFork
              kind="agent"
              id={ref.id}
              branch={ref.version}
              name={agents?.find((a) => a.id === ref.id)?.name ?? agent?.name ?? ref.id}
              disabledReason={dirty ? `Save the ${kind} first: promoting saves it.` : undefined}
              container={{ kind, id: projectId }}
              onPromoted={(to) => pin(to.version, to.id, changeAndSave)}
            />
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmFork(true)}
            disabled={!agent}
          >
            <GitFork />
            Customize for this {kind}
          </Button>
        )}
      </section>

      <AlertDialog open={confirmFork} onOpenChange={setConfirmFork}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fork “{agent?.name}” for this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This node gets its own branch of the agent, starting from {ref.version}. You can then
              change its prompt, skills and tools without affecting the library agent or other
              projects. The node is marked as modified. Overrides are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={forking}
              onClick={(e) => {
                e.preventDefault();
                void fork();
              }}
            >
              Fork agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Model, effort and limits for one agent node in this project, keyed by its node id, or by
 * its path for an agent inside a pattern instance (`review-k2f8/maker`). Never forks.
 */
export function OverridesSection({
  nodeId,
  agent,
  doc,
  change,
  models,
}: {
  nodeId: string;
  agent: Agent | undefined;
  doc: WorkflowDoc;
  change: Change;
  models: Settings['models'];
}) {
  const override = doc.overrides[nodeId] ?? {};
  const setOverride = (patch: Partial<AgentOverride>, key: string) =>
    change((d) => ({ ...d, overrides: withOverride(d.overrides, nodeId, patch) }), key);
  return (
    <section className="space-y-4 rounded-lg border p-3" aria-label="Project overrides">
      <div>
        <h3 className="text-sm font-semibold">Project overrides</h3>
        <p className="text-xs text-muted-foreground">
          Model, effort and limits for this project only. Changing them never forks the agent.
        </p>
      </div>
      <Field label="Model" htmlFor="override-model">
        <Select
          value={override.model ? modelKey(override.model) : INHERIT}
          onValueChange={(key) => {
            const m = models.find((o) => modelKey(o) === key);
            setOverride(
              { model: m ? { provider: m.provider, model: m.model } : undefined },
              'override:model',
            );
          }}
        >
          <SelectTrigger id="override-model" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>
              Inherit{agent ? ` (${modelLabel(agent.defaults.model, models)})` : ''}
            </SelectItem>
            {models.map((m) => (
              <SelectItem key={modelKey(m)} value={modelKey(m)}>
                {m.label ?? m.model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Effort">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={override.effort ?? INHERIT}
          onValueChange={(v) =>
            v &&
            setOverride({ effort: v === INHERIT ? undefined : (v as Effort) }, 'override:effort')
          }
          aria-label="Effort override"
        >
          <ToggleGroupItem value={INHERIT} className="px-2 text-xs">
            Inherit{agent ? ` (${agent.defaults.effort})` : ''}
          </ToggleGroupItem>
          {(['low', 'medium', 'high'] as const).map((e) => (
            <ToggleGroupItem key={e} value={e} className="px-2 text-xs capitalize">
              {e}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <div className="grid grid-cols-3 gap-2">
        {LIMITS.map((l) => (
          <Field key={l.key} label={l.label} htmlFor={`override-${l.key}`}>
            <OptionalNumber
              id={`override-${l.key}`}
              value={override.limits?.[l.key]}
              placeholder={agent ? String(agent.defaults.limits[l.key]) : undefined}
              onChange={(v) =>
                setOverride({ limits: { ...override.limits, [l.key]: v } }, `override:${l.key}`)
              }
            />
          </Field>
        ))}
      </div>
      {Object.keys(override).length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => change((d) => ({ ...d, overrides: omit(d.overrides, nodeId) }))}
        >
          Reset to the agent’s defaults
        </Button>
      )}
    </section>
  );
}

/**
 * An agent inside a pattern instance (selected in an expanded frame): the bound agent is
 * read-only here (bindings are changed on the instance), but its model, effort and limits can
 * be overridden for this project, keyed by the node's path.
 */
export function InnerAgentInspector({
  path,
  node,
  doc,
  change,
  settings,
}: {
  path: string;
  node: WorkflowNode;
  doc: WorkflowDoc;
  change: Change;
  settings: Settings | undefined;
}) {
  const ref =
    node.type === 'agent' && node.binding.kind === 'agent' ? node.binding.agent : undefined;
  const pinned = usePinned('agent', ref?.id, ref?.version);
  const agent = pinned.state === 'ready' ? pinned.entity : undefined;
  if (!ref) return null;
  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Inside a pattern: which agent fills this slot is set on the pattern instance. Model, effort
        and limits can be overridden here for this project.
      </p>
      <p className="text-xs">
        <span className="font-medium">{agent?.name ?? ref.id}</span>{' '}
        <span className="font-mono text-muted-foreground">{ref.version}</span>
      </p>
      <OverridesSection
        nodeId={path}
        agent={agent}
        doc={doc}
        change={change}
        models={settings?.models ?? []}
      />
    </div>
  );
}
