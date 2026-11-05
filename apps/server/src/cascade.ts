/**
 * Cascade preview and propagation (PLAN.md 8.2).
 *
 * Starting from roots (entities that just got a new main version), every main entity that pins
 * an older main version of a root is affected; accepting moves those pins to the new version,
 * which gives the referrer a new version in turn, so its own referrers are affected too. Forks
 * (branches pinned by projects) are listed but excluded by default. Overrides live on the
 * project, keyed by node path, and are never touched, so they survive every update.
 */
import {
  DRAFT_BRANCH,
  defaultAccepted,
  enabledCases,
  entityKey,
  isBranchVersion,
  isOutdated,
  isReferrerKind,
  locationLabel,
  refKey,
  refLocations,
  repin,
  versionName,
  versionNumber,
  type AnyEntity,
  type CascadeApplyResponse,
  type CascadeCase,
  type CascadeEntity,
  type CascadePreview,
  type CascadeRoot,
  type EntityByKind,
  type EntityKind,
  type WorkflowProblem,
} from '@app/schema';
import {
  BadRequestError,
  type BranchStep,
  type LibraryStore,
  type MainStep,
} from './store/library-store.js';
import { WORKFLOW_KINDS, WorkflowError, workflowErrors, type Overlay } from './workflow-check.js';

interface Node {
  info: CascadeEntity;
  /** Content the cases apply to: main, or the fork branch. */
  entity: AnyEntity;
}

interface Computed {
  preview: CascadePreview;
  nodes: Map<string, Node>;
}

/** Kinds whose forks (named branches) can pin other entities. */
const FORK_KINDS: readonly EntityKind[] = ['agent', 'pattern'];

async function compute(store: LibraryStore, roots: CascadeRoot[]): Promise<Computed> {
  const versionMaps = new Map<EntityKind, Awaited<ReturnType<LibraryStore['versionMap']>>>();
  const versions = async (kind: EntityKind) => {
    let m = versionMaps.get(kind);
    if (!m) {
      m = await store.versionMap(kind);
      versionMaps.set(kind, m);
    }
    return m;
  };
  const current = async (kind: EntityKind, id: string) =>
    (await versions(kind)).get(id)?.version ?? null;
  const nameOf = (kind: EntityKind, id: string) => store.summary(kind, id)?.name ?? id;

  const nodes = new Map<string, Node>();
  const cases: CascadeCase[] = [];
  /** The version each updated entity gets (roots: their current version). */
  const newVersion = new Map<string, string>();
  const queue: string[] = [];

  const register = async (kind: EntityKind, id: string, entity: AnyEntity, root = false) => {
    const key = entityKey(kind, id);
    const existing = nodes.get(key);
    if (existing) return existing;
    const vs = (await versions(kind)).get(id);
    const version = vs?.version ?? null;
    // Roots get a version of their own too when they pin another root (after a deletion).
    const next = versionName((versionNumber(version ?? 'v0') ?? 0) + 1);
    const node: Node = {
      info: {
        key,
        kind,
        id,
        name: entity.name,
        version,
        next,
        hasDraft: vs?.hasDraft ?? false,
        ...(root ? { root: true } : {}),
        problems: [],
      },
      entity,
    };
    nodes.set(key, node);
    return node;
  };

  for (const r of roots) {
    const entity = await store.get(r.kind, r.id);
    const version = await current(r.kind, r.id);
    if (!version) throw new BadRequestError(`${r.kind} "${r.id}" has no version`);
    const node = await register(r.kind, r.id, entity, true);
    newVersion.set(node.info.key, version);
    queue.push(node.info.key);
  }

  const forks = await store.namedBranches(FORK_KINDS);
  const forkContent = new Map<string, AnyEntity>();
  const loadFork = async (f: (typeof forks)[number]) => {
    const key = entityKey(f.kind, f.id, f.branch);
    let e = forkContent.get(key);
    if (!e) {
      e = await store.get(f.kind, f.id, f.branch);
      forkContent.set(key, e);
    }
    return e;
  };

  const done = new Set<string>();
  for (let targetKey = queue.shift(); targetKey; targetKey = queue.shift()) {
    if (done.has(targetKey)) continue;
    done.add(targetKey);
    const target = nodes.get(targetKey);
    const to = newVersion.get(targetKey);
    if (!target || !to) continue;
    const { kind, id } = target.info;
    const targetName = nameOf(kind, id);
    const pins = (l: { ref: { kind: string; id: string } }) =>
      l.ref.kind === kind && l.ref.id === id;

    // Main entities pinning the target.
    const referrers = new Map<string, { kind: EntityKind; id: string }>();
    for (const r of store.references(kind, id).incoming) {
      if (r.kind === kind && r.id === id) continue;
      if (isReferrerKind(r.kind)) referrers.set(entityKey(r.kind, r.id), r);
    }
    for (const r of referrers.values()) {
      const key = entityKey(r.kind, r.id);
      const entity = nodes.get(key)?.entity ?? (await store.get(r.kind, r.id));
      const found: CascadeCase[] = [];
      for (const loc of refLocations(r.kind, entity).filter(pins)) {
        const from = loc.ref.version;
        let fork: CascadeCase['fork'];
        let dangling = false;
        if (isOutdated(from, to)) fork = undefined;
        else if (isBranchVersion(from) && from !== DRAFT_BRANCH) {
          fork = 'pins-fork';
          dangling = !(await store.hasBranch(kind, id, from));
        } else continue;
        found.push({
          id: `${key}:${loc.key}`,
          referrer: key,
          location: loc.key,
          role: loc.role,
          label: locationLabel(r.kind, entity, loc, targetName),
          target: targetKey,
          from,
          to,
          ...(fork ? { fork } : {}),
          ...(dangling ? { danglingFork: true } : {}),
        });
      }
      if (found.length === 0) continue;
      cases.push(...found);
      const node = await register(r.kind, r.id, entity);
      if (!newVersion.has(key) && node.info.next) newVersion.set(key, node.info.next);
      queue.push(key);
    }

    // Forks whose content pins an older version of the target.
    for (const f of forks) {
      if (f.kind === kind && f.id === id) continue;
      const entity = await loadFork(f);
      const key = entityKey(f.kind, f.id, f.branch);
      const found = refLocations(f.kind, entity)
        .filter((l) => pins(l) && isOutdated(l.ref.version, to))
        .map((loc): CascadeCase => ({
          id: `${key}:${loc.key}`,
          referrer: key,
          location: loc.key,
          role: loc.role,
          label: locationLabel(f.kind, entity, loc, targetName),
          target: targetKey,
          from: loc.ref.version,
          to,
          fork: 'in-fork',
        }));
      if (found.length === 0) continue;
      cases.push(...found);
      if (!nodes.has(key)) {
        nodes.set(key, {
          info: {
            key,
            kind: f.kind,
            id: f.id,
            name: nameOf(f.kind, f.id),
            branch: f.branch,
            version: await current(f.kind, f.id),
            hasDraft: false,
            problems: [],
          },
          entity,
        });
      }
    }
  }

  const preview: CascadePreview = {
    roots: roots.map((r) => entityKey(r.kind, r.id)),
    entities: [...nodes.values()].map((n) => n.info),
    cases,
  };
  return { preview, nodes };
}

/** The entities the enabled cases change, with their new content. */
function project(computed: Computed, enabled: ReadonlySet<string>): Map<string, AnyEntity> {
  const out = new Map<string, AnyEntity>();
  for (const c of computed.preview.cases) {
    if (!enabled.has(c.id)) continue;
    const node = computed.nodes.get(c.referrer);
    if (!node) continue;
    const before = out.get(c.referrer) ?? node.entity;
    out.set(c.referrer, repinAny(node.info.kind, before, c.location, c.to));
  }
  return out;
}

function repinAny(
  kind: EntityKind,
  entity: AnyEntity,
  location: string,
  version: string,
): AnyEntity {
  return repin(kind, entity as EntityByKind[typeof kind], location, version);
}

/**
 * New errors (by problem id) each changed workflow entity would get, with every change in
 * place. Forks aren't checked: like drafts, they don't need to be complete.
 */
async function newErrors(
  store: LibraryStore,
  computed: Computed,
  changed: Map<string, AnyEntity>,
): Promise<Map<string, WorkflowProblem[]>> {
  const overlay = new Map<string, unknown>();
  for (const [key, entity] of changed) {
    const info = computed.nodes.get(key)?.info;
    if (info?.next && !info.branch) overlay.set(refKey({ ...info, version: info.next }), entity);
  }
  const result = new Map<string, WorkflowProblem[]>();
  for (const [key, entity] of changed) {
    const node = computed.nodes.get(key);
    if (!node || node.info.branch || !WORKFLOW_KINDS.has(node.info.kind)) continue;
    const { kind, id } = node.info;
    const graph = (e: AnyEntity) => e as EntityByKind['project'] | EntityByKind['pattern'];
    const before = new Set(
      (await workflowErrors(store, kind, id, graph(node.entity))).map((p) => p.id),
    );
    const after = await workflowErrors(store, kind, id, graph(entity), overlay as Overlay);
    const added = after.filter((p) => !before.has(p.id));
    if (added.length > 0) result.set(key, added);
  }
  return result;
}

/** What `POST /api/cascade/preview` returns. */
export async function previewCascade(
  store: LibraryStore,
  roots: CascadeRoot[],
): Promise<CascadePreview> {
  const computed = await compute(store, roots);
  const enabled = enabledCases(computed.preview, defaultAccepted(computed.preview));
  const problems = await newErrors(store, computed, project(computed, enabled));
  for (const e of computed.preview.entities) e.problems = problems.get(e.key) ?? [];
  return computed.preview;
}

function uses(cases: CascadeCase[], computed: Computed): string {
  const targets = new Map<string, string>();
  for (const c of cases) {
    const t = computed.nodes.get(c.target)?.info;
    if (t) targets.set(c.target, `${t.kind} ${t.name} ${c.to}`);
  }
  const list = [...targets.values()];
  const shown = list.slice(0, 3).join(', ');
  return `Uses ${shown}${list.length > 3 ? ` and ${String(list.length - 3)} more` : ''}`;
}

/** What `POST /api/cascade/apply` does. All or nothing. */
export async function applyCascade(
  store: LibraryStore,
  roots: CascadeRoot[],
  accept: string[],
): Promise<CascadeApplyResponse> {
  const computed = await compute(store, roots);
  const known = new Set(computed.preview.cases.map((c) => c.id));
  const unknown = accept.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new BadRequestError(
      `Some updates no longer apply (${unknown.join(', ')}). Reopen the preview and try again.`,
    );
  }
  const accepted = new Set(accept);
  const enabled = enabledCases(computed.preview, accepted);
  const orphaned = accept.filter((id) => !enabled.has(id));
  if (orphaned.length > 0) {
    throw new BadRequestError(
      `Some updates depend on updates that were declined: ${orphaned.join(', ')}.`,
    );
  }
  const changed = project(computed, enabled);
  const problems = await newErrors(store, computed, changed);
  if (problems.size > 0) {
    const names = [...problems.keys()].map((k) => computed.nodes.get(k)?.info.name ?? k);
    throw new WorkflowError(
      `Can’t update ${names.join(', ')}: the update would add errors. Decline it, or fix the cause first.`,
      [...problems.values()].flat(),
    );
  }

  const mainSteps: MainStep[] = [];
  const branchSteps: BranchStep[] = [];
  const updated: CascadeApplyResponse['updated'] = [];
  for (const [key, entity] of changed) {
    const node = computed.nodes.get(key);
    if (!node) continue;
    const { kind, id, name, branch, next, hasDraft } = node.info;
    const mine = computed.preview.cases.filter((c) => c.referrer === key && enabled.has(c.id));
    const note = uses(mine, computed);
    if (branch) {
      branchSteps.push({
        kind,
        id,
        branch,
        entity,
        message: `Update ${kind} ${id} (${name}) on ${branch}\n\n${note}`,
      });
      updated.push({ kind, id, branch });
      continue;
    }
    if (!next) continue;
    mainSteps.push({
      kind,
      id,
      entity,
      version: next,
      message: `Update ${kind} ${id} (${name}) as ${next}\n\n${note}`,
    });
    updated.push({ kind, id, version: next });
    if (hasDraft) {
      // The draft gets the same pins where it still has them, and the new main version as a
      // second parent, so merging it later doesn't report a conflict.
      let draft = await store.get(kind, id, DRAFT_BRANCH);
      for (const c of mine) {
        const loc = refLocations(kind, draft).find((l) => l.key === c.location);
        const target = computed.nodes.get(c.target)?.info;
        if (
          loc &&
          target &&
          loc.ref.kind === target.kind &&
          loc.ref.id === target.id &&
          loc.ref.version === c.from
        ) {
          draft = repinAny(kind, draft, c.location, c.to);
        }
      }
      branchSteps.push({
        kind,
        id,
        branch: DRAFT_BRANCH,
        entity: draft,
        message: `Update ${kind} ${id} (${name}) draft to ${next}\n\n${note}`,
        mainStep: mainSteps.length - 1,
      });
    }
  }
  if (mainSteps.length === 0 && branchSteps.length === 0) return { updated: [], commit: null };
  const { commits } = await store.applyBatch(mainSteps, branchSteps);
  return { updated, commit: commits.at(-1) ?? null };
}
