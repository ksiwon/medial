import { expect, test, type APIRequestContext } from '@playwright/test';

// The walk, in a real browser against the real server and the synthetic village:
// opening film -> day one -> the day's evaluations -> the revision to choose.
//
// The screens only read a stored record, so the record is made here first, the
// way the server's own tests make one - through its API, with the rule adapters
// and no key (nothing in this run calls a model). The interface no longer starts
// runs; this is the one place that does, to have something to read.

const API = 'http://127.0.0.1:8011/api/sim';

async function makeRecord(request: APIRequestContext): Promise<void> {
  const catalog = await (await request.get(`${API}/catalog`)).json();
  const capabilities = await (await request.get(`${API}/iteration/capabilities`)).json();
  const runnable = (catalog.decks as { id: string }[]).filter((d) =>
    (capabilities.decks as { id: string }[]).some((row) => row.id === d.id));
  const day = runnable.filter((d) =>
    ((capabilities.decks as { id: string; questIds?: string[] }[]).find((row) => row.id === d.id)?.questIds?.length ?? 0) > 1);
  const decks = (day.length ? day : runnable).map((d) => d.id);
  const resource = (catalog.resourceSets as { id: string }[]).find((r) => r.id.includes('transport'))
    ?? (catalog.resourceSets as { id: string }[])[0];

  const created = await request.post(`${API}/iteration/sessions`, {
    data: {
      label: 'e2e',
      coreItem: '응답이 없거나 이동이 필요할 때 누구의 시간으로 해결할 것인가',
      basePolicyId: 'policy-IT-v0',
      developmentDeckRefs: decks,
      resourceRevisionId: resource.id,
      maxGenerations: 2,
      maxChangeSetsPerGeneration: 2,
      callBudget: 0,
      behaviourAdapter: 'rule',
      institutionAdapter: 'rule',
      reviewAdapter: 'rule',
      improvementAdapter: 'rule',
    },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).session.id as string;
  const started = await request.post(`${API}/iteration/sessions/${id}/commands`, {
    data: { commandId: `e2e-start-${Date.now()}`, name: 'start', payload: {} },
  });
  expect(started.ok()).toBeTruthy();
  await expect.poll(async () => {
    const detail = await (await request.get(`${API}/iteration/sessions/${id}`)).json();
    return !detail.running && (detail.generations[0]?.reviews?.length ?? 0) > 0;
  }, { timeout: 120_000, intervals: [1000] }).toBe(true);
}

test.beforeAll(async ({ request }) => {
  await makeRecord(request);
});

test('소개 → 1일차 → 주민 평가 → 수정안 고르기를 걷는다', async ({ page }) => {
  // The film is about fifty seconds and nothing in it can be pressed.
  test.setTimeout(300_000);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByLabel('MEDial 소개')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);

  // The film ends by opening day one, which plays by itself.
  await expect(page.getByRole('button', { name: '↺ 처음으로' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: /정지|재생/ })).toBeVisible();
  await page.getByRole('button', { name: '빠르게' }).click();

  // At the day's end the evaluations are one press away.
  const toEvaluations = page.getByRole('button', { name: /주민 평가/ }).first();
  await expect(toEvaluations).toBeVisible({ timeout: 240_000 });
  await toEvaluations.click();

  // Only residents who went through the day, in their own words; no score.
  await expect(page.getByText('서비스를 겪고 평가한 주민')).toBeVisible();
  await expect(page.getByText('합성 평가입니다', { exact: false })).toBeVisible();
  await expect(page.getByText(/만족도\s*[0-9]/)).toHaveCount(0);
  await expect(page.getByText('미경험')).toHaveCount(0);
  await expect(page.locator('article').first()).toBeVisible();

  // Then the revision to choose; a revision that was never run cannot be chosen.
  await page.getByRole('button', { name: /이 평가를 보고 무엇을 고칠지/ }).click();
  await expect(page.getByRole('heading', { name: '무엇을 고칠 것인가' })).toBeVisible();
  await expect(page.getByText('화면 속 사람과 대화는 전부 시뮬레이션입니다')).toBeVisible();
});

test('1440 · 1366 · 800에서 가로로 넘치지 않는다', async ({ page }) => {
  for (const width of [1440, 1366, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByLabel('MEDial 소개')).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${width}px`).toBeLessThanOrEqual(0);
  }
});
