import { expect, type Page } from '@playwright/test';

// Steps both specs take on the case screen: a playback row of play, clock,
// slider, reading pace and a gear; the stage between map shots and scenes
// (2026-09-28).

/** The gear at the end of the playback row holds the secondary controls -
 *  the MEDial-only view, scene by scene, a new case. */
export async function openSettings(page: Page) {
  const view = page.getByLabel('관찰 시점', { exact: true });
  if (!(await view.isVisible())) await page.getByLabel('재생 설정', { exact: true }).click();
}

export async function setView(page: Page, mode: 'researcher' | 'medial') {
  await openSettings(page);
  await page.getByLabel('관찰 시점', { exact: true }).selectOption(mode);
  await page.getByLabel('재생 설정', { exact: true }).click();
}

/**
 * Watch the day scene by scene and return what the screen said in each: the
 * stage's captions and bubbles and MEDial's panel, as text. Each scene plays
 * for `playMs` and is read every half second, because its lines replace each
 * other.
 */
export async function watchScenes(page: Page, playMs = 3500): Promise<string[]> {
  await openSettings(page);
  await page.getByRole('button', { name: '처음으로', exact: true }).click();
  const count = Number((await page.getByText(/^장면 \d+개/).textContent())?.match(/\d+/)?.[0] ?? 0);
  await page.getByLabel('재생 설정', { exact: true }).click();
  const seen: string[] = [];
  for (let i = 0; i < count; i += 1) {
    await openSettings(page);
    await page.getByRole('button', { name: '다음 장면 →', exact: true }).click();
    await page.getByLabel('재생 설정', { exact: true }).click();
    await page.getByRole('button', { name: '▶ 재생', exact: true }).click();
    let text = '';
    for (let t = 0; t < playMs; t += 500) {
      await page.waitForTimeout(500);
      text += ` ${await page.locator('body').innerText()}`;
    }
    await page.getByRole('button', { name: '⏸ 정지', exact: true }).click();
    seen.push(text);
  }
  return seen;
}

/** Get to the case set-up. A database with runs opens on the last run, so a new
 *  case is a step behind the gear; an empty one opens on the set-up itself. */
export async function toSetup(page: Page) {
  const gear = page.getByLabel('재생 설정', { exact: true });
  const start = page.getByRole('button', { name: '실험 시작', exact: true });
  await expect(gear.or(start).first()).toBeVisible({ timeout: 30_000 });
  if (await gear.isVisible()) {
    await gear.click();
    await page.getByRole('button', { name: '새 사례 준비', exact: true }).click();
  }
  await expect(start).toBeEnabled({ timeout: 20_000 });
}

