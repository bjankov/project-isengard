import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * M3 "done when": demo workflow 1 from PLAN.md 9.6 can be built by hand, saved, reloaded, and
 * looks identical.
 *
 * Prompt → Planner → PLAN.md → Executor → code → Tester → Decision ("tests pass?",
 * deterministic) with a back-edge to the Executor (max 3, summary, latest only) → Output.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function createAgent(page: Page, name: string, description: string) {
  const { settings } = await (await page.request.get('/api/settings')).json();
  const res = await page.request.post('/api/agents', {
    data: {
      name,
      description,
      prompt: `You are the ${name}.`,
      skills: [],
      tools: [],
      defaults: settings.agentDefaults,
    },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).entity.id as string;
}

function node(page: Page, text: string | RegExp): Locator {
  return page.locator('.react-flow__node').filter({ hasText: text });
}

/** Quick-add after the selected node (Ctrl+K, search, Enter). */
async function quickAdd(page: Page, search: string) {
  await page.keyboard.press(`${mod}+k`);
  const dialog = page.getByRole('dialog', { name: 'Add a node' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill(search);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
}

/** Drag from a source handle onto a target handle. */
async function connect(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error('handle not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

/** Positions of every node as rendered, by node id. */
async function renderedLayout(page: Page) {
  return page
    .locator('.react-flow__node')
    .evaluateAll((els) =>
      Object.fromEntries(
        els.map((el) => [
          (el as HTMLElement).dataset.id,
          { transform: (el as HTMLElement).style.transform, text: el.textContent },
        ]),
      ),
    );
}

test('build demo workflow 1 by hand, save, reload: it looks identical', async ({ page }) => {
  await createAgent(page, 'Planner', 'Writes PLAN.md');
  await createAgent(page, 'Executor', 'Implements the plan');
  await createAgent(page, 'Test writer', 'Writes and runs the tests');
  const workspace = mkdtempSync(join(tmpdir(), 'app-e2e-workspace-'));

  // --- New project: the workspace is not a repo yet, so git init is offered
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Name', { exact: true }).fill('Demo: plan and execute');
  await dialog.getByLabel('Workspace', { exact: true }).fill(workspace);
  await expect(dialog.getByTestId('workspace-status')).toContainText('not a git repo');
  await expect(dialog.getByRole('button', { name: 'Create project' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Initialize git here' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Run git init' }).click();
  await expect(dialog.getByTestId('workspace-status')).toContainText('Git repo');
  await shot(page, '20-new-project');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/demo-plan-and-execute-[a-z0-9]{6}$/);
  const projectId = page.url().split('/').pop()!;
  await expect(node(page, 'Task')).toBeVisible();
  await expect(node(page, 'Result')).toBeVisible();

  // --- Build the chain with quick-add: each new node is added after the selected one
  await node(page, 'Task').click();
  await inspector(page).getByLabel('Task', { exact: true }).fill('Add a /health route');
  await quickAdd(page, 'Planner');
  await quickAdd(page, 'Artifact');
  await inspector(page).getByLabel('Path', { exact: true }).fill('PLAN.md');
  await quickAdd(page, 'Executor');
  await quickAdd(page, 'Artifact');
  await inspector(page).getByLabel('Path', { exact: true }).fill('src/**');
  await inspector(page).getByLabel('Label', { exact: true }).fill('code');
  await inspector(page).getByLabel('File type', { exact: true }).click();
  await page.getByRole('option', { name: 'Code' }).click();
  await quickAdd(page, 'Test writer');
  await quickAdd(page, 'Decision');
  await inspector(page).getByLabel('Question', { exact: true }).fill('tests pass?');
  await expect(node(page, 'tests pass?')).toBeVisible();

  // Executor: project overrides, not a fork
  await page.locator('.react-flow__controls-fitview').click();
  await node(page, 'Executor').click();
  await inspector(page).getByRole('radio', { name: 'High' }).click();
  await expect(node(page, 'Executor')).toContainText('overrides');

  // --- Decision exits: pass → Output, fail → back to Executor
  const decision = node(page, 'tests pass?');
  await connect(
    page,
    decision.locator('[data-exit="pass"] .react-flow__handle'),
    node(page, 'Result').locator('.react-flow__handle.target'),
  );
  await connect(
    page,
    decision.locator('[data-exit="fail"] .react-flow__handle'),
    node(page, 'Executor').locator('.react-flow__handle.target'),
  );
  const loopLabel = page.locator('[data-edge-label]').filter({ hasText: 'no cap' });
  await expect(loopLabel).toBeVisible();

  // The back-edge: max 3, summary, latest only
  await loopLabel.click();
  await expect(inspector(page)).toContainText('loops back');
  await inspector(page).getByLabel('Max loops', { exact: true }).fill('3');
  await inspector(page).getByLabel('Context mode', { exact: true }).click();
  await page.getByRole('option', { name: /Summary/ }).click();
  await inspector(page)
    .getByLabel('Instruction', { exact: true })
    .fill('Keep only the failing tests and their errors.');
  await expect(inspector(page).getByRole('radio', { name: 'Latest only' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('[data-edge-label]').filter({ hasText: 'max 3' })).toBeVisible();

  // A closer look at the loop (zoom around the decision).
  const d = (await decision.boundingBox())!;
  await page.mouse.move(d.x - 150, d.y + 40);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(300);
  await shot(page, '21a-loop-detail');
  await page.locator('.react-flow__controls-fitview').click();

  // Move the Output to the end of the chain (layout only).
  const out = await node(page, 'Result').boundingBox();
  const dec = await decision.boundingBox();
  await page.mouse.move(out!.x + 30, out!.y + 20);
  await page.mouse.down();
  await page.mouse.move(dec!.x + dec!.width + 160, dec!.y - 60, { steps: 10 });
  await page.mouse.up();

  // Deselect, then save.
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText('Saved “Demo: plan and execute” to the draft').first()).toBeVisible();
  await shot(page, '21-demo-workflow');

  // --- What was saved is demo workflow 1
  const saved = await (await page.request.get(`/api/projects/${projectId}?ref=draft`)).json();
  const types = saved.workflow.nodes.map((n: { type: string }) => n.type).sort();
  expect(types).toEqual(
    ['agent', 'agent', 'agent', 'artifact', 'artifact', 'decision', 'input', 'output'].sort(),
  );
  expect(saved.workflow.edges).toHaveLength(8);
  const back = saved.workflow.edges.find(
    (e: { source: { port?: string } }) => e.source.port === 'fail',
  );
  expect(back.context).toMatchObject({ mode: 'summary' });
  const decisionNode = saved.workflow.nodes.find((n: { type: string }) => n.type === 'decision');
  expect(decisionNode.label).toBe('tests pass?');
  expect(decisionNode.evaluator.type).toBe('deterministic');
  expect(decisionNode.exits).toEqual([
    { id: 'pass', label: 'pass' },
    { id: 'fail', label: 'fail', maxIterations: 3 },
  ]);
  expect(Object.values(saved.overrides)).toEqual([{ effort: 'high' }]);

  // --- Reload: identical (fit the view first, as opening the project does)
  await page.locator('.react-flow__controls-fitview').click();
  const hideToasts = '[data-sonner-toaster] { display: none !important; }';
  await page.addStyleTag({ content: hideToasts });
  await page.mouse.move(0, 0);
  const before = await renderedLayout(page);
  const beforeShot = await page.getByTestId('canvas').screenshot();

  await page.reload();
  await expect(node(page, 'tests pass?')).toBeVisible();
  await page.addStyleTag({ content: hideToasts });
  await page.mouse.move(0, 0);
  await expect.poll(() => renderedLayout(page)).toEqual(before);
  const afterShot = await page.getByTestId('canvas').screenshot();
  expect(afterShot.equals(beforeShot)).toBe(true);
  const reloaded = await (await page.request.get(`/api/projects/${projectId}?ref=draft`)).json();
  expect(reloaded).toEqual(saved);
  await shot(page, '22-demo-reloaded');
});

/** A project created through the API, on a fresh workspace repo. */
async function createProject(page: Page, name: string, agentId?: string) {
  const workspace = mkdtempSync(join(tmpdir(), 'app-e2e-workspace-'));
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  const nodes: unknown[] = [
    { id: 'input', type: 'input', name: 'Task', payloadType: 'text', content: '', files: [] },
    { id: 'output', type: 'output', name: 'Result', payloadType: 'text' },
  ];
  const positions: Record<string, { x: number; y: number }> = {
    input: { x: 0, y: 0 },
    output: { x: 640, y: 0 },
  };
  if (agentId) {
    nodes.push({
      id: 'worker',
      type: 'agent',
      binding: { kind: 'agent', agent: { kind: 'agent', id: agentId, version: 'v1' } },
    });
    positions.worker = { x: 320, y: 0 };
  }
  const res = await page.request.post('/api/projects', {
    data: {
      name,
      description: '',
      workspacePath: workspace,
      overrides: {},
      workflow: { nodes, edges: [] },
      layout: { nodes: positions, expanded: [] },
    },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).entity.id as string;
}

test('canvas editing: palette, notes, undo/redo, copy/paste, delete and refused connections', async ({
  page,
}) => {
  const id = await createProject(page, 'Editing playground');
  await page.goto(`/projects/${id}`);
  await expect(node(page, 'Task')).toBeVisible();
  const canvas = page.getByTestId('canvas');

  // Drag a note from the palette onto the canvas.
  const box = (await canvas.boundingBox())!;
  await page
    .getByRole('complementary', { name: 'Node palette' })
    .getByRole('button', { name: 'Note' })
    .dragTo(canvas, { targetPosition: { x: box.width / 2, y: box.height - 150 } });
  const note = page.locator('.react-flow__node-wf-note');
  await expect(note).toHaveCount(1);
  await inspector(page).getByLabel('Text', { exact: true }).fill('Remember the changelog');
  await expect(note).toContainText('Remember the changelog');

  // Undo: the typing is one step, adding the note another. Redo brings both back.
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press(`${mod}+z`);
  await expect(note).toContainText('Empty note');
  await page.keyboard.press(`${mod}+z`);
  await expect(note).toHaveCount(0);
  await page.keyboard.press(`${mod}+Shift+z`);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(note).toContainText('Remember the changelog');

  // Copy and paste, then delete the copy.
  await note.click();
  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press(`${mod}+v`);
  await expect(note).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(note).toHaveCount(1);

  // A refused connection explains why.
  await connect(page, node(page, 'Task').locator('.react-flow__handle.source'), note);
  await expect(page.getByText('Notes are comments and can’t be connected.')).toBeVisible();

  // A valid connection, then the same one again.
  const toResult = node(page, 'Result').locator('.react-flow__handle.target');
  await connect(page, node(page, 'Task').locator('.react-flow__handle.source'), toResult);
  await expect(page.locator('[data-edge-label]')).toHaveCount(1);
  await connect(page, node(page, 'Task').locator('.react-flow__handle.source'), toResult);
  await expect(page.getByText('These two are already connected.')).toBeVisible();
  await expect(page.locator('[data-edge-label]')).toHaveCount(1);
  await shot(page, '23-editing');

  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText('Saved “Editing playground” to the draft').first()).toBeVisible();
  const saved = await (await page.request.get(`/api/projects/${id}?ref=draft`)).json();
  expect(saved.workflow.nodes.map((n: { type: string }) => n.type).sort()).toEqual([
    'input',
    'note',
    'output',
  ]);
  expect(saved.workflow.edges).toHaveLength(1);
});

test('fork an agent for one project and edit the fork', async ({ page }) => {
  const agentId = await createAgent(page, 'Reviewer bot', 'Reviews diffs');
  const id = await createProject(page, 'Fork playground', agentId);
  await page.goto(`/projects/${id}`);

  await node(page, 'Reviewer bot').click();
  await expect(inspector(page)).toContainText('Pinned to v1');
  await inspector(page).getByRole('button', { name: 'Customize for this project' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Fork agent' }).click();
  await expect(node(page, 'Reviewer bot')).toContainText('modified');
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText('Saved “Fork playground” to the draft').first()).toBeVisible();
  const branch = `fork-${id}-worker`;
  const project = await (await page.request.get(`/api/projects/${id}?ref=draft`)).json();
  expect(
    project.workflow.nodes.find((n: { id: string }) => n.id === 'worker').binding.agent,
  ).toEqual({ kind: 'agent', id: agentId, version: branch });

  // Edit the fork in the agent editor.
  await inspector(page).getByRole('link', { name: 'Edit fork' }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}\\?branch=${branch}`));
  await expect(page.getByTestId('version-indicator')).toContainText('fork');
  await page.getByLabel('Description', { exact: true }).fill('Reviews diffs, strictly');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`Saved “Reviewer bot” to ${branch}`).first()).toBeVisible();
  await shot(page, '24-fork-editor');

  const onFork = await (await page.request.get(`/api/agents/${agentId}?ref=${branch}`)).json();
  expect(onFork.description).toBe('Reviews diffs, strictly');
  const onMain = await (await page.request.get(`/api/agents/${agentId}`)).json();
  expect(onMain.description).toBe('Reviews diffs');

  await page.getByRole('link', { name: '← Back to the project' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
  await expect(node(page, 'Reviewer bot')).toContainText('modified');
});

test('save a workflow as a template and start a new project from it', async ({ page }) => {
  const agentId = await createAgent(page, 'Template agent', 'For templates');
  const id = await createProject(page, 'Template source', agentId);
  await page.goto(`/projects/${id}`);
  await page.getByRole('button', { name: 'Save as template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as template' });
  await dialog.getByLabel('Name', { exact: true }).fill('Single agent');
  await dialog.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Saved template “Single agent”').first()).toBeVisible();

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  const templates = page.getByRole('region', { name: 'Workflow templates' });
  await templates
    .getByRole('listitem')
    .filter({ hasText: 'Single agent' })
    .getByRole('button', { name: 'Use' })
    .click();
  const create = page.getByRole('dialog', { name: 'New project' });
  await expect(create.getByRole('radio', { name: /Single agent/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const workspace = mkdtempSync(join(tmpdir(), 'app-e2e-workspace-'));
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  await create.getByLabel('Name', { exact: true }).fill('From template');
  await create.getByLabel('Workspace', { exact: true }).fill(workspace);
  await expect(create.getByTestId('workspace-status')).toContainText('Git repo');
  await create.getByRole('button', { name: 'Create project' }).click();
  await expect(node(page, 'Template agent')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
});

test('every node type can be added, configured and saved', async ({ page }) => {
  const preset = await page.request.post('/api/tools', {
    data: {
      name: 'Run unit tests',
      description: '',
      builtin: 'shell',
      scope: { commands: [{ match: 'exact', command: 'npm test' }] },
    },
  });
  expect(preset.ok()).toBe(true);
  const agentId = await createAgent(page, 'Store writer', 'Writes notes');
  const id = await createProject(page, 'All node types', agentId);
  await page.goto(`/projects/${id}`);

  // Tool step after the agent, with its command argument.
  await node(page, 'Store writer').click();
  await quickAdd(page, 'Run unit tests');
  await inspector(page).getByLabel('Command', { exact: true }).fill('npm test');
  await expect(node(page, 'Run unit tests')).toContainText('npm test');

  // Shared store after the agent: the edge writes to it.
  await node(page, 'Store writer').click();
  await quickAdd(page, 'Shared store');
  await inspector(page).getByLabel('Name', { exact: true }).fill('Findings');
  await page.locator('.react-flow__controls-fitview').click();
  const toStore = page.locator('[data-edge-label]').last();
  await toStore.click();
  await expect(inspector(page).getByRole('radio', { name: 'Write' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Human input with a requested field.
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
  await quickAdd(page, 'Human input');
  await inspector(page).getByLabel('Instructions', { exact: true }).fill('Confirm the scope');
  await inspector(page).getByRole('button', { name: 'Add field' }).click();
  await expect(node(page, 'Confirm the scope')).toContainText('1 field');

  // A decision with a human evaluator and a third exit.
  await quickAdd(page, 'Decision');
  await inspector(page).getByLabel('Evaluator', { exact: true }).click();
  await page.getByRole('option', { name: 'Human' }).click();
  await inspector(page)
    .getByLabel('Instructions for the reviewer', { exact: true })
    .fill('Ship it?');
  await inspector(page).getByRole('button', { name: 'Add exit' }).click();
  await expect(page.locator('.react-flow__node-wf-decision [data-exit]')).toHaveCount(3);
  await shot(page, '25-all-node-types');

  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText('Saved “All node types” to the draft').first()).toBeVisible();
  const saved = await (await page.request.get(`/api/projects/${id}?ref=draft`)).json();
  const byType = (t: string) => saved.workflow.nodes.find((n: { type: string }) => n.type === t);
  expect(byType('toolStep').args).toEqual({ command: 'npm test' });
  expect(byType('sharedStore').name).toBe('Findings');
  expect(byType('humanInput').fields).toHaveLength(1);
  expect(byType('decision').evaluator).toMatchObject({ type: 'human', instructions: 'Ship it?' });
  expect(
    saved.workflow.edges.find(
      (e: { target: { node: string } }) => e.target.node === byType('sharedStore').id,
    ).access,
  ).toBe('write');
});
