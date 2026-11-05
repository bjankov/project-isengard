import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * M5 "done when": Maker-Checker can be inserted, bound, expanded, collapsed, forked, edited and
 * promoted back to the library as a new version. Plus: a pattern built by hand in the Patterns
 * tab, with a repeat group, used in a project; and nested patterns expanding one level at a time.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const MC = 'maker-checker-builtn';

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const byId = (page: Page, id: string): Locator =>
  page.locator(`.react-flow__node[data-id="${id}"]`);
const instance = (page: Page) => page.locator('.react-flow__node[data-id^="pattern-"]').first();
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });

/** Save (Ctrl/Cmd+S) and wait until the server has it. */
async function save(page: Page) {
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/api/') && r.ok(),
  );
  await page.keyboard.press(`${mod}+s`);
  await saved;
  await expect(saveButton(page)).toBeDisabled();
}

async function createAgent(page: Page, name: string) {
  const { settings } = await (await page.request.get('/api/settings')).json();
  const res = await page.request.post('/api/agents', {
    data: {
      name,
      description: '',
      prompt: `You are the ${name}.`,
      skills: [],
      tools: [],
      defaults: settings.agentDefaults,
    },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).entity.id as string;
}

/** A project with an Input (Task) and an Output (Result), not connected. */
async function createProject(page: Page, name: string) {
  const workspace = mkdtempSync(join(tmpdir(), 'app-e2e-workspace-'));
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  const res = await page.request.post('/api/projects', {
    data: {
      name,
      description: '',
      workspacePath: workspace,
      overrides: {},
      workflow: {
        nodes: [
          { id: 'input', type: 'input', name: 'Task', payloadType: 'text', content: '', files: [] },
          { id: 'output', type: 'output', name: 'Result', payloadType: 'text' },
        ],
        edges: [],
      },
      layout: { nodes: { input: { x: 0, y: 0 }, output: { x: 1100, y: 0 } }, expanded: [] },
    },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).entity.id as string;
}

async function draftOf(page: Page, kind: string, id: string) {
  return (await page.request.get(`/api/${kind}/${id}?ref=draft`)).json();
}

/** Insert a pattern after the selected node from the palette, binding slots by role. */
async function insertPattern(page: Page, name: RegExp, bind: Record<string, string>) {
  await page.getByRole('button', { name: 'Pattern…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name }).click();
  for (const [role, agent] of Object.entries(bind)) {
    await dialog.getByLabel(`Agent for ${role}`).click();
    await page.getByRole('option', { name: agent, exact: true }).click();
  }
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(dialog).toBeHidden();
}

test('Maker-Checker: insert, bind, expand, collapse, fork, edit, promote as a new version', async ({
  page,
}) => {
  await createAgent(page, 'Coder');
  await createAgent(page, 'Critic');
  const projectId = await createProject(page, 'Review loop project');
  await page.goto(`/projects/${projectId}`);

  // --- Insert after the Task and bind both slots
  await byId(page, 'input').click();
  await insertPattern(page, /Maker-checker/, { Maker: 'Coder', Checker: 'Critic' });
  await expect(instance(page)).toContainText('2/2 slots bound');
  await expect(instance(page)).toContainText('v1');
  await save(page);
  let draft = await draftOf(page, 'projects', projectId);
  const node = draft.workflow.nodes.find((n: { type: string }) => n.type === 'pattern');
  expect(node.pattern).toEqual({ kind: 'pattern', id: MC, version: 'v1' });
  expect(Object.keys(node.bindings).sort()).toEqual(['checker', 'maker']);
  expect(draft.workflow.edges).toContainEqual(
    expect.objectContaining({ source: { node: 'input' }, target: { node: node.id, port: 'in' } }),
  );
  await shot(page, '20-inserted');

  // --- Expand: the pattern's nodes, with the bound agents, ports on the frame
  await instance(page).getByRole('button', { name: 'Expand pattern' }).click();
  await expect(byId(page, `${node.id}/maker`)).toContainText('Coder');
  await expect(byId(page, `${node.id}/checker`)).toContainText('Critic');
  await expect(byId(page, `${node.id}/in`)).toHaveAttribute('class', /wf-port/);
  await expect(byId(page, `${node.id}/out`)).toHaveAttribute('class', /wf-port/);
  await expect(saveButton(page)).toBeDisabled(); // Expanding is view state, not a change.
  await shot(page, '21-expanded');

  // --- Overrides for an agent inside the instance (by path; never forks)
  await byId(page, `${node.id}/maker`).click();
  await expect(inspector(page)).toContainText('Agent inside a pattern');
  await inspector(page).getByRole('radio', { name: 'high' }).click();
  await expect(byId(page, `${node.id}/maker`)).toContainText('overrides');
  await save(page);
  draft = await draftOf(page, 'projects', projectId);
  expect(draft.overrides).toEqual({ [`${node.id}/maker`]: { effort: 'high' } });

  // --- Collapse
  await page.getByRole('button', { name: 'Collapse pattern' }).click();
  await expect(byId(page, `${node.id}/maker`)).toHaveCount(0);
  await expect(instance(page)).toContainText('2/2 slots bound');

  // --- Fork
  await instance(page).click();
  await inspector(page).getByRole('button', { name: 'Customize for this project' }).click();
  await page.getByRole('button', { name: 'Fork pattern' }).click();
  await expect(instance(page)).toContainText('modified');
  await save(page);
  draft = await draftOf(page, 'projects', projectId);
  const fork = draft.workflow.nodes.find((n: { type: string }) => n.type === 'pattern').pattern
    .version as string;
  expect(fork).toMatch(/^fork-/);

  // --- Edit the fork: give the checker loop one more try, and rename the Checker
  await inspector(page).getByRole('link', { name: 'Edit fork' }).click();
  await expect(page.getByText('Pattern · project fork')).toBeVisible();
  await byId(page, 'checker').click();
  await page.locator('#slot-role').fill('Reviewer');
  await save(page);
  await shot(page, '22-fork-edited');
  const onFork = await (await page.request.get(`/api/patterns/${MC}?ref=${fork}`)).json();
  expect(onFork.workflow.nodes.find((n: { id: string }) => n.id === 'checker').binding.role).toBe(
    'Reviewer',
  );
  const mainBefore = await (await page.request.get(`/api/patterns/${MC}`)).json();
  expect(
    mainBefore.workflow.nodes.find((n: { id: string }) => n.id === 'checker').binding.role,
  ).toBe('Checker');

  // --- Promote back to the library as v2
  await page.getByRole('link', { name: '← Back to the project' }).click();
  await instance(page).click();
  await inspector(page).getByRole('button', { name: 'Merge to main' }).click();
  const merge = page.getByRole('dialog');
  await merge.getByLabel('What changed?').fill('Checker is now a Reviewer');
  // Promoting re-pins the node and saves the project right away.
  const projectSaved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes(`/api/projects/${projectId}`),
  );
  await merge.getByRole('button', { name: 'Merge as v2' }).click();
  expect((await projectSaved).ok()).toBe(true);
  await expect(page.getByText('Merged the fork into “Maker-checker” as v2').first()).toBeVisible();
  await expect(instance(page)).toContainText('v2');
  await expect(instance(page)).not.toContainText('modified');
  await expect(saveButton(page)).toBeDisabled(); // The project was saved with the new pin.
  await shot(page, '23-promoted');

  draft = await draftOf(page, 'projects', projectId);
  expect(draft.workflow.nodes.find((n: { type: string }) => n.type === 'pattern').pattern).toEqual({
    kind: 'pattern',
    id: MC,
    version: 'v2',
  });
  const status = await (await page.request.get(`/api/patterns/${MC}/versions`)).json();
  expect(status.versions).toEqual(['v2', 'v1']);
  expect(status.branches).toEqual([]);
  const history = await (await page.request.get(`/api/patterns/${MC}/history`)).json();
  expect(history.versions[0]).toMatchObject({ version: 'v2', note: 'Checker is now a Reviewer' });
  const main = await (await page.request.get(`/api/patterns/${MC}`)).json();
  expect(main.workflow.nodes.find((n: { id: string }) => n.id === 'checker').binding.role).toBe(
    'Reviewer',
  );
});

test('build a pattern by hand with a repeat group, merge it, and use it with N copies', async ({
  page,
}) => {
  await createAgent(page, 'Drafter');
  await createAgent(page, 'Editor');

  // --- New pattern: Input → Agent slot → Output
  await page.goto('/patterns');
  await page.getByRole('button', { name: 'New pattern' }).click();
  await page.getByLabel('Name').fill('Draft and edit');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Draft and edit').first()).toBeVisible();
  const patternId = page.url().split('/').pop() ?? '';

  // The slot becomes repeatable Drafters (2 by default); an Editor slot joins their drafts.
  await byId(page, 'agent').click();
  await page.locator('#slot-role').fill('Drafter');
  await page.locator('#node-repeat').click();
  await page.getByRole('option', { name: 'New repeat group…' }).click();
  await expect(byId(page, 'agent')).toContainText('×2');
  // An Editor slot after the Drafter (added from the palette and connected).
  await page.getByRole('button', { name: 'Slot' }).click();
  await page.locator('#slot-role').fill('Editor');
  // Checked as used: the Editor and the Result each get both copies' output, so need a join.
  await expect(page.getByText(/2 errors/)).toBeVisible();
  await shot(page, '24-pattern-joins');
  await inspector(page).getByRole('button', { name: 'Wait for all inputs' }).click();
  await byId(page, 'out').click();
  await inspector(page).getByRole('button', { name: 'Wait for all inputs' }).click();
  await expect(page.getByText(/0 errors|None/).first()).toBeVisible();
  await save(page);
  const saved = await draftOf(page, 'patterns', patternId);
  expect(saved.repeat).toEqual([
    expect.objectContaining({ label: 'Drafters', nodes: ['agent'], mode: 'parallel', default: 2 }),
  ]);
  expect(saved).not.toHaveProperty('overrides');

  // --- Merge as v2 (no errors left)
  await page.getByRole('button', { name: 'Merge as v2' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Merge as v2' }).click();
  await expect(page.getByText('Merged “Draft and edit” as v2').first()).toBeVisible();

  // --- Use it in a project with 3 Drafters
  const projectId = await createProject(page, 'Uses a hand-made pattern');
  await page.goto(`/projects/${projectId}`);
  await byId(page, 'input').click();
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('Draft and edit');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Number of Drafters').fill('3');
  await expect(dialog.getByLabel(/Agent for Drafter \d/)).toHaveCount(3);
  for (const n of [1, 2, 3]) {
    await dialog.getByLabel(`Agent for Drafter ${String(n)}`).click();
    await page.getByRole('option', { name: 'Drafter', exact: true }).click();
  }
  await dialog.getByLabel('Agent for Editor').click();
  await page.getByRole('option', { name: 'Editor', exact: true }).click();
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(instance(page)).toContainText('4/4 slots bound');
  await expect(instance(page)).toContainText('v2');
  await shot(page, '25-used');

  await instance(page).getByRole('button', { name: 'Expand pattern' }).click();
  const id = (await instance(page).getAttribute('data-id')) ?? '';
  for (const n of [1, 2, 3])
    await expect(byId(page, `${id}/agent@${String(n)}`)).toContainText('Drafter');
  await shot(page, '26-used-expanded');
});

test('nested patterns expand one level at a time', async ({ page }) => {
  await page.goto('/patterns/hierarchy-builtn');
  const team = byId(page, 'team');
  await expect(team).toContainText('Supervisor');
  await team.getByRole('button', { name: 'Expand pattern' }).click();
  await expect(byId(page, 'team/supervisor')).toBeVisible();
  await expect(byId(page, 'team/worker@1')).toBeVisible();
  await expect(byId(page, 'team/worker@2')).toBeVisible();
  await expect(byId(page, 'team/in')).toHaveAttribute('class', /wf-port/);
  // Nothing was changed by looking inside a built-in.
  await expect(saveButton(page)).toBeDisabled();
  await shot(page, '27-nested');
  await page.getByRole('button', { name: 'Collapse pattern' }).click();
  await expect(byId(page, 'team/supervisor')).toHaveCount(0);
});

test('a pattern inside a pattern: its slots stay open slots of the outer pattern', async ({
  page,
}) => {
  await page.goto('/patterns');
  await page.getByRole('button', { name: 'New pattern' }).click();
  await page.getByLabel('Name').fill('Reviewed pipeline');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Reviewed pipeline').first()).toBeVisible();

  await byId(page, 'agent').click();
  await page.getByRole('button', { name: 'Pattern…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Maker-checker/ }).click();
  await expect(dialog).toContainText('stay open');
  await expect(dialog.getByLabel(/Agent for/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(instance(page)).toBeVisible();
  await expect(instance(page)).not.toContainText('slots bound');
  // No unbound-slot error inside a pattern; the nested slots are listed on the instance.
  await instance(page).click();
  // Inserting pins Maker-checker's current version (an earlier test may have promoted v2).
  const status = await (await page.request.get(`/api/patterns/${MC}/versions`)).json();
  const current = await (await page.request.get(`/api/patterns/${MC}`)).json();
  const roles = current.workflow.nodes
    .filter((n: { type: string }) => n.type === 'agent')
    .map((n: { binding: { role: string } }) => n.binding.role);
  await expect(inspector(page)).toContainText(`Its slots (${roles.join(', ')})`);
  await expect(page.getByText(/unbound slot/)).toHaveCount(0);
  await save(page);
  const id = page.url().split('/').pop() ?? '';
  const saved = await draftOf(page, 'patterns', id);
  const nested = saved.workflow.nodes.find((n: { type: string }) => n.type === 'pattern');
  expect(nested.pattern).toEqual({ kind: 'pattern', id: MC, version: status.current });
  expect(nested.bindings).toEqual({});
});
