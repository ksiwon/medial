import { expect, test, type Page } from '@playwright/test';
import { seekToEnd, setView, toSetup } from './helpers';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The three screens, in a real browser, against a real server on the synthetic
// village: 사례와 서비스 경험 / 주민 평가 / 개선과 확인. Each assertion is a claim
// the screen makes about the run - the same rule the mount tests follow - and
// each screen is photographed into .run/e2e/ so a change can be looked at.
// Nothing under .run/ is committed.

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.run', 'e2e', 'screens');
mkdirSync(SHOTS, { recursive: true });

const shot = (page: Page, name: string) =>
  page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });

/** Open the "?" beside something and read what it says. The screens keep their
 *  careful sentences one click from the thing they qualify rather than printed
 *  under every row, so a reader - and a test - asks for them. */
async function hint(page: Page, label: string) {
  await page.getByLabel(`${label} 설명`, { exact: true }).click();
  return page.getByRole('tooltip');
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
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: '사례와 서비스 경험', exact: true }).click();
  await expect(page.getByText('MEDial · 조율 현황')).toBeVisible();
  await seekToEnd(page);

  // The day the run happened on, in one line - behind the gear, off the map.
  const day = detail.metrics.dayRealization;
  await page.getByLabel('재생 설정', { exact: true }).click();
  await expect(page.getByText(DAY_LABEL[day.classification], { exact: true })).toBeVisible();
  await page.getByLabel('재생 설정', { exact: true }).click();

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
  await setView(page, 'medial');
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
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: '사례와 서비스 경험', exact: true }).click();
  await expect(page.getByText('MEDial · 조율 현황')).toBeVisible();
  await seekToEnd(page);
  await setView(page, 'medial');
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

test('사례 → 실행 → 주민 평가 → 개선과 확인: 한 바퀴가 실제로 돈다', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: '사례와 서비스 경험', exact: true }).click();
  // The earlier tests left runs in this database, so the case screen opens on
  // one of them; setting up a new case is an explicit step.
  await toSetup(page);
  await shot(page, 'case-setup');
  await page.getByRole('button', { name: '실험 시작', exact: true }).click();

  // The loop stops for the researcher, and the app lands on the evaluations
  // rather than leaving the reader on the map.
  // Exact: the experience screen also carries a "주민 평가 읽기 →" button.
  const evaluations = page.getByRole('button', { name: '주민 평가', exact: true });
  await expect(page.getByText('실행 중', { exact: true })).toHaveCount(0, { timeout: 180_000 });
  await expect(evaluations).toBeEnabled({ timeout: 180_000 });
  await evaluations.click();

  // Screen B: one resident, read in doc 20's order, with no score anywhere.
  await expect(page.getByText('평가 항목의 개수')).toBeVisible();
  await expect(page.getByText('1 · 이번에 무엇을 경험했나')).toBeVisible();
  await expect(page.getByText(/만족도\s*[0-9]/)).toHaveCount(0);
  await expect(page.getByText('help_resolution')).toHaveCount(0);
  await shot(page, 'evaluations');
  // The ordering caveat is one click from the ordering it is about.
  await expect(await hint(page, '읽는 순서')).toContainText('미경험과 제안 없음은 불만이 아니므로');
  await shot(page, 'evaluations-hint');
  await page.keyboard.press('Escape');

  // Evidence opens in place, and closing returns to the same item.
  const evidence = page.getByText(/사건 근거 [0-9]+건 보기/).first();
  if (await evidence.count()) {
    await evidence.click();
    await expect(page.getByText('그 장면 열기').first()).toBeVisible();
    await shot(page, 'evaluations-evidence');
  }

  await page.getByRole('button', { name: '개선과 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '무엇이 달라졌나요?' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('바꿀 운영 규칙')).toBeVisible({ timeout: 20_000 });
  // The composer edits *values*, through controls the server's rule catalogue
  // generated. There is no box for the rule sentence and none for a binding.
  await page.getByText('지원 규칙에서 직접 작성').click();
  await expect(page.getByText('어떤 규칙을 바꾸나요')).toBeVisible();
  await expect(page.getByText('바뀌기 전')).toBeVisible();
  await expect(page.getByText('내부 실행값 수정')).toHaveCount(0);
  await expect(await hint(page, '이유')).toContainText(
    '글로 적은 내용이 실행을 바꾸지 않습니다',
  );
  await shot(page, 'improve-composer');

  // Author a change whose sentence and run must agree: two retries.
  await page.getByLabel('바꿀 규칙', { exact: true }).selectOption('retry_before_help');
  await page.getByLabel('재연락 횟수', { exact: true }).fill('2');
  await page.getByLabel('수정안 이름', { exact: true }).fill('본인에게 두 번 더 확인');
  await page
    .getByLabel('변경을 시도하는 이유', { exact: true })
    .fill('이웃의 시간을 쓰기 전에 본인 확인 기회를 늘린다');
  await page.getByRole('button', { name: '수정안으로 저장 (실행하지 않음)', exact: true }).click();

  // Saving is not executing: still one version until a reason is recorded.
  await expect(page.getByText(/아직 실행되지 않았고/)).toBeVisible({ timeout: 20_000 });
  const confirm = page.getByRole('button', { name: '이유를 기록하고 수정안 실행', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('확정 이유', { exact: true })
    .fill('주민 평가에서 본인 확인 기회가 없다는 항목이 나왔다');
  await expect(confirm).toBeEnabled();
  // The draft about to run is the one just written, not whichever came first.
  await expect(page.getByText('고른 안: 본인에게 두 번 더 확인')).toBeVisible();
  await shot(page, 'improve-confirm');
  await confirm.click();

  // The comparison now has a pair, and says whether the changed rule ran.
  await expect(page.getByText('바뀐 규칙이 실행됐나')).toBeVisible({ timeout: 180_000 });
  // And it says which of the three questions was answered, about the rule that
  // actually ran - not a difference of zero with no explanation.
  await expect(
    page.getByText(/적용됨|적용 상황 없었음|판정 불가/).first(),
  ).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/본인에게 40분 간격으로 2회/).first()).toBeVisible();
  await expect(page.getByText('어느 하루였나')).toBeVisible();
  await expect(page.getByText('누가 거절했나')).toBeVisible();
  await expect(page.getByText('기록에 없던 것')).toBeVisible();
  await expect(page.getByText('persona_condition')).toHaveCount(0);
  await expect(page.getByText(/not_asked|help_contacts/)).toHaveCount(0);
  // Refusal codes are engine keys too, and the ride path puts them in the
  // field a sentence is read from (found in a capture, 2026-09-15).
  await expect(
    page.getByText(/driving_status_unknown|does_not_drive|asked_too_often|detour_too_long/),
  ).toHaveCount(0);
  await shot(page, 'improve-comparison');
  const applied = page.getByText('바뀐 규칙이 실행됐나');
  await applied.scrollIntoViewIfNeeded();
  await applied.locator('xpath=..').screenshot({ path: resolve(SHOTS, 'improve-applied.png') });
});

test('현장 기록: 공개 전 응답 없이는 공개도 비교도 할 수 없다', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  // Reuse whatever session the previous test left; the field sheet opens from
  // the improve screen once the loop has stopped.
  await page.getByRole('button', { name: '개선과 확인', exact: true }).click();
  const open = page.getByRole('button', { name: '현장에서 검토할 안 선택', exact: true });
  if (!(await open.count())) {
    const link = page.getByText('지금까지의 결정 기록 보기');
    await link.click();
  } else {
    await open.click();
  }
  await expect(page.getByRole('dialog', { name: '현장 검토 선택' })).toBeVisible();
  await page.getByLabel('현장 검토 결정 이유', { exact: true })
    .fill('이 장면을 실제 주민에게 물어본다');
  await page.getByRole('button', { name: '이 결정으로 기록', exact: true }).click();

  await expect(page.getByText('현장 기록 · 실제 응답')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('1단계 · 공개 전')).toBeVisible();
  // Scene titles used to end in the dimension key ("P6 · time_labour").
  await expect(
    page.getByRole('dialog').getByText(/time_labour|help_resolution|choice_refusal|reuse_condition/),
  ).toHaveCount(0);
  // Before an independent answer exists, there is nothing to disclose against.
  await expect(page.getByText('모의 평가를 보여 주었음을 기록')).toHaveCount(0);
  await page.getByLabel('응답자 가명 ID', { exact: true }).fill('R-01');
  await page.getByLabel('공개 전 응답 내용', { exact: true }).fill('직접 가 봤을 것 같다');
  await page.getByRole('button', { name: '공개 전 독립 응답으로 저장', exact: true }).click();

  const disclose = page.getByRole('button', { name: '모의 평가를 보여 주었음을 기록', exact: true });
  await expect(disclose).toBeVisible({ timeout: 30_000 });
  await shot(page, 'field-stage-1');
  await disclose.click();
  await expect(page.getByText('3단계 · 공개 후 비교')).toBeVisible({ timeout: 30_000 });
  // Explicit disagreement is sayable - the old form had only "일부 일치" - and
  // what should change is its own question.
  const compare = page.getByLabel('모의 평가와의 비교', { exact: true });
  await compare.selectOption('disagreement');
  await expect(compare).toHaveValue('disagreement');
  await page.getByLabel('고쳐야 할 것', { exact: true }).selectOption('behaviour_model');
  await page.getByLabel('공개 후 응답 내용', { exact: true }).fill('그 시간에는 그렇게 하지 않는다');
  await shot(page, 'field-stage-3');
  await page.getByRole('button', { name: '공개 후 응답으로 저장', exact: true }).click();
  // Both records are on file, in order, and the comparison one is marked as a
  // conflict rather than being folded into "일부 일치".
  await expect(page.getByText('공개 후').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/고칠 곳: 주민 행동 모델/)).toBeVisible();
});

test('세 화면이 1440·1366·800에서 가로로 넘치지 않는다', async ({ page }) => {
  test.setTimeout(120_000);
  // Not a stylesheet restatement: a screen that scrolls sideways hides half of
  // itself, and jsdom cannot see it. The widths are the ones doc 26 section 5
  // asks about; the loop's own data comes from whatever the earlier tests left.
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  // Every width below was checked in Pretendard. A build that stops shipping it
  // falls back silently and moves every line break, so the face is asserted.
  await page.evaluate(() => document.fonts.ready);
  const face = await page.evaluate(() => ({
    loaded: document.fonts.check('14px "Pretendard Variable"', '주민 평가'),
    family: getComputedStyle(document.querySelector('header')!).fontFamily,
  }));
  expect(face.loaded).toBe(true);
  expect(face.family).toMatch(/^"?Pretendard Variable/);
  for (const width of [1440, 1366, 800]) {
    await page.setViewportSize({ width, height: 900 });
    for (const screenName of ['사례와 서비스 경험', '주민 평가', '개선과 확인']) {
      const nav = page.getByRole('button', { name: screenName, exact: true });
      if (await nav.isDisabled()) continue;
      await nav.click();
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(
        overflow.scrollWidth,
        `${screenName} @ ${width}px: 가로 스크롤이 생겼다`,
      ).toBeLessThanOrEqual(overflow.innerWidth);
    }
    await page.screenshot({ path: resolve(SHOTS, `width-${width}.png`), fullPage: false });
  }
});

test('키보드만으로 세 화면과 평가 근거에 닿는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  // Wait for the workspace to load: a disabled screen name is not focusable,
  // and tabbing before the session is restored would be a different test.
  await expect(page.getByRole('button', { name: '개선과 확인', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  // Tab from the top: the three screen names are the first stops, in order.
  const reached: string[] = [];
  for (let i = 0; i < 12 && reached.length < 3; i += 1) {
    await page.keyboard.press('Tab');
    // Each screen name is prefixed by its step number (1, 2, 3).
    const label = await page.evaluate(
      () => (document.activeElement?.textContent ?? '').replace(/^\d/, ''),
    );
    if (['사례와 서비스 경험', '주민 평가', '개선과 확인'].includes(label)) reached.push(label);
  }
  expect(reached).toEqual(['사례와 서비스 경험', '주민 평가', '개선과 확인']);

  // Enter on a focused screen name navigates, and the evidence link inside an
  // evaluation is reachable and operable without a pointer.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '무엇이 달라졌나요?' })).toBeVisible();
  await page.getByRole('button', { name: '주민 평가', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '주민 평가' })).toBeVisible();
  const evidence = page.getByText(/사건 근거 [0-9]+건 보기/).first();
  if (await evidence.count()) {
    await evidence.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('그 장면 열기').first()).toBeVisible();
  }
});
