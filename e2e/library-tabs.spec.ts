import { expect, test, type Page } from '@playwright/test';

/**
 * M1 "done when": a user can create a skill, a scoped preset and an agent that uses both,
 * entirely in the UI.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

/** Monaco puts the aria-label on its hidden textarea; click the editor that contains it. */
async function typeInMonaco(page: Page, label: string, text: string) {
  const editor = page.locator('.monaco-editor', { has: page.getByLabel(label, { exact: true }) });
  await expect(editor).toBeVisible();
  await editor.locator('.view-lines').click();
  await page.keyboard.type(text);
}

async function save(page: Page, name: string) {
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/') && ['POST', 'PUT'].includes(r.request().method()),
  );
  await page.getByRole('button', { name: 'Save' }).click();
  expect((await response).ok()).toBe(true);
  await expect(page.getByText(`Saved “${name}”`).first()).toBeVisible();
}

test('create a skill, a scoped preset and an agent using both, entirely in the UI', async ({
  page,
}) => {
  // --- Skill
  await page.goto('/skills');
  await shot(page, '01-skills-empty');
  await page.getByRole('link', { name: 'New skill' }).first().click();
  await page.getByLabel('Name', { exact: true }).fill('Write Unit Tests');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('write-unit-tests');
  await page
    .getByLabel('Description', { exact: true })
    .fill('Write focused unit tests for changed code.');
  await typeInMonaco(page, 'Skill instructions', '# Write unit tests\n- One behaviour per test');
  await shot(page, '02-skill-editor');
  await save(page, 'write-unit-tests');
  await expect(page).toHaveURL(/\/skills\/write-unit-tests-[a-z0-9]{6}$/);
  const skillId = page.url().split('/').pop()!;
  await expect(
    page.getByRole('navigation', { name: 'Skills' }).getByText('write-unit-tests'),
  ).toBeVisible();

  // --- Shell preset: starts with one empty command row; removing it shows the warning
  await page.getByRole('link', { name: 'Tools', exact: true }).click();
  await page.getByRole('link', { name: 'New preset' }).first().click();
  await page.locator('main a[href="/tools/new?builtin=shell"]').click();
  await page.getByLabel('Name', { exact: true }).fill('Run tests');
  await page.getByRole('button', { name: 'Remove command 1' }).click();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert.getByText('Unrestricted shell', { exact: true })).toBeVisible();
  // …and the badge in the editor header
  await expect(page.locator('main header').getByText('Unrestricted shell')).toBeVisible();
  await shot(page, '03-shell-unrestricted');
  await page.getByRole('button', { name: 'Add command' }).click();
  await page.getByLabel('Command 1', { exact: true }).fill('npm test');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await save(page, 'Run tests');
  await expect(page).toHaveURL(/\/tools\/run-tests-[a-z0-9]{6}$/);
  const shellId = page.url().split('/').pop()!;

  // --- Read preset scoped to src/**
  await page.getByRole('link', { name: 'New preset' }).first().click();
  await page.locator('main a[href="/tools/new?builtin=read_file"]').click();
  await page.getByLabel('Name', { exact: true }).fill('Read src');
  await page.getByLabel('Path glob 1', { exact: true }).fill('src/**');
  await expect(page.getByText('read src/**').first()).toBeVisible();
  await shot(page, '04-read-preset');
  await save(page, 'Read src');
  const readId = page.url().split('/').pop()!;

  // --- Agent using the skill and both presets
  await page.getByRole('link', { name: 'Agents', exact: true }).click();
  await page.getByRole('link', { name: 'New agent' }).first().click();
  await page.getByLabel('Name', { exact: true }).fill('Tester');
  await page.getByLabel('Description', { exact: true }).fill('Writes and runs tests.');
  await typeInMonaco(page, 'Agent prompt', 'You write tests and run them.');
  await page.getByRole('button', { name: 'Add skill' }).click();
  await page.getByRole('option', { name: /write-unit-tests/ }).click();
  await page.getByRole('button', { name: 'Add tool' }).click();
  await page.getByRole('option', { name: /Run tests/ }).click();
  await page.getByRole('button', { name: 'Add tool' }).click();
  await page.getByRole('option', { name: /Read src/ }).click();
  await page.getByRole('radio', { name: 'high' }).click();
  await page.getByLabel('Max iterations', { exact: true }).fill('8');
  await shot(page, '05-agent-editor');
  await save(page, 'Tester');
  await expect(page).toHaveURL(/\/agents\/tester-[a-z0-9]{6}$/);
  const agentId = page.url().split('/').pop()!;

  // --- Persisted with pinned references
  const agent = await (await page.request.get(`/api/agents/${agentId}`)).json();
  expect(agent).toMatchObject({
    name: 'Tester',
    prompt: 'You write tests and run them.',
    skills: [{ kind: 'skill', id: skillId, version: 'v1' }],
    tools: [
      { kind: 'tool', id: shellId, version: 'v1' },
      { kind: 'tool', id: readId, version: 'v1' },
    ],
    defaults: { effort: 'high', limits: { maxIterations: 8 } },
  });

  // --- Survives a reload
  await page.reload();
  await expect(page.getByRole('link', { name: 'write-unit-tests' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Run tests' })).toBeVisible();
  await expect(page.getByText('shell: npm test')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read src' })).toBeVisible();
  await expect(
    page.locator('.monaco-editor').getByText('You write tests and run them.'),
  ).toBeVisible();
  await shot(page, '06-agent-reloaded');

  // --- The skill cannot be deleted while the agent uses it
  await page.goto(`/skills/${skillId}`);
  await expect(page.getByRole('link', { name: 'Tester' })).toBeVisible(); // "Used by"
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('is still in use')).toBeVisible();
  await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Tester' })).toBeVisible();
  await shot(page, '07-delete-blocked');
});

test('unsaved changes are guarded and validation errors are shown', async ({ page }) => {
  await page.goto('/agents/new');
  await page.getByLabel('Name', { exact: true }).fill('Half done');
  await page.getByRole('link', { name: 'Skills', exact: true }).click();
  await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/agents\/new$/);

  await page.getByLabel('Name', { exact: true }).fill('');
  await page.getByLabel('Max tokens', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Some fields need attention')).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Max tokens', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await shot(page, '08-validation');

  await page.getByRole('link', { name: 'Skills', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(/\/skills$/);
});

test('settings: edit the model list and agent defaults', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByLabel('Model id 1', { exact: true })).toHaveValue('claude-opus-5-5');
  await page.getByRole('button', { name: 'Add model' }).click();
  const n = await page.getByRole('textbox', { name: /^Provider \d+$/ }).count();
  await page.getByLabel(`Provider ${n}`, { exact: true }).fill('local');
  await page.getByLabel(`Model id ${n}`, { exact: true }).fill('llama-4-70b');
  await page.getByLabel(`Label ${n}`, { exact: true }).fill('Llama 4 70B');
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /Llama 4 70B/ }).click();
  await shot(page, '09-settings');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  const res = await (await page.request.get('/api/settings')).json();
  expect(res.settings.agentDefaults.model).toEqual({ provider: 'local', model: 'llama-4-70b' });

  // New agents start from the new defaults
  await page.goto('/agents/new');
  await expect(page.getByRole('combobox').first()).toContainText('Llama 4 70B');
});

test('skills: advanced frontmatter via the form and via raw SKILL.md', async ({ page }) => {
  await page.goto('/skills/new');
  // Hidden until asked for
  await expect(page.getByLabel('License', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.getByLabel('Name', { exact: true }).fill('pdf-tools');
  await page.getByLabel('Description', { exact: true }).fill('Extract text from PDFs.');
  await page.getByLabel('License', { exact: true }).fill('Apache-2.0');
  await page.getByLabel('Compatibility', { exact: true }).fill('Needs poppler-utils');
  await page.getByRole('button', { name: 'Add entry' }).click();
  await page.getByLabel('Metadata key 1', { exact: true }).fill('author');
  await page.getByLabel('Metadata value 1', { exact: true }).fill('docs-team');
  await page.getByLabel('Add allowed tool', { exact: true }).fill('Bash(pdftotext:*) Read');
  await page.getByLabel('Add allowed tool', { exact: true }).press('Enter');
  await typeInMonaco(page, 'Other frontmatter fields (YAML)', 'x-team: docs');
  await shot(page, '10-skill-advanced');
  await save(page, 'pdf-tools');
  const skillId = page.url().split('/').pop()!;

  const saved = await (await page.request.get(`/api/skills/${skillId}`)).json();
  expect(saved).toMatchObject({
    license: 'Apache-2.0',
    compatibility: 'Needs poppler-utils',
    metadata: { author: 'docs-team' },
    allowedTools: ['Bash(pdftotext:*)', 'Read'],
    extraFrontmatter: { 'x-team': 'docs' },
  });

  // Raw SKILL.md shows the same data, in the standard format
  await page.getByRole('radio', { name: 'SKILL.md' }).click();
  const raw = page.locator('.monaco-editor', { has: page.getByLabel('SKILL.md', { exact: true }) });
  await expect(raw.getByText('allowed-tools: Bash(pdftotext:*) Read')).toBeVisible();
  await shot(page, '11-skill-raw');

  // Invalid YAML is reported and blocks switching back
  await raw.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('---\nname: a: b\n---\n');
  await expect(page.getByText(/not valid YAML/)).toBeVisible();

  // Replace the file with a flat one and go back to the form
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(
    '---\nname: pdf-tools\ndescription: PDFs only\ncompatibility: Needs network\n---\nBody',
  );
  await page.getByRole('radio', { name: 'Form' }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('PDFs only');
  await expect(page.getByLabel('Compatibility', { exact: true })).toHaveValue('Needs network');
  await expect(page.getByLabel('License', { exact: true })).toHaveValue('');
  await save(page, 'pdf-tools');

  const edited = await (await page.request.get(`/api/skills/${skillId}?ref=draft`)).json();
  expect(edited).toMatchObject({
    description: 'PDFs only',
    compatibility: 'Needs network',
    body: 'Body',
  });
  expect(edited.license).toBeUndefined();
  expect(edited.extraFrontmatter).toBeUndefined();

  // Hiding advanced shows how many advanced fields are set; the choice is remembered
  await page.getByRole('button', { name: 'Hide advanced' }).click();
  await expect(page.getByLabel('Compatibility', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Advanced\s*1/ })).toBeVisible();
  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.reload();
  await expect(page.getByLabel('Compatibility', { exact: true })).toBeVisible();
});

test('skills: invalid other-fields YAML blocks saving', async ({ page }) => {
  await page.goto('/skills/new');
  const toggle = page.getByRole('button', { name: /Advanced/ });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await page.getByLabel('Name', { exact: true }).fill('broken-yaml');
  await page.getByLabel('Description', { exact: true }).fill('x');
  await typeInMonaco(page, 'Other frontmatter fields (YAML)', 'x: a: b');
  await expect(page.getByText(/Other fields is not valid YAML/)).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Fix the YAML before saving')).toBeVisible();
  expect(page.url()).toMatch(/\/skills\/new$/);
});
