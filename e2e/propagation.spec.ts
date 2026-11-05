import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * M6 "done when": changing a skill used by two agents in three projects shows the full cascade,
 * and each choice produces the expected pinned versions. Plus the update badge on a node, the
 * delete-with-references flow, templates on the canvas and Restore defaults.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const header = (page: Page) => page.locator('main header');
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });

async function post<T = { entity: { id: string } }>(page: Page, url: string, data?: unknown) {
  const res = await page.request.post(url, data === undefined ? {} : { data });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}
const get = async <T>(page: Page, url: string) => (await (await page.request.get(url)).json()) as T;

async function createSkill(page: Page, name: string) {
  return (
    await post(page, '/api/skills', { name, description: `How to ${name}.`, body: `# ${name}\n` })
  ).entity.id;
}

async function createAgent(page: Page, name: string, skills: string[]) {
  const { settings } = await get<{ settings: { agentDefaults: unknown } }>(page, '/api/settings');
  return (
    await post(page, '/api/agents', {
      name,
      description: '',
      prompt: `You are the ${name}.`,
      skills: skills.map((id) => ({ kind: 'skill', id, version: 'v1' })),
      tools: [],
      defaults: settings.agentDefaults,
    })
  ).entity.id;
}

/** Task → agents (chained) → Result. */
async function createProject(
  page: Page,
  name: string,
  agents: { node: string; agent: string }[],
  overrides: Record<string, unknown> = {},
) {
  const workspace = mkdtempSync(join(tmpdir(), 'app-e2e-workspace-'));
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  const ids = ['input', ...agents.map((a) => a.node), 'output'];
  const nodes = [
    { id: 'input', type: 'input', name: 'Task', payloadType: 'text', content: '', files: [] },
    ...agents.map((a) => ({
      id: a.node,
      type: 'agent',
      binding: { kind: 'agent', agent: { kind: 'agent', id: a.agent, version: 'v1' } },
    })),
    { id: 'output', type: 'output', name: 'Result', payloadType: 'text' },
  ];
  const edges = ids.slice(1).map((target, i) => ({
    id: `e${i}`,
    source: { node: ids[i] },
    target: { node: target },
    payload: 'text',
    context: { mode: 'full' },
  }));
  const positions = Object.fromEntries(ids.map((id, i) => [id, { x: i * 320, y: 0 }]));
  return (
    await post(page, '/api/projects', {
      name,
      description: '',
      workspacePath: workspace,
      overrides,
      workflow: { nodes, edges },
      layout: { nodes: positions },
    })
  ).entity.id;
}

type Project = {
  workflow: { nodes: { id: string; type: string; binding?: { agent: { version: string } } }[] };
  overrides: Record<string, unknown>;
};
async function pins(page: Page, id: string, ref = 'main') {
  const p = await get<Project>(page, `/api/projects/${id}?ref=${ref}`);
  return Object.fromEntries(
    p.workflow.nodes.flatMap((n) => (n.binding ? [[n.id, n.binding.agent.version]] : [])),
  );
}

test('a skill change cascades to two agents and three projects, as chosen', async ({ page }) => {
  const skill = await createSkill(page, 'cascade-tests');
  const coder = await createAgent(page, 'Cascade Coder', [skill]);
  const tester = await createAgent(page, 'Cascade Tester', [skill]);
  const one = await createProject(page, 'Cascade One', [{ node: 'coder', agent: coder }], {
    coder: { effort: 'high' },
  });
  const two = await createProject(page, 'Cascade Two', [{ node: 'tester', agent: tester }]);
  const three = await createProject(page, 'Cascade Three', [
    { node: 'coder', agent: coder },
    { node: 'tester', agent: tester },
  ]);

  // Change the skill and merge it as v2: the cascade preview opens.
  await page.goto(`/skills/${skill}`);
  await page.getByLabel('Description', { exact: true }).fill('How to write good tests.');
  await page.keyboard.press(`${mod}+s`);
  await expect(saveButton(page)).toBeDisabled();
  await header(page).getByRole('button', { name: 'Merge as v2' }).click();
  const popover = page.getByRole('dialog').filter({ has: page.getByLabel('What changed?') });
  await popover.getByLabel('What changed?').fill('Clearer description');
  await popover.getByRole('button', { name: 'Merge as v2' }).click();

  const dialog = page.getByRole('dialog', { name: 'Update what uses it?' });
  await expect(dialog).toBeVisible();
  const tree = dialog.getByRole('tree');
  for (const name of [
    'Cascade Coder',
    'Cascade Tester',
    'Cascade One',
    'Cascade Two',
    'Cascade Three',
  ]) {
    await expect(tree.getByRole('treeitem', { name: new RegExp(name) }).first()).toBeVisible();
  }
  // Two agents, plus One, Two and Three's two nodes.
  await expect(dialog.getByTestId('cascade-count')).toHaveText('6 of 6 updates selected');
  await shot(page, '60-cascade-preview');

  // Decline project Two, and the Tester node of project Three.
  await dialog.getByRole('checkbox', { name: 'Cascade Two: Node “Cascade Tester”' }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Cascade Three: Node “Cascade Tester”' }).uncheck();
  await expect(dialog.getByTestId('cascade-count')).toHaveText('4 of 6 updates selected');

  // Declining an agent disables what depends on it, and accepting it again re-enables it.
  const testerBox = dialog.getByRole('checkbox', { name: 'Cascade Tester: Skill' });
  await testerBox.uncheck();
  await expect(
    dialog.getByRole('checkbox', { name: 'Cascade Two: Node “Cascade Tester”' }),
  ).toBeDisabled();
  await testerBox.check();
  await shot(page, '61-cascade-choices');

  await dialog.getByRole('button', { name: /^Apply 4 updates/ }).click();
  await expect(page.getByText('Updated 4 entities')).toBeVisible();
  await expect(dialog).toBeHidden();

  // Each choice gives the expected pins; overrides survive.
  const agentSkill = async (id: string) =>
    (await get<{ skills: { version: string }[] }>(page, `/api/agents/${id}`)).skills[0]?.version;
  expect(await agentSkill(coder)).toBe('v2');
  expect(await agentSkill(tester)).toBe('v2');
  expect(await pins(page, one)).toEqual({ coder: 'v2' });
  expect((await get<Project>(page, `/api/projects/${one}`)).overrides).toEqual({
    coder: { effort: 'high' },
  });
  expect(await pins(page, two)).toEqual({ tester: 'v1' });
  expect(await pins(page, three)).toEqual({ coder: 'v2', tester: 'v1' });

  // The Tester agent now lists two users on older versions.
  await page.goto(`/agents/${tester}`);
  await expect(
    header(page).getByRole('button', { name: '2 users on older versions' }),
  ).toBeVisible();

  // Project Two: the node shows "v1 → v2"; update just this instance.
  await page.goto(`/projects/${two}`);
  const badge = page.locator('.react-flow__node[data-id="tester"]').getByRole('button', {
    name: 'Update available: v1 → v2',
  });
  await expect(badge).toBeVisible();
  await shot(page, '62-update-badge');
  await badge.click();
  const updatePopover = page.getByRole('dialog').filter({ hasText: 'Update available' });
  await expect(updatePopover.getByRole('list', { name: 'Changes' })).toContainText(
    'Uses skill cascade-tests v2',
  );
  await shot(page, '63-update-popover');
  await updatePopover.getByRole('button', { name: 'Update to v2' }).click();
  await expect(badge).toBeHidden();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.ok());
  await page.keyboard.press(`${mod}+s`);
  await saved;
  expect(await pins(page, two, 'draft')).toEqual({ tester: 'v2' });
});

test('deleting a used agent keeps a local copy in the project', async ({ page }) => {
  const agent = await createAgent(page, 'Doomed Agent', []);
  const project = await createProject(page, 'Keeps Copy', [{ node: 'doomed', agent }]);
  const other = await createProject(page, 'Gets Pasted', []);

  await page.goto(`/agents/${agent}`);
  await header(page).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('is still in use');
  await expect(dialog.getByRole('radio', { name: 'Local copy' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await shot(page, '64-delete-with-references');
  await dialog.getByRole('button', { name: 'Delete and update 1 user' }).click();
  await expect(page.getByText('Deleted “Doomed Agent”')).toBeVisible();
  expect((await page.request.get(`/api/agents/${agent}`)).status()).toBe(404);

  // The project keeps working with the copy: the node shows it, and merging is allowed.
  await page.goto(`/projects/${project}`);
  const node = page.locator('.react-flow__node[data-id="doomed"]');
  await expect(node).toContainText('Doomed Agent');
  await expect(node).toContainText('local copy');
  await shot(page, '65-local-copy');
  const p = await get<{ localCopies: Record<string, unknown> }>(page, `/api/projects/${project}`);
  expect(Object.keys(p.localCopies)).toEqual([`agent/${agent}@v1`]);

  // Copy the node into another project: its local copy comes along.
  await node.click();
  await page.keyboard.press(`${mod}+c`);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: /Gets Pasted/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${other}$`));
  await page.locator('.react-flow__pane').click();
  await page.keyboard.press(`${mod}+v`);
  const pasted = page.locator('.react-flow__node[data-id^="agent"]');
  await expect(pasted).toContainText('Doomed Agent');
  await expect(pasted).toContainText('local copy');
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.ok());
  await page.keyboard.press(`${mod}+s`);
  await saved;
  const draft = await get<{ localCopies: Record<string, unknown> }>(
    page,
    `/api/projects/${other}?ref=draft`,
  );
  expect(Object.keys(draft.localCopies)).toEqual([`agent/${agent}@v1`]);
});

test('templates open on the canvas', async ({ page }) => {
  const agent = await createAgent(page, 'Template Agent', []);
  const project = await createProject(page, 'Template Source', [{ node: 'a', agent }]);
  const source = await get<{ workflow: unknown; layout: unknown }>(
    page,
    `/api/projects/${project}`,
  );
  const template = (
    await post(page, '/api/templates', {
      name: 'Canvas Template',
      description: '',
      workflow: source.workflow,
      layout: source.layout,
    })
  ).entity.id;

  await page.goto('/projects');
  const card = page.getByRole('region', { name: 'Workflow templates' }).locator('li', {
    hasText: 'Canvas Template',
  });
  await card.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(new RegExp(`/templates/${template}$`));
  await expect(header(page)).toContainText('Template');
  await expect(page.locator('.react-flow__node[data-id="a"]')).toContainText('Template Agent');
  // No project-only parts: no workspace, overrides or Save as template.
  await expect(page.getByRole('button', { name: 'Save as template' })).toHaveCount(0);
  await page.locator('.react-flow__node[data-id="a"]').click();
  await expect(page.getByRole('region', { name: 'Project overrides' })).toHaveCount(0);
  await shot(page, '66-template-canvas');
});

test('Restore defaults brings back a deleted built-in pattern', async ({ page }) => {
  const id = 'ensemble-builtn';
  const del = await page.request.delete(`/api/patterns/${id}`);
  expect(del.ok()).toBe(true);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Restore defaults' }).click();
  await expect(page.getByText('Restored 1 built-in pattern')).toBeVisible();
  const status = await get<{ current: string }>(page, `/api/patterns/${id}/versions`);
  expect(status.current).toBe('v2');
});
