import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * M4 "done when": a loop without a cap blocks saving, every validation rule can be triggered
 * and resolved, and the context preview reflects each context mode.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function post(request: APIRequestContext, kind: string, data: object): Promise<string> {
  const res = await request.post(`/api/${kind}`, { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).entity.id as string;
}

const ref = (kind: string, id: string) => ({ kind, id, version: 'v1' });
const edge = (id: string, source: object, target: object, context: object = { mode: 'full' }) => ({
  id,
  source,
  target,
  payload: 'text',
  context,
});

/** Demo workflow 1 with tools that make it valid: no problems at all. */
async function seed(page: Page) {
  const { request } = page;
  const { settings } = await (await request.get('/api/settings')).json();
  // The e2e run shares one library: suffix preset names so other specs' pickers stay unique.
  const tag = Math.random().toString(36).slice(2, 6);
  const tool = (name: string, builtin: string, scope: object) =>
    post(request, 'tools', { name: `${name} (${tag})`, description: '', builtin, scope });
  const readSrc = await tool('Read src', 'read_file', { paths: ['src/**'] });
  const writePlan = await tool('Write plan', 'write_file', { paths: ['PLAN.md'] });
  const runTests = await tool('Run tests', 'shell', {
    commands: [{ match: 'exact', command: 'npm test' }],
  });
  await tool('Any shell', 'shell', { commands: [] });
  const skill = await post(request, 'skills', {
    name: `plan-in-tasks-${tag}`,
    description: 'Write plans as a list of small tasks.',
    body: '# Plans\n\nEnd with a `## Tasks` section.',
  });
  const agent = (name: string, prompt: string, skills: string[], tools: string[]) =>
    post(request, 'agents', {
      name,
      description: '',
      prompt,
      skills: skills.map((s) => ref('skill', s)),
      tools: tools.map((t) => ref('tool', t)),
      defaults: settings.agentDefaults,
    });
  const planner = await agent('Planner', 'Turn the task into PLAN.md.', [skill], [writePlan]);
  const executor = await agent('Executor', 'Implement the next task from the plan.', [], [readSrc]);

  const workspace = mkdtempSync(join(tmpdir(), 'app-e2e-m4-'));
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  const nodes = [
    { id: 'in', type: 'input', name: 'Task', payloadType: 'text', content: 'Add /health' },
    { id: 'planner', type: 'agent', binding: { kind: 'agent', agent: ref('agent', planner) } },
    { id: 'plan', type: 'artifact', path: 'PLAN.md', fileType: 'markdown' },
    { id: 'executor', type: 'agent', binding: { kind: 'agent', agent: ref('agent', executor) } },
    { id: 'tests', type: 'toolStep', tool: ref('tool', runTests), args: { command: 'npm test' } },
    {
      id: 'pass',
      type: 'decision',
      label: 'tests pass?',
      evaluator: { type: 'deterministic', language: 'python', code: 'import sys\nsys.exit(0)\n' },
      exits: [
        { id: 'yes', label: 'pass' },
        { id: 'no', label: 'fail', maxIterations: 3 },
      ],
    },
    { id: 'out', type: 'output', name: 'Result', payloadType: 'text' },
  ];
  const edges = [
    edge('e1', { node: 'in' }, { node: 'planner' }),
    { ...edge('e2', { node: 'planner' }, { node: 'plan' }), payload: 'file' },
    {
      ...edge(
        'e3',
        { node: 'plan' },
        { node: 'executor' },
        { mode: 'excerpt', selector: { kind: 'heading', heading: '## Tasks' } },
      ),
      payload: 'file',
    },
    { ...edge('e4', { node: 'executor' }, { node: 'tests' }), payload: 'none' },
    edge('e5', { node: 'tests' }, { node: 'pass' }),
    edge('e6', { node: 'pass', port: 'yes' }, { node: 'out' }),
    {
      ...edge(
        'e7',
        { node: 'pass', port: 'no' },
        { node: 'executor' },
        {
          mode: 'summary',
          model: { provider: 'anthropic', model: 'claude-haiku-5-5' },
          instruction: '',
        },
      ),
      history: 'latest',
    },
  ];
  const layout = {
    nodes: Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 288, y: (i % 2) * 64 }])),
  };
  return post(request, 'projects', {
    name: 'M4 demo',
    description: '',
    workspacePath: workspace,
    overrides: { executor: { effort: 'high' } },
    workflow: { nodes, edges },
    layout,
  });
}

function node(page: Page, text: string | RegExp): Locator {
  return page.locator('.react-flow__node').filter({ hasText: text });
}
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const edgeLabel = (page: Page, id: string) =>
  page.locator(`[data-edge-label="${id}"] > span`).first();

/** The rules of the problems listed under the canvas. */
async function rules(page: Page): Promise<string[]> {
  const toggle = page.getByTestId('problems-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  return page
    .getByTestId('problems-list')
    .locator('[data-problem-rule]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-problem-rule') ?? '').sort());
}
const expectRules = (page: Page, expected: string[]) =>
  expect.poll(() => rules(page)).toEqual([...expected].sort());

async function selectOption(page: Page, label: string, option: string | RegExp) {
  await inspector(page).getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option }).click();
}

/** A handle's box once it stopped moving (the view may still be fitting). */
async function settledBox(loc: Locator) {
  let prev = await loc.boundingBox();
  for (;;) {
    await loc.page().waitForTimeout(50);
    const next = await loc.boundingBox();
    if (prev && next && prev.x === next.x && prev.y === next.y) return next;
    prev = next;
  }
}

async function connect(page: Page, from: Locator, to: Locator) {
  const a = await settledBox(from);
  const b = await settledBox(to);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

const fitView = (page: Page) => page.locator('.react-flow__controls-fitview').click();

test('validation: every rule can be triggered and resolved; loops block saving, errors block merging', async ({
  page,
}) => {
  const id = await seed(page);
  await page.goto(`/projects/${id}`);
  await expect(node(page, 'tests pass?')).toBeVisible();
  await expectRules(page, []);
  await expect(page.getByTestId('problems-list')).toContainText('Nothing to fix');

  // --- A loop without a cap: highlighted, and Save is refused (client and server)
  await edgeLabel(page, 'e7').click();
  await inspector(page).getByLabel('Max loops', { exact: true }).fill('');
  await expectRules(page, ['uncapped-loop']);
  await expect(page.locator('[data-loop-badge]')).toHaveText('no cap');
  await expect(page.getByTestId('problems-toggle')).toContainText('Saving is blocked');
  await expect(node(page, 'Executor').locator('[data-problem="error"]')).toHaveCount(1);
  await shot(page, '30-uncapped-loop');
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText('Can’t save: a loop has no cap').first()).toBeVisible();
  const versions = await (await page.request.get(`/api/projects/${id}/versions`)).json();
  expect(versions.branches).toEqual([]);
  // The one-click fix caps it.
  await page.getByTestId('problems-list').getByRole('button', { name: 'Cap at 3 loops' }).click();
  await expectRules(page, []);
  await expect(page.locator('[data-loop-badge]')).toHaveText('max 3');

  // --- A loop with no decision at all can't be capped: it must be removed
  await fitView(page);
  await connect(
    page,
    node(page, 'Run tests').locator('.react-flow__handle.source'),
    node(page, 'Executor').locator('.react-flow__handle.target'),
  );
  await expectRules(page, ['uncapped-loop']);
  await expect(page.getByTestId('problems-list')).toContainText('has no decision');
  await page.keyboard.press(`${mod}+z`);
  await expectRules(page, []);

  // --- Unrestricted shell in a tool step (warning)
  await node(page, 'Run tests').click();
  await selectOption(page, 'Tool preset', /^Any shell/);
  await expectRules(page, ['unrestricted-shell']);
  await expect(page.getByTestId('problems-toggle')).toContainText('1 warning');
  await selectOption(page, 'Tool preset', /^Run tests/);
  await expectRules(page, []);

  // --- An agent writes an artifact without a write tool covering it
  await node(page, 'PLAN.md').click();
  await inspector(page).getByLabel('Path', { exact: true }).fill('README.md');
  await expectRules(page, ['write-not-covered']);
  await expect(page.getByTestId('problems-list')).toContainText(
    'Planner writes README.md, but none of its tools can write there',
  );
  await inspector(page).getByLabel('Path', { exact: true }).fill('PLAN.md');
  await expectRules(page, []);

  // --- Reference mode: needs a file, and a read tool covering it
  await edgeLabel(page, 'e3').click();
  await selectOption(page, 'Context mode', /^Reference/);
  await expectRules(page, ['reference-not-covered']);
  await expect(inspector(page).getByLabel('Problems here')).toContainText(
    'Executor gets PLAN.md by reference',
  );
  await shot(page, '31-reference-not-covered');
  await selectOption(page, 'Context mode', /^Full/);
  await expectRules(page, []);
  await edgeLabel(page, 'e1').click();
  await selectOption(page, 'Context mode', /^Reference/);
  await expectRules(page, ['reference-not-file']);
  await selectOption(page, 'Context mode', /^Full/);
  await expectRules(page, []);

  // --- A second input needs a join mode
  await connect(
    page,
    node(page, 'Task').locator('.react-flow__handle.source'),
    node(page, 'Executor').locator('.react-flow__handle.target'),
  );
  await expectRules(page, ['missing-join']);
  await expect(node(page, 'Executor')).toContainText('join?');
  await page
    .getByTestId('problems-list')
    .getByRole('button', { name: 'Wait for all inputs' })
    .click();
  await expectRules(page, []);
  await expect(node(page, 'Executor')).toContainText('join all');
  await node(page, 'Executor').click();
  await inspector(page).getByRole('radio', { name: 'Some' }).click();
  await inspector(page).getByLabel('Inputs needed').fill('3');
  await expectRules(page, ['join-too-large']);
  await inspector(page).getByLabel('Inputs needed').fill('1');
  await expectRules(page, []);
  await expect(node(page, 'Executor')).toContainText('join 1 of 2');

  // --- A decision exit that leads nowhere
  await node(page, 'tests pass?').click();
  await inspector(page).getByRole('button', { name: 'Add exit' }).click();
  await expectRules(page, ['exit-unconnected']);
  await inspector(page).getByRole('button', { name: 'Remove exit 3' }).click();
  await expectRules(page, []);

  // --- A node nothing leads to
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
  await page
    .getByRole('complementary', { name: 'Node palette' })
    .getByRole('button', { name: 'Human input' })
    .click();
  await expectRules(page, ['unreachable']);
  await page.keyboard.press('Delete');
  await expectRules(page, []);

  // --- Errors don't block saving, but they block merging
  await edgeLabel(page, 'e3').click();
  await selectOption(page, 'Context mode', /^Reference/);
  await expectRules(page, ['reference-not-covered']);
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText('Saved “M4 demo” to the draft').first()).toBeVisible();
  const header = page.locator('main header');
  const merge = header.getByRole('button', { name: 'Merge as v2' });
  await expect(merge).toBeDisabled();
  await merge.locator('..').hover();
  await expect(page.getByRole('tooltip')).toContainText('Fix the workflow’s error first');
  await shot(page, '32-merge-blocked');
  // The server refuses it too.
  const refused = await page.request.post(`/api/projects/${id}/merge`, { data: {} });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).problems.map((p: { rule: string }) => p.rule)).toEqual([
    'reference-not-covered',
  ]);

  await selectOption(page, 'Context mode', /^Full/);
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText('Saved “M4 demo” to the draft').first()).toBeVisible();
  await expect(merge).toBeEnabled();
  await merge.click();
  await page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('What changed?') })
    .getByRole('button', { name: 'Merge as v2' })
    .click();
  await expect(page.getByText('Merged “M4 demo” as v2').first()).toBeVisible();
});

test('decisions: Python code from a file, ordered exits, what happens when a cap is hit', async ({
  page,
}) => {
  const id = await seed(page);
  await page.goto(`/projects/${id}`);
  await node(page, 'tests pass?').click();

  // Load a file with the picker; a non-Python file is refused.
  const file = inspector(page).getByTestId('evaluator-file');
  await file.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(page.getByText('“notes.txt” is not a Python file').first()).toBeVisible();
  await file.setInputFiles({
    name: 'tests_pass.py',
    mimeType: 'text/x-python',
    buffer: Buffer.from(
      'import sys\nreport = sys.stdin.read()\nsys.exit(0 if "ok" in report else 1)\n',
    ),
  });
  await expect(inspector(page)).toContainText('Loaded from tests_pass.py');
  await expect(inspector(page).locator('.monaco-editor .view-lines')).toContainText(
    'report = sys.stdin.read()',
  );

  // Drag and drop a file onto the editor.
  await inspector(page)
    .getByTestId('evaluator-drop')
    .evaluate((el) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['print("dropped")\n'], 'dropped.py', { type: 'text/x-python' }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        el.dispatchEvent(
          new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
      }
    });
  await expect(inspector(page)).toContainText('Loaded from dropped.py');
  await expect(inspector(page).locator('.monaco-editor .view-lines')).toContainText('dropped');
  await shot(page, '33-decision-code');

  // Exit order matters (exit code 0 takes the first): move "fail" up.
  await inspector(page).getByRole('button', { name: 'Move exit 2 up' }).click();
  await expect(node(page, 'tests pass?').locator('[data-exit]')).toHaveText([/fail/, /pass/]);

  // When the cap is hit: take another exit.
  await inspector(page).getByLabel('When exit 1 runs out of loops').click();
  await page.getByRole('option', { name: 'Take “pass”' }).click();

  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText('Saved “M4 demo” to the draft').first()).toBeVisible();
  const saved = await (await page.request.get(`/api/projects/${id}?ref=draft`)).json();
  const decision = saved.workflow.nodes.find((n: { id: string }) => n.id === 'pass');
  expect(decision.evaluator).toEqual({
    type: 'deterministic',
    language: 'python',
    code: 'print("dropped")\n',
    sourceFileName: 'dropped.py',
  });
  expect(decision.exits).toEqual([
    { id: 'no', label: 'fail', maxIterations: 3, onExhausted: { action: 'exit', exit: 'yes' } },
    { id: 'yes', label: 'pass' },
  ]);

  // A new decision switched to Human starts with approve / reject.
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
  await page
    .getByRole('complementary', { name: 'Node palette' })
    .getByRole('button', { name: 'Decision' })
    .click();
  await selectOption(page, 'Evaluator', 'Human');
  await expect(inspector(page).getByLabel('Exit 1 label')).toHaveValue('approve');
  await expect(inspector(page).getByLabel('Exit 2 label')).toHaveValue('reject');
});

test('context preview shows exactly what an agent receives, for every context mode', async ({
  page,
}) => {
  const id = await seed(page);
  await page.goto(`/projects/${id}`);
  await node(page, 'Executor').click();
  await page.keyboard.press('p');
  const preview = page.getByTestId('context-preview');
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId('preview-prompt')).toHaveText(
    'Implement the next task from the plan.',
  );
  await expect(preview).toContainText('high effort');
  await expect(preview.getByRole('region', { name: 'Tools' })).toContainText('read src/**');
  const inputs = preview.getByTestId('preview-input');
  await expect(inputs).toHaveCount(2);
  await expect(inputs.nth(0)).toHaveAttribute('data-mode', 'excerpt');
  await expect(inputs.nth(0)).toContainText('PLAN.md');
  await expect(inputs.nth(0)).toContainText('only the section “## Tasks”');
  await expect(inputs.nth(1)).toHaveAttribute('data-mode', 'summary');
  await expect(inputs.nth(1)).toContainText(/Run tests \(\w+\)’s result/);
  await expect(inputs.nth(1)).toContainText('via tests pass? → fail');
  await expect(inputs.nth(1)).toContainText('a summary by');
  await expect(inputs.nth(1)).toContainText('latest attempt only');
  await page.waitForTimeout(600); // let the panel finish sliding in
  await shot(page, '34-context-preview');
  await page.keyboard.press('Escape');

  // Change the PLAN.md edge through each mode and check what the preview says.
  const cases: [RegExp, string, ((p: Page) => Promise<void>)?][] = [
    [/^Full/, 'in full'],
    [/^Reference/, 'as a workspace path only; the agent reads it on demand'],
    [/^Diff/, 'only the changes since the workspace’s last commit'],
    [
      /^Excerpt/,
      'only lines 1–10',
      async (p) => {
        await selectOption(p, 'Selector', 'Line range');
      },
    ],
    [/^Summary/, 'a summary by'],
    [/^Outcome only/, 'only the outcome, plus the evaluator’s notes; no content'],
  ];
  for (const [mode, text, extra] of cases) {
    await edgeLabel(page, 'e3').click();
    await selectOption(page, 'Context mode', mode);
    if (extra) await extra(page);
    await node(page, 'Executor').click();
    await inspector(page)
      .getByRole('button', { name: /Context preview/ })
      .click();
    await expect(inputs.nth(0)).toContainText(text);
    if (String(mode).includes('Reference')) {
      // The preview also says why it is a problem: Executor can only read src/**.
      await expect(inputs.nth(0)).toContainText('none of its tools can read it');
    }
    await page.keyboard.press('Escape');
  }

  // Loop history: all attempts.
  await edgeLabel(page, 'e7').click();
  await inspector(page).getByRole('radio', { name: 'All' }).click();
  await node(page, 'Executor').click();
  await page.keyboard.press('p');
  await expect(inputs.nth(1)).toContainText('all attempts');
});
