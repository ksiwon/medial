import { expect, type Page } from '@playwright/test';

// Steps both specs take on the case screen after the playback row was reduced
// to play, clock, slider and a gear (2026-09-15).

/** Run the clock to the end of the day: End on the time slider. The cursor
 *  follows to the last event and the row offers the residents' evaluations. */
export async function seekToEnd(page: Page) {
  const range = page.getByLabel('시각', { exact: true });
  await range.focus();
  await range.press('End');
}

/** The gear at the end of the playback row holds the secondary controls -
 *  speed, one-event stepping, the MEDial-only view, a new case. */
export async function openSettings(page: Page) {
  const view = page.getByLabel('관찰 시점', { exact: true });
  if (!(await view.isVisible())) await page.getByLabel('재생 설정', { exact: true }).click();
}

export async function setView(page: Page, mode: 'researcher' | 'medial') {
  await openSettings(page);
  await page.getByLabel('관찰 시점', { exact: true }).selectOption(mode);
  await page.getByLabel('재생 설정', { exact: true }).click();
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

