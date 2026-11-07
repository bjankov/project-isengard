import { DEMO_IDS } from '@app/schema';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_BASE_URL } from './env';
import { hundredNodeProject } from './fixtures/hundred-nodes';

/**
 * M7 "done when": a first-time user lands on a populated, good-looking app and can open,
 * understand and modify both example projects without explanation. Plus dark mode, keyboard
 * shortcuts and a 100-node workflow. Runs against its own server with a fresh library and the
 * demo content, as on a first launch.
 */
test.use({ baseURL: DEMO_BASE_URL });

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const node = (page: Page, text: string) =>
  page.locator('.react-flow__node').filter({ hasText: text }).first();
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const problems = (page: Page) => page.getByTestId('problems-toggle');

test('a first launch shows the example projects, ready to open and change', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('link', { name: /Plan, build, test/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Ticket router/ }).first()).toBeVisible();
  await expect(page.getByText('New here?')).toBeVisible();
  await shot(page, '70-first-launch');

  // --- Plan, build, test: open from the hint; clean, with notes that explain it
  await page.getByText('New here?').getByRole('link', { name: 'Plan, build, test' }).click();
  await expect(node(page, 'Executor')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(12);
  await expect(problems(page)).toContainText('None');
  await expect(node(page, 'Start here.')).toBeVisible();
  await expect(page.locator('[data-loop-badge]')).toHaveText('max 3');
  await shot(page, '71-plan-build-test');

  // The context preview shows what the Executor gets.
  await node(page, 'Executor').click();
  await page.keyboard.press('p');
  const preview = page.getByTestId('context-preview');
  await expect(preview).toContainText('only the section “## Tasks”');
  await expect(preview).toContainText('Write source');
  await page.keyboard.press('Escape');

  // Change it: a project override, saved and still there after a reload.
  await node(page, 'Executor').click();
  await inspector(page).getByRole('radio', { name: 'High' }).click();
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText(/Saved “Plan, build, test”/).first()).toBeVisible();
  await page.reload();
  await expect(node(page, 'Executor')).toContainText('overrides');
  await expect(
    page.locator('main header').getByRole('button', { name: 'Merge as v2' }),
  ).toBeEnabled();

  // --- Ticket router: the pattern opens up; change a node
  await page.goto(`/projects/${DEMO_IDS.projects.ticketRouter}`);
  await expect(node(page, 'Fix and review')).toBeVisible();
  await expect(problems(page)).toContainText('None');
  await node(page, 'Fix and review').getByRole('button', { name: 'Expand pattern' }).click();
  const frame = page.locator('[data-expanded="true"]');
  await expect(frame).toBeVisible();
  await expect(node(page, 'Reviewer')).toBeVisible();
  await shot(page, '72-ticket-router-expanded');
  await frame.getByRole('button', { name: 'Collapse pattern' }).click();
  await expect(frame).toHaveCount(0);

  await node(page, 'Researcher').click();
  await inspector(page).getByLabel('Label', { exact: true }).fill('Support researcher');
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText(/Saved “Ticket router”/).first()).toBeVisible();
  await page.reload();
  await expect(node(page, 'Support researcher')).toBeVisible();
  await expect(problems(page)).toContainText('None');
});

test('project cards show the home folder as ~', async ({ page }) => {
  const demo = await (
    await page.request.get(`/api/projects/${DEMO_IDS.projects.planBuildTest}`)
  ).json();
  const workspace = demo.workspacePath as string;
  const home = workspace.slice(0, workspace.lastIndexOf('/'));
  // Pretend the home folder is the one holding the demo workspace.
  await page.route('**/api/health', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), homeDir: home } });
  });
  await page.goto('/projects');
  // Both demo projects use the demo workspace; the full path stays in the tooltip.
  const path = page.getByRole('list').locator(`[title="${workspace}"]`).first();
  await expect(path).toHaveText('~/demo-workspace');
});

test('dark mode follows the switch and is remembered', async ({ page }) => {
  await page.goto('/projects');
  const html = page.locator('html');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await page.goto(`/projects/${DEMO_IDS.projects.planBuildTest}`);
  await expect(page.locator('.react-flow.dark')).toBeVisible();
  await shot(page, '73-dark-canvas');
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(page.locator('.react-flow.light')).toBeVisible();
});

test('keyboard shortcuts: the list, tabs, zoom to fit', async ({ page }) => {
  await page.goto('/projects');
  await page.keyboard.press('?');
  const list = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(list).toContainText('Quick add');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);

  await page.keyboard.press('g');
  await page.keyboard.press('3');
  await expect(page).toHaveURL(/\/skills$/);
  await page.keyboard.press('g');
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/\/projects$/);

  // Not while typing in a field.
  await page.goto('/agents');
  await page.getByPlaceholder('Search').fill('g2');
  await expect(page).toHaveURL(/\/agents$/);

  // F zooms to fit, Esc clears the selection.
  await page.goto(`/projects/${DEMO_IDS.projects.planBuildTest}`);
  await expect(node(page, 'Executor')).toBeVisible();
  const viewport = page.locator('.react-flow__viewport');
  const fitted = await viewport.getAttribute('style');
  await page.mouse.move(600, 400);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200);
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(fitted);
  await page.keyboard.press('f');
  await expect.poll(() => viewport.getAttribute('style')).toBe(fitted);
  await node(page, 'Planner').click();
  await expect(node(page, 'Planner')).toHaveClass(/selected/);
  await page.keyboard.press('Escape');
  await expect(node(page, 'Planner')).not.toHaveClass(/selected/);
});

test('a 100-node workflow stays responsive', async ({ page }) => {
  const demo = await (
    await page.request.get(`/api/projects/${DEMO_IDS.projects.planBuildTest}`)
  ).json();
  const res = await page.request.post('/api/projects', {
    data: hundredNodeProject(demo.workspacePath as string),
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { entity } = (await res.json()) as { entity: { id: string } };

  // Opening: the canvas with all 100 nodes and the checks done.
  await page.goto('/projects');
  const t0 = Date.now();
  await page.goto(`/projects/${entity.id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(100);
  await expect(problems(page)).toContainText('None');
  const openMs = Date.now() - t0;

  // Typing in the inspector: time from each input event to the next frame.
  await node(page, 'ok 3?').click();
  const question = inspector(page).getByLabel('Question', { exact: true });
  await question.click();
  const keystrokes = await question.evaluate(async (el) => {
    const input = el as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      setValue?.call(input, `${input.value}x`);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      times.push(performance.now() - t);
    }
    return times.sort((a, b) => a - b);
  });
  const keystrokeMs = keystrokes[Math.floor(keystrokes.length / 2)] ?? Infinity;
  await expect(node(page, 'ok 3?xxxx')).toBeVisible();

  // Dragging a node: frames while it moves.
  const box = (await node(page, 'ok 5?').boundingBox())!;
  await page.evaluate(() => {
    const w = window as unknown as { frames_: number[] };
    w.frames_ = [];
    let last = performance.now();
    const tick = (t: number) => {
      w.frames_.push(t - last);
      last = t;
      if (w.frames_.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const t1 = Date.now();
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 5, box.y + box.height / 2 + i * 2);
  }
  await page.mouse.up();
  const dragMsPerMove = (Date.now() - t1) / 40;
  const frames = await page.evaluate(() =>
    (window as unknown as { frames_: number[] }).frames_.slice(2).sort((a, b) => a - b),
  );
  const p90Frame = frames[Math.floor(frames.length * 0.9)] ?? Infinity;

  const result = { openMs, keystrokeMs, dragMsPerMove, p90Frame };
  console.log('100-node workflow:', JSON.stringify(result));
  // Budgets with headroom. Before M7's fixes: ~45 ms per keystroke and 50 ms frames while
  // dragging (20 fps). The time per mouse move includes Playwright's own overhead, so its bound
  // is loose; the frame times are what show a regression.
  expect(openMs, JSON.stringify(result)).toBeLessThan(4000);
  expect(keystrokeMs, JSON.stringify(result)).toBeLessThan(35);
  expect(p90Frame, JSON.stringify(result)).toBeLessThan(34);
  expect(dragMsPerMove, JSON.stringify(result)).toBeLessThan(80);
});
