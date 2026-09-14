import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The three screens, in a real browser, against a real server on the synthetic
// village. Each assertion is a claim the screen makes about the run - the same
// rule the mount tests follow - and each screen is photographed into .run/e2e/
// so a change can be looked at. Nothing under .run/ is committed.

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.run', 'e2e', 'screens');
mkdirSync(SHOTS, { recursive: true });

const shot = (page: Page, name: string) =>
  page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });

/** Move the playback cursor to the last event: End on the range input. */
async function seekToEnd(page: Page) {
  const range = page.getByLabel('관찰 시점 (사건 번호)');
  await range.focus();
  await range.press('End');
}

const DAY_LABEL: Record<string, string> = {
  source_baseline: '기록된 하루 그대로',
  source_jittered: '기록된 시각이 조금 다른 하루',
  plausible_extension: '외출 하나가 다른 하루',
};

test.describe.configure({ mode: 'serial' });

test('관찰: 이웃 우선 정책에서 누가 거절했고 왜인지가 읽힌다', async ({ page }) => {
  // The run the screen will open: the shipped deck under 가까운 이웃 우선,
  // where the refusal table fires on the restaurant couple.
  const created = await page.request.post('/api/sim/attempts', {
    data: {
      policyId: 'policy-C-v1',
      scenarioDeckId: 'deck-p1-no-response-v1',
      resourceRevisionId: 'assumed-resources-v1',
    },
  });
  expect(created.ok()).toBeTruthy();
  const detail = await created.json();
  const refusals: { actorId: string; reason: string }[] = detail.metrics.refusals.rows;
  expect(refusals.length).toBeGreaterThan(0);

  await page.goto('/');
  await page.getByRole('button', { name: '마을 관찰' }).click();
  await expect(page.getByText('MEDial · 조율 현황')).toBeVisible();
  await seekToEnd(page);

  // The day the run happened on, in one line.
  const day = detail.metrics.dayRealization;
  await expect(page.getByText(DAY_LABEL[day.classification], { exact: true })).toBeVisible();

  // Every refusal: the person and the sentence they gave. Never the rule key.
  await expect(page.getByText('누구에게 부탁했고, 뭐라고 했나')).toBeVisible();
  for (const row of refusals) {
    await expect(page.getByText(row.reason).first()).toBeVisible();
  }
  await expect(page.getByText('persona_condition')).toHaveCount(0);
  // The house was empty and P9 had no lead: MEDial phoned the head for where
  // to look, and his answer closes his row. No place key on screen.
  await expect(page.getByText('어디 있을지 답함').first()).toBeVisible();
  await expect(page.getByText('FARM')).toHaveCount(0);
  await shot(page, 'observe-researcher');
  // The panels scroll inside themselves, so the list is photographed on its
  // own after being brought into view.
  const asked = page.getByText('누구에게 부탁했고, 뭐라고 했나');
  await asked.scrollIntoViewIfNeeded();
  await asked.locator('xpath=..').screenshot({ path: resolve(SHOTS, 'observe-asked.png') });

  // MEDial's own view. These refusals were addressed to MEDial, so they stay;
  // nothing is marked as hidden from it.
  await page.getByLabel('관찰 시점', { exact: true }).selectOption('medial');
  await expect(page.getByText(refusals[0].reason).first()).toBeVisible();
  await expect(page.getByText('MEDial은 모름')).toHaveCount(0);
  await shot(page, 'observe-medial');
});

test('관찰: 정책 D는 재연락을 먼저 하고, 이장에게 가는 이유를 관계 기록으로 말한다', async ({ page }) => {
  const created = await page.request.post('/api/sim/attempts', {
    data: {
      policyId: 'policy-D-v1',
      scenarioDeckId: 'deck-p1-no-response-v1',
      resourceRevisionId: 'assumed-resources-v1',
    },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: '마을 관찰' }).click();
  await expect(page.getByText('MEDial · 조율 현황')).toBeVisible();
  await seekToEnd(page);
  await page.getByLabel('관찰 시점', { exact: true }).selectOption('medial');
  // The retry is a phone call, before anyone else is asked.
  await expect(page.getByText(/전화로 연락했습니다 \(2번째\)/).first()).toBeVisible();
  // The head is last in this order; he is first here because the record has no one else.
  await expect(page.getByText(/기록된 가까운 관계는 이장 한 사람뿐/).first()).toBeVisible();
  // No engine key reaches a sentence.
  await expect(page.getByText(/neighbour_visit|PATROL|FARM/)).toHaveCount(0);
  await shot(page, 'observe-policy-d');
  const reasons = page.getByText('이렇게 정한 이유');
  await reasons.scrollIntoViewIfNeeded();
  await reasons.locator('xpath=..').screenshot({ path: resolve(SHOTS, 'observe-policy-d-reasons.png') });
});

test('준비 → 실행 → 비교: 어느 하루였나와 누가 거절했나가 표에 있다', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('button', { name: '실험 준비' }).click();
  await expect(page.getByRole('button', { name: '실험 시작' })).toBeEnabled();
  await shot(page, 'prepare');
  await page.getByRole('button', { name: '실험 시작' }).click();

  // The loop runs offline (no key) and hands back after its versions. The
  // compare tab becomes reachable as soon as one generation exists.
  const compare = page.getByRole('button', { name: '결과 비교' });
  await expect(compare).toBeEnabled({ timeout: 150_000 });
  // Not before the loop has finished: a version still running has no metrics
  // yet, and the table would show 미수집 in every row.
  await expect(page.getByText('실행 중', { exact: true })).toHaveCount(0, { timeout: 150_000 });
  await compare.click();
  await expect(page.getByText('어느 하루였나')).toBeVisible();
  await expect(page.getByText('누가 거절했나')).toBeVisible();
  // No score, no winner, no internal key.
  await expect(page.getByText('persona_condition')).toHaveCount(0);
  // A version that just ran has a day; only an old stored run may lack one.
  await expect(page.getByText('하루 기록 없음')).toHaveCount(0);
  await expect(page.getByText('미수집')).toHaveCount(0);
  // Only v0 exists: the screen says there is nothing to compare yet, not that
  // the comparison is uncontrolled.
  await expect(page.getByText('통제 비교가 아닙니다')).toHaveCount(0);
  await shot(page, 'compare');
});
