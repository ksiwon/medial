import { expect, test, type Locator, type Page } from '@playwright/test';
import { setView, toSetup } from './helpers';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Presentation captures, one per screen and per feature.
//
// Separate from screens.spec.ts on purpose. That file asserts claims and fails
// when a screen stops making them; this one asserts only enough to know it is
// photographing the right thing, and its output is meant to be pasted into
// slides. The default e2e run ignores this file (testIgnore in
// playwright.config.ts); run it with `npm run shots`.
//
// Everything here comes from the synthetic village and the throwaway database
// under .run/e2e/, so no capture can carry a real place name or a real person.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs', 'research', 'screenshots', '2026-09-15-ui');
mkdirSync(OUT, { recursive: true });

// Retina-sized: a 1440px screen lands as 2880px, which survives a projector.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
test.describe.configure({ mode: 'serial' });

const shot = (page: Page, name: string) => page.screenshot({ path: resolve(OUT, `${name}.png`) });
async function crop(target: Locator, name: string) {
  // A missing crop target should say so in twenty seconds, not hold the whole
  // capture run until the test times out.
  await target.first().waitFor({ state: 'visible', timeout: 20_000 });
  await target.first().screenshot({ path: resolve(OUT, `${name}.png`) });
}

/** The panel a title belongs to. */
const panel = (page: Page, title: string) =>
  page.getByRole('heading', { name: title }).locator('xpath=ancestor::section[1]');

async function openHint(page: Page, label: string) {
  await page.getByLabel(`${label} 설명`, { exact: true }).click();
  await expect(page.getByRole('tooltip')).toBeVisible();
}

test('@shots A 사례와 서비스 경험', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: '사례와 서비스 경험', exact: true }).click();

  await toSetup(page);

  await shot(page, '01-case-setup');

  // The settings that are folded by default: scenarios, adapters, budget.
  await page.getByText('실험 설정').click();
  await expect(page.getByText('무엇을 모델이 하는가')).toBeVisible();
  await shot(page, '02-case-setup-settings');
  await page.getByText('실험 설정').click();

  await page.getByRole('button', { name: '실험 시작', exact: true }).click();

  // The loop runs a day, collects the evaluations and stops for the researcher.
  await expect(page.getByText('실행 중', { exact: true })).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByRole('button', { name: '주민 평가', exact: true })).toBeEnabled({
    timeout: 180_000,
  });

  // When the day ends the app moves the reader to the evaluations. The way
  // back into the recording is the round trip the loop is built on: an
  // evaluation cites an event, and the scene opens at that event.
  await page.getByRole('button', { name: '주민 평가', exact: true }).click();
  await expect(page.getByText('평가 항목의 개수')).toBeVisible({ timeout: 60_000 });
  await page.getByText(/사건 근거 [0-9]+건 보기/).first().click();
  await page.getByText('그 장면 열기').first().click();

  const range = page.getByLabel('시각', { exact: true });
  await expect(range).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('MEDial · 조율 현황')).toBeVisible();
  await shot(page, '03-observe');
  await crop(panel(page, '합성 마을'), '04-observe-map');
  await crop(panel(page, '지금 일어난 일'), '05-observe-happening');
  await crop(
    page.getByText('MEDial · 조율 현황').locator('xpath=ancestor::section[1]'),
    '06-observe-orchestrator',
  );
  // Opening a scene can leave the third column on one person; the board is the
  // resting state and the shot is of the board.
  const backToBoard = page.getByTitle('마을 사람들로 돌아가기');
  if (await backToBoard.count()) await backToBoard.click();
  await crop(panel(page, '마을 사람들'), '07-observe-people');
  await crop(
    page.getByLabel('반복 진행 상태', { exact: true }).locator('xpath=..'),
    '08-progress-bar',
  );

  // At the end of the log the middle column becomes the day's evaluations.
  await range.focus();
  await range.press('End');
  const dayReviews = page.getByRole('heading', { name: '하루를 마친 주민들의 리뷰' });
  await expect(dayReviews).toBeVisible({ timeout: 20_000 });
  await crop(dayReviews.locator('xpath=ancestor::section[1]'), '08b-observe-day-reviews');

  // What MEDial itself was told, as opposed to what the world did.
  await setView(page, 'medial');
  await expect(page.getByText('MEDial이 보고받은 위치만 표시 중')).toBeVisible();
  await shot(page, '09-observe-medial-view');
  await setView(page, 'researcher');

  // One resident's own day, opened from the board.
  await panel(page, '마을 사람들').getByText('P1', { exact: true }).first().click();
  await expect(page.getByText(/하루를 마친 뒤의 평가/)).toBeVisible();
  await shot(page, '10-observe-person');
});

test('@shots B 주민 평가', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: '주민 평가', exact: true }).click();
  await expect(page.getByText('평가 항목의 개수')).toBeVisible({ timeout: 60_000 });
  await shot(page, '11-evaluations');

  const card = page.getByText('1 · 이번에 무엇을 경험했나').locator('xpath=ancestor::div[2]');
  await crop(card, '12-evaluations-card');

  // An evaluation item, opened onto the events it cites.
  const evidence = page.getByText(/사건 근거 [0-9]+건 보기/).first();
  if (await evidence.count()) {
    await evidence.click();
    await expect(page.getByText('그 장면 열기').first()).toBeVisible();
    await crop(card, '13-evaluations-evidence');
  }

  // The caveat that used to be printed under every row.
  await openHint(page, '이 숫자');
  await shot(page, '14-hint');
  await page.keyboard.press('Escape');

  const issues = page.getByText('쟁점 묶음');
  await issues.scrollIntoViewIfNeeded();
  await shot(page, '15-evaluations-issues');
});

test('@shots C 개선과 확인', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: '개선과 확인', exact: true }).click();
  await expect(page.getByText('바꿀 운영 규칙')).toBeVisible({ timeout: 30_000 });

  await page.getByText('지원 규칙에서 직접 작성').click();
  await expect(page.getByText('어떤 규칙을 바꾸나요')).toBeVisible();
  await page.getByLabel('바꿀 규칙', { exact: true }).selectOption('retry_before_help');
  await page.getByLabel('재연락 횟수', { exact: true }).fill('2');
  await page.getByLabel('수정안 이름', { exact: true }).fill('본인에게 두 번 더 확인');
  await page
    .getByLabel('변경을 시도하는 이유', { exact: true })
    .fill('이웃의 시간을 쓰기 전에 본인 확인 기회를 늘린다');

  const composer = page.getByText('바꿀 운영 규칙').locator('xpath=ancestor::div[2]');
  await composer.scrollIntoViewIfNeeded();
  await shot(page, '16-improve-composer');
  await crop(page.getByText('바뀌기 전').locator('xpath=..'), '17-improve-preview');

  await page.getByRole('button', { name: '수정안으로 저장 (실행하지 않음)', exact: true }).click();
  const confirm = page.getByRole('button', { name: '이유를 기록하고 수정안 실행', exact: true });
  await expect(confirm).toBeDisabled({ timeout: 20_000 });
  await shot(page, '18-improve-saved-not-run');

  await page
    .getByLabel('확정 이유', { exact: true })
    .fill('주민 평가에서 본인 확인 기회가 없다는 항목이 나왔다');
  await expect(confirm).toBeEnabled();
  await crop(confirm.locator('xpath=ancestor::div[2]'), '19-improve-confirm');
  await confirm.click();

  // The child run, and what the comparison then says about it. The row itself
  // is always on the table, so what we wait for is its verdict.
  await expect(page.getByText(/적용됨|적용 상황 없었음|판정 불가/).first()).toBeVisible({
    timeout: 180_000,
  });
  // An <option> is never "visible"; what matters is that the right-hand side of
  // the comparison has followed the run that was just confirmed.
  await expect
    .poll(
      async () =>
        await page
          .getByLabel('오른쪽 버전', { exact: true })
          .evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? ''),
      { timeout: 60_000 },
    )
    .toContain('본인에게 두 번 더 확인');
  // The save notice is about the previous step; it is not part of the result.
  const dismiss = page.getByRole('button', { name: '닫기', exact: true });
  if (await dismiss.count()) await dismiss.first().click();
  await page.getByRole('heading', { name: '무엇이 달라졌나요?' }).scrollIntoViewIfNeeded();
  await shot(page, '20-improve-comparison');
  // The table is taller than the window and lives inside its own scroller, so
  // an element capture at 900px comes back half blank. Give it a tall window.
  await page.setViewportSize({ width: 1440, height: 1800 });
  await crop(page.locator('table').first(), '21-improve-table');
  await page.setViewportSize({ width: 1440, height: 900 });
  const applied = page.getByText('바뀐 규칙이 실행됐나');
  await applied.scrollIntoViewIfNeeded();
  await crop(applied.locator('xpath=..'), '22-improve-rule-applied');

  const chain = page.getByText('다음 시도에서 바꾼 이유');
  await chain.scrollIntoViewIfNeeded();
  await shot(page, '23-improve-chain');
  await crop(chain.locator('xpath=..'), '24-improve-chain-crop');
});

test('@shots D 현장 기록', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: '개선과 확인', exact: true }).click();
  const open = page.getByRole('button', { name: '현장에서 검토할 안 선택', exact: true });
  if (await open.count()) {
    await open.click();
  } else {
    await page.getByText('지금까지의 결정 기록 보기').click();
  }
  const sheet = page.getByRole('dialog', { name: '현장 검토 선택' });
  await expect(sheet).toBeVisible();
  await crop(sheet, '25-field-decision');

  await page
    .getByLabel('현장 검토 결정 이유', { exact: true })
    .fill('이 장면을 실제 주민에게 물어본다');
  await page.getByRole('button', { name: '이 결정으로 기록', exact: true }).click();
  await expect(page.getByText('현장 기록 · 실제 응답')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('1단계 · 공개 전')).toBeVisible();
  await page.getByText('1단계 · 공개 전').scrollIntoViewIfNeeded();
  await crop(sheet, '26-field-stage-1');

  await page.getByLabel('응답자 가명 ID', { exact: true }).fill('R-01');
  await page.getByLabel('공개 전 응답 내용', { exact: true }).fill('직접 가 봤을 것 같다');
  await page.getByRole('button', { name: '공개 전 독립 응답으로 저장', exact: true }).click();
  const disclose = page.getByRole('button', {
    name: '모의 평가를 보여 주었음을 기록',
    exact: true,
  });
  await expect(disclose).toBeVisible({ timeout: 30_000 });
  await disclose.scrollIntoViewIfNeeded();
  await crop(sheet, '27-field-stage-2');

  await disclose.click();
  await expect(page.getByText('3단계 · 공개 후 비교')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('모의 평가와의 비교', { exact: true }).selectOption('disagreement');
  await page.getByLabel('고쳐야 할 것', { exact: true }).selectOption('behaviour_model');
  await page
    .getByLabel('공개 후 응답 내용', { exact: true })
    .fill('그 시간에는 그렇게 하지 않는다');
  await page.getByText('3단계 · 공개 후 비교').scrollIntoViewIfNeeded();
  await crop(sheet, '28-field-stage-3');
  await page.getByRole('button', { name: '공개 후 응답으로 저장', exact: true }).click();
  await expect(page.getByText(/고칠 곳: 주민 행동 모델/)).toBeVisible({ timeout: 30_000 });
  await crop(sheet, '29-field-records');
});

test('@shots E 좁은 폭', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: '개선과 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '무엇이 달라졌나요?' })).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, '30-narrow-800');
});
