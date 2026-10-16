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

test('태블릿으로 걷는다: 시작 → 1일차 → 평가(한 사람의 인터뷰) → 수정 요청 고르기', async ({ browser }) => {
  test.setTimeout(300_000);
  const base = `http://localhost:5174`;
  const wallCtx = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  const padCtx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
  const wall = await wallCtx.newPage();
  const pad = await padCtx.newPage();
  await wall.goto(`${base}/?role=wall`);

  // Pairing: the wall shows a code to scan; the tablet opens the address it carries and presses connect.
  await expect(wall.getByLabel('태블릿 연결')).toBeVisible();
  const pairing = await (await wall.request.get(`${base}/api/sim/stage/pairing`)).json();
  expect(pairing.token.length).toBeGreaterThan(8);
  await pad.goto(`http://localhost:5174/?role=pad&t=${encodeURIComponent(pairing.token)}`);
  await expect(wall.getByLabel('태블릿 연결')).toBeVisible();   // not paired until the tablet says so
  await pad.getByRole('button', { name: '연결하기' }).tap();

  // Waiting: the wall asks for the tablet to start, and has nothing to press.
  await expect(wall.getByText(/태블릿에서 시작하기/)).toBeVisible();
  await expect(pad.getByRole('button', { name: '시작하기' })).toBeVisible({ timeout: 30_000 });
  await pad.getByRole('button', { name: '시작하기' }).tap();
  await expect(wall.getByLabel('MEDial 소개')).toBeVisible();
  await expect(wall.getByRole('button')).toHaveCount(0);

  // The tablet skips the film; day one opens and plays on the wall.
  await pad.getByRole('button', { name: /건너뛰기/ }).tap();
  await expect(wall.getByLabel('오늘의 타임라인')).toBeVisible({ timeout: 30_000 });
  await expect(pad.getByRole('button', { name: '다음 장면으로 →' })).toBeVisible();
  await expect(pad.getByRole('button', { name: '이 대화 건너뛰기' })).toBeVisible();
  // The day has two things to press and nothing else: no play, pause or clock to steer.
  await expect(pad.getByRole('button', { name: /재생|정지/ })).toHaveCount(0);
  await expect(pad.locator('input[type=range]')).toHaveCount(0);
  await expect(wall.getByRole('button')).toHaveCount(0);

  // Skipping scenes from the tablet moves the wall's day on until it ends by itself.
  for (let i = 0; i < 8 && !(await pad.getByRole('button', { name: /평가 보기/ }).isVisible().catch(() => false)); i += 1) {
    await pad.getByRole('button', { name: '다음 장면으로 →' }).tap({ timeout: 3000 }).catch(() => {});
    await pad.waitForTimeout(600);
  }

  // To the evaluations, from the tablet.
  await pad.getByRole('button', { name: /평가 보기/ }).tap();
  await expect(wall.getByText('서비스를 겪고 평가한 주민')).toBeVisible();
  await expect(wall.getByText('합성 평가입니다', { exact: false })).toBeVisible();
  await expect(wall.getByText(/만족도\s*[0-9]/)).toHaveCount(0);
  const cards = await wall.locator('article').count();
  expect(cards).toBeGreaterThan(0);

  // One resident on the tablet: the wall shows that person's whole interview, and the cards come back.
  await expect(pad.getByText(/평가를 남긴 주민/)).toBeVisible();   // the tablet follows the wall: its list is up
  const person = pad.locator('main button').first();
  const name = (await person.innerText()).split('\n')[0];
  await person.tap();
  await expect(wall.getByRole('heading', { name: `${name}의 인터뷰` })).toBeVisible();
  await expect(wall.locator('article')).toHaveCount(1);
  await pad.getByRole('button', { name: /목록으로/ }).tap();
  await expect(wall.locator('article')).toHaveCount(cards);

  // Then the revision to choose: read on the wall, chosen on the tablet with one touch.
  await pad.getByRole('button', { name: /고칠지 고르기|결과 보러/ }).tap();
  await expect(wall.getByRole('heading', { name: '무엇을 고칠 것인가' })).toBeVisible();
  await expect(wall.getByRole('button')).toHaveCount(0);
  await expect(wall.getByText('화면 속 사람과 대화는 전부 시뮬레이션입니다')).toBeVisible();
  const first = pad.locator('main button:not([disabled])').first();
  await expect(first).toBeVisible();
  await first.tap();
  await expect(wall.getByText('2일차').first()).toBeVisible({ timeout: 30_000 });

  await wallCtx.close();
  await padCtx.close();
});

test('모니터는 2560 · 1440에서 가로로 넘치지 않고, 태블릿은 1180 · 1024에서 넘치지 않는다', async ({ page }) => {
  for (const [role, width, height] of [['wall', 2560, 1440], ['wall', 1440, 900], ['pad', 1180, 820], ['pad', 1024, 768]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/?role=${role}`);
    await expect(role === 'wall' ? page.getByText(/태블릿을 연결해 주세요|불러오는 중/) : page.getByText('QR 코드를 스캔해 주세요')).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${role} ${width}px`).toBeLessThanOrEqual(0);
  }
});
