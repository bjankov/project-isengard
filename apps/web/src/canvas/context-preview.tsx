import {
  describeScope,
  isBranchVersion,
  joinInputs,
  joinLabel,
  type AgentOverride,
  type ContextModeName,
  type LoopAnalysis,
  type SkillRef,
  type ToolRef,
} from '@app/schema';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  FileText,
  Flag,
  GitCompare,
  GitFork,
  Inbox,
  Link2,
  MessageSquareText,
  RotateCcw,
  Scissors,
  ShieldAlert,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { modelLabel } from '@/components/agent-defaults';
import { BuiltinIcon } from '@/components/tools';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { usePinned } from '@/stores/pinned';
import { useSettings } from '@/stores/settings';
import { describeIncoming, incomingEdges, type IncomingDescription } from './describe-context';
import type { ProjectDoc } from './doc';
import { ProblemIcon } from './problems-panel';
import type { WorkflowCheck } from './use-workflow-check';

const MODE_META: Record<IncomingDescription['mode'], { icon: typeof FileText; label: string }> = {
  full: { icon: FileText, label: 'Full' },
  reference: { icon: Link2, label: 'Reference' },
  excerpt: { icon: Scissors, label: 'Excerpt' },
  diff: { icon: GitCompare, label: 'Diff' },
  summary: { icon: Sparkles, label: 'Summary' },
  'outcome-only': { icon: Flag, label: 'Outcome only' },
  sequencing: { icon: ArrowRight, label: 'Start after' },
} satisfies Record<ContextModeName | 'sequencing', unknown>;

/**
 * Exactly what an agent node receives when it runs (PLAN.md 9.4): its prompt, its skills, its
 * tools with their scopes, and each incoming edge rendered by its context mode. No token
 * estimates.
 */
export function ContextPreview({
  nodeId,
  onOpenChange,
  doc,
  loops,
  check,
}: {
  nodeId: string | null;
  onOpenChange: (open: boolean) => void;
  doc: ProjectDoc;
  loops: LoopAnalysis;
  check: WorkflowCheck;
}) {
  return (
    <Sheet open={nodeId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl" data-testid="context-preview">
        {nodeId && <PreviewBody nodeId={nodeId} doc={doc} loops={loops} check={check} />}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  index,
  icon: Icon,
  title,
  count,
  description,
  children,
}: {
  index: number;
  icon: typeof FileText;
  title: string;
  count?: number;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="relative pl-10" aria-label={title}>
      <span className="absolute top-0 left-0 flex size-7 items-center justify-center rounded-full border bg-background text-xs font-semibold text-muted-foreground">
        {index}
      </span>
      <header className="mb-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" />
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
              {count}
            </span>
          )}
        </h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function PreviewBody({
  nodeId,
  doc,
  loops,
  check,
}: {
  nodeId: string;
  doc: ProjectDoc;
  loops: LoopAnalysis;
  check: WorkflowCheck;
}) {
  const settings = useSettings();
  const node = doc.workflow.nodes.find((n) => n.id === nodeId);
  const ref =
    node?.type === 'agent' && node.binding.kind === 'agent' ? node.binding.agent : undefined;
  const pinned = usePinned('agent', ref?.id, ref?.version);
  if (!node || !ref) return null;
  const agent = pinned.state === 'ready' ? pinned.entity : undefined;
  const models = settings?.models ?? [];
  const override: AgentOverride = doc.overrides[nodeId] ?? {};
  const graph = doc.workflow;

  const incoming = incomingEdges(graph, nodeId, loops).map((e) =>
    describeIncoming(graph, e, {
      loops,
      resolver: check.resolver,
      modelName: (m) => modelLabel(m, models),
    }),
  );
  const joinCount = joinInputs(graph, nodeId, loops).length;
  const name = node.label || agent?.name || ref.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b">
        <SheetTitle>Context preview: {name}</SheetTitle>
        <SheetDescription>
          Exactly what this agent receives when it runs, and nothing else: its prompt, its skills,
          its tools, and each input as its edge’s context mode delivers it.
        </SheetDescription>
        {agent && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
            {isBranchVersion(ref.version) ? (
              <Badge className="bg-violet-100 text-violet-800">
                <GitFork className="size-3" /> project fork
              </Badge>
            ) : (
              <Badge className="font-mono">
                {agent.name} {ref.version}
              </Badge>
            )}
            <Badge overridden={!!override.model}>
              {modelLabel(override.model ?? agent.defaults.model, models)}
            </Badge>
            <Badge overridden={!!override.effort}>
              {override.effort ?? agent.defaults.effort} effort
            </Badge>
            <Badge overridden={override.limits?.maxIterations !== undefined}>
              {override.limits?.maxIterations ?? agent.defaults.limits.maxIterations} iterations
            </Badge>
            <Badge overridden={override.limits?.maxTokens !== undefined}>
              {(override.limits?.maxTokens ?? agent.defaults.limits.maxTokens).toLocaleString()}{' '}
              tokens max
            </Badge>
            <Badge overridden={override.limits?.maxWallTimeSeconds !== undefined}>
              {override.limits?.maxWallTimeSeconds ?? agent.defaults.limits.maxWallTimeSeconds}s max
            </Badge>
            {Object.keys(override).length > 0 && (
              <span className="text-muted-foreground">
                <span className="mr-1 inline-block size-2 rounded-full bg-sky-500" />
                project override
              </span>
            )}
          </div>
        )}
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5">
        {pinned.state === 'missing' && (
          <Empty>
            Agent {ref.id} ({ref.version}) no longer exists, so there is nothing to preview.
          </Empty>
        )}
        {pinned.state === 'loading' && <div className="h-32 animate-pulse rounded-md bg-muted" />}
        {agent && (
          <>
            <Section
              index={1}
              icon={MessageSquareText}
              title="Prompt"
              description="The agent’s instructions, as written in its definition."
            >
              {agent.prompt.trim() ? (
                <pre
                  className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
                  data-testid="preview-prompt"
                >
                  {agent.prompt}
                </pre>
              ) : (
                <Empty>No prompt yet.</Empty>
              )}
            </Section>

            <Section
              index={2}
              icon={BookOpen}
              title="Skills"
              count={agent.skills.length}
              description="Each skill’s name, description and instructions."
            >
              {agent.skills.length === 0 ? (
                <Empty>No skills.</Empty>
              ) : (
                <ul className="space-y-2">
                  {agent.skills.map((s) => (
                    <SkillItem key={s.id} skillRef={s} />
                  ))}
                </ul>
              )}
            </Section>

            <Section
              index={3}
              icon={Wrench}
              title="Tools"
              count={agent.tools.length}
              description="Each tool preset with the scope it is limited to."
            >
              {agent.tools.length === 0 ? (
                <Empty>No tools: the agent can only answer in text.</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {agent.tools.map((t) => (
                    <ToolItem key={t.id} toolRef={t} />
                  ))}
                </ul>
              )}
            </Section>

            <Section
              index={4}
              icon={Inbox}
              title="Inputs"
              count={incoming.length}
              description={
                joinCount > 1
                  ? node.join
                    ? `Starts when ${joinLabel(node.join, joinCount)} of its ${joinCount} inputs arrived.`
                    : `${joinCount} inputs, but no join mode yet.`
                  : 'What arrives along each incoming edge.'
              }
            >
              {incoming.length === 0 ? (
                <Empty>Nothing is connected to this agent yet.</Empty>
              ) : (
                <ul className="space-y-2">
                  {incoming.map((d) => (
                    <IncomingItem
                      key={d.edge.id}
                      d={d}
                      problems={check.problems.filter((p) => p.edges.includes(d.edge.id))}
                    />
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Badge({
  children,
  className,
  overridden,
}: {
  children: React.ReactNode;
  className?: string;
  overridden?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 font-medium',
        overridden && 'border-sky-300 bg-sky-50 text-sky-900',
        className,
      )}
    >
      {children}
    </span>
  );
}

function SkillItem({ skillRef }: { skillRef: SkillRef }) {
  const pinned = usePinned('skill', skillRef.id, skillRef.version);
  if (pinned.state !== 'ready') {
    return (
      <li className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
        {pinned.state === 'missing'
          ? `Skill ${skillRef.id} (${skillRef.version}) no longer exists.`
          : 'Loading…'}
      </li>
    );
  }
  const skill = pinned.entity;
  return (
    <li className="rounded-md border">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2">
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {skill.name}
              <span className="font-mono text-[11px] text-muted-foreground">
                {skillRef.version}
              </span>
            </span>
            <span className="block text-xs text-muted-foreground">{skill.description}</span>
          </span>
        </summary>
        <pre className="max-h-64 overflow-auto border-t bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {skill.body.trim() || '(empty)'}
        </pre>
      </details>
    </li>
  );
}

function ToolItem({ toolRef }: { toolRef: ToolRef }) {
  const pinned = usePinned('tool', toolRef.id, toolRef.version);
  if (pinned.state !== 'ready') {
    return (
      <li className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
        {pinned.state === 'missing'
          ? `Tool preset ${toolRef.id} (${toolRef.version}) no longer exists.`
          : 'Loading…'}
      </li>
    );
  }
  const tool = pinned.entity;
  const scope = describeScope(tool);
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2',
        scope.unrestricted && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <BuiltinIcon id={tool.builtin} className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-sm font-medium">{tool.name}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {scope.summary}
      </span>
      {scope.unrestricted && (
        <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-px text-[11px] font-medium text-destructive">
          <ShieldAlert className="size-3" />
          unrestricted shell
        </span>
      )}
    </li>
  );
}

function IncomingItem({
  d,
  problems,
}: {
  d: IncomingDescription;
  problems: WorkflowCheck['problems'];
}) {
  const meta = MODE_META[d.mode];
  const Icon = meta.icon;
  return (
    <li
      className="rounded-md border px-3 py-2"
      data-testid="preview-input"
      data-mode={d.mode}
      data-edge={d.edge.id}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted/40',
            d.mode === 'sequencing' && 'border-dashed',
          )}
          title={meta.label}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
            <span className="font-medium">{d.source}</span>
            {d.via && <span className="text-xs text-muted-foreground">via {d.via}</span>}
          </div>
          <p className="text-sm text-muted-foreground" data-testid="preview-input-what">
            {d.what}
          </p>
          {(d.notes.length > 0 || d.inLoop) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {d.inLoop && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-800">
                  <RotateCcw className="size-3" />
                  on every loop round
                </span>
              )}
              {d.notes.map((n) => (
                <span
                  key={n}
                  className="rounded bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground"
                >
                  {n}
                </span>
              ))}
            </div>
          )}
          {problems.map((p) => (
            <p key={p.id} className="mt-1.5 flex items-start gap-1.5 text-xs">
              <ProblemIcon severity={p.severity} className="size-3.5" />
              {p.message}
            </p>
          ))}
        </div>
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground uppercase">
          {meta.label}
        </span>
      </div>
    </li>
  );
}
