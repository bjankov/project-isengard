import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * M2 "done when": editing an agent happens on a branch, merging creates v2, and history and
 * diffs are viewable.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

async function save(page: Page, toast: string) {
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/') && ['POST', 'PUT'].includes(r.request().method()),
  );
  await page.getByRole('button', { name: 'Save' }).click();
  expect((await response).ok()).toBe(true);
  await expect(page.getByText(toast).first()).toBeVisible();
}

test('edit an agent on a draft, merge it as v2, then view history and diffs', async ({ page }) => {
  const header = page.locator('main header');
  const indicator = header.getByTestId('version-indicator');
  const list = page.getByRole('navigation', { name: 'Agents' });

  // --- Create: goes straight to main as v1
  await page.goto('/agents/new');
  await expect(indicator).toHaveText('New · saving creates v1');
  await page.getByLabel('Name', { exact: true }).fill('Versioned agent');
  await page.getByLabel('Description', { exact: true }).fill('First description');
  await save(page, 'Saved “Versioned agent” as v1');
  await expect(page).toHaveURL(/\/agents\/versioned-agent-[a-z0-9]{6}$/);
  const id = page.url().split('/').pop()!;
  await expect(indicator).toContainText('v1');
  await expect(indicator).toContainText('main');
  await expect(header.getByRole('button', { name: /Merge/ })).toHaveCount(0);

  // --- Edit: the indicator announces the draft; saving commits to it, main is unchanged
  await page.getByLabel('Description', { exact: true }).fill('Second description');
  await expect(indicator).toContainText('new draft');
  await save(page, 'Saved “Versioned agent” to the draft');
  await expect(indicator).toContainText('draft · 1 save');
  await expect(list.getByRole('link', { name: /Versioned agent/ })).toContainText('draft');
  const onMain = await (await page.request.get(`/api/agents/${id}`)).json();
  expect(onMain.description).toBe('First description');
  const onDraft = await (await page.request.get(`/api/agents/${id}?ref=draft`)).json();
  expect(onDraft.description).toBe('Second description');
  await shot(page, '10-agent-draft');

  // Reloading reopens the draft, not main.
  await page.reload();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Second description');
  await expect(indicator).toContainText('draft · 1 save');

  // --- Merge: creates v2 and closes the draft
  const merge = header.getByRole('button', { name: 'Merge as v2' });
  await expect(merge).toBeEnabled();
  await merge.click();
  await expect(page.getByText('Merged “Versioned agent” as v2').first()).toBeVisible();
  await expect(indicator).toContainText('v2');
  await expect(indicator).toContainText('main');
  await expect(header.getByRole('button', { name: /Merge/ })).toHaveCount(0);
  await expect(list.getByRole('link', { name: /Versioned agent/ })).not.toContainText('draft');
  const merged = await (await page.request.get(`/api/agents/${id}`)).json();
  expect(merged.description).toBe('Second description');
  const status = await (await page.request.get(`/api/agents/${id}/versions`)).json();
  expect(status).toEqual({ current: 'v2', versions: ['v2', 'v1'], branches: [] });

  // --- History: v1 → v2 by default, with a side-by-side diff
  await header.getByRole('button', { name: 'History' }).click();
  const sheet = page.getByRole('dialog', { name: /History of/ });
  await expect(sheet).toBeVisible();
  const timeline = sheet.getByRole('complementary', { name: 'History' });
  await expect(timeline.getByRole('button', { name: /^v2/ })).toBeVisible();
  await expect(timeline.getByRole('button', { name: /^v1/ })).toBeVisible();
  await expect(sheet.getByLabel('Compare from')).toHaveText('v1');
  await expect(sheet.getByLabel('Compare to')).toHaveText(/v2/);
  const diff = sheet.getByTestId('diff-viewer');
  await expect(diff).toContainText('First description');
  await expect(diff).toContainText('Second description');
  await shot(page, '11-history-v1-v2');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // --- A new edit starts a new draft; history compares it with v2
  await page.getByLabel('Description', { exact: true }).fill('Third description');
  await save(page, 'Saved “Versioned agent” to the draft');
  await expect(header.getByRole('button', { name: 'Merge as v3' })).toBeVisible();
  await header.getByRole('button', { name: 'History' }).click();
  await expect(timeline.getByRole('button', { name: /draft \(latest save\)/ })).toBeVisible();
  await expect(sheet.getByLabel('Compare from')).toHaveText(/v2/);
  await expect(diff).toContainText('Third description');
  await shot(page, '12-history-draft');

  // Pick v1 → v2 again from the timeline.
  await timeline.getByRole('button', { name: /^v2/ }).click();
  await expect(sheet.getByLabel('Compare to')).toHaveText(/v2/);
  await expect(diff).toContainText('First description');
  await page.keyboard.press('Escape');

  // --- Discard: back to v2
  await header.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();
  await expect(page.getByText('Draft discarded').first()).toBeVisible();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Second description');
  await expect(indicator).toContainText('v2');
  await expect(indicator).toContainText('main');
});

test('new references pin the current version of a skill', async ({ page }) => {
  // A skill at v2 (created and merged through the API).
  const created = await (
    await page.request.post('/api/skills', {
      data: { name: 'pinned-skill', description: 'Pinned skill', body: '' },
    })
  ).json();
  const skillId: string = created.entity.id;
  await page.request.put(`/api/skills/${skillId}`, {
    data: { name: 'pinned-skill', description: 'Pinned skill, edited', body: '' },
  });
  await page.request.post(`/api/skills/${skillId}/merge`);

  await page.goto('/agents/new');
  await page.getByLabel('Name', { exact: true }).fill('Pinning agent');
  await page.getByRole('button', { name: 'Add skill' }).click();
  await page.getByRole('option', { name: /pinned-skill/ }).click();
  const card = page.locator('main').getByRole('link', { name: 'pinned-skill' }).locator('..');
  await expect(card).toContainText('v2');
  await save(page, 'Saved “Pinning agent” as v1');
  const agentId = page.url().split('/').pop()!;
  const agent = await (await page.request.get(`/api/agents/${agentId}`)).json();
  expect(agent.skills).toEqual([{ kind: 'skill', id: skillId, version: 'v2' }]);
});

test('a merge conflict shows main against the draft and can be merged anyway', async ({ page }) => {
  const { settings } = await (await page.request.get('/api/settings')).json();
  const input = {
    name: 'Conflict agent',
    description: 'Original',
    prompt: '',
    skills: [],
    tools: [],
    defaults: settings.agentDefaults,
  };
  const created = await (await page.request.post('/api/agents', { data: input })).json();
  const id: string = created.entity.id;
  await page.request.put(`/api/agents/${id}`, {
    data: { ...input, description: 'From the draft' },
  });

  // Someone edits main's copy directly in the library repo.
  const { libraryDir } = await (await page.request.get('/api/health')).json();
  const file = join(libraryDir, 'agents', `${id}.yaml`);
  writeFileSync(file, readFileSync(file, 'utf8').replace('Original', 'From main'));
  execFileSync('git', ['commit', '-qam', 'Edit by hand'], { cwd: libraryDir });

  await page.goto(`/agents/${id}`);
  await page.locator('main header').getByRole('button', { name: 'Merge as v2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Main changed since this draft started' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('diff-viewer')).toContainText('From main');
  await expect(dialog.getByTestId('diff-viewer')).toContainText('From the draft');
  await shot(page, '13-merge-conflict');
  await dialog.getByRole('button', { name: 'Merge anyway as v2' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Merged “Conflict agent” as v2').first()).toBeVisible();
  const merged = await (await page.request.get(`/api/agents/${id}`)).json();
  expect(merged.description).toBe('From the draft');
});
