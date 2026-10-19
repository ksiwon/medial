import { expect, test, type Browser, type Page } from '@playwright/test';

// The week, walked by a wall and a tablet in a real browser against the real server:
// start -> the week -> an event -> its scenes -> the residents' evaluations -> a request -> what came of it -> the week.
// An emergency has no request: it ends in what the residents made of it.

const WALL = { width: 2560, height: 1440 };
const PAD = { width: 1180, height: 820 };

interface Screens { wall: Page; pad: Page; problems: string[]; close: () => Promise<void> }

async function open(browser: Browser, baseURL: string): Promise<Screens> {
  const problems: string[] = [];
  const wallContext = await browser.newContext({ viewport: WALL });
  const padContext = await browser.newContext({ viewport: PAD, hasTouch: true, isMobile: true });
  const wall = await wallContext.newPage();
  const pad = await padContext.newPage();
  for (const [name, page] of [['wall', wall], ['pad', pad]] as const) {
    page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name} console: ${m.text()}`); });
  }
  await wall.goto(`${baseURL}/?role=wall`);
  // The tablet is opened by the address the wall's QR code holds: the server's pairing token.
  const pairing = await (await wall.request.get(`${baseURL}/api/sim/stage/pairing`)).json() as { token: string };
  await pad.goto(`${baseURL}/?role=pad&t=${encodeURIComponent(pairing.token)}`);
  await pad.getByRole('button', { name: '연결하기' }).tap();
  await expect(pad.getByRole('button', { name: '시작하기' })).toBeVisible({ timeout: 30_000 });
  // The server pairs one wall and one tablet: a test closes its screens so the next one is not "replaced" by them.
  return { wall, pad, problems, close: async () => { await wallContext.close(); await padContext.close(); } };
}

const tap = (page: Page, name: string | RegExp) => page.getByRole('button', { name }).first().tap();
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/** Changes one event once (its first request): reads it through, chooses, and waits until the wall is at the week again. */
async function change({ wall, pad }: Screens, title: RegExp) {
  await tap(pad, title);
  await expect(pad.getByRole('button', { name: /넘기기/ })).toBeVisible();
  for (let i = 0; i < 12 && !(await pad.getByRole('button', { name: /주민 평가 →/ }).isVisible().catch(() => false)); i += 1) {
    await pad.getByRole('button', { name: /넘기기/ }).tap({ timeout: 3000 }).catch(() => {});
    await wall.waitForTimeout(400);
  }
  await tap(pad, /주민 평가 →/);
  await tap(pad, /수정 요청 고르기 →/);
  await pad.getByRole('button', { name: /^1/ }).tap();
  await tap(pad, /^돌리기$/);
  await expect(wall.getByLabel('이번 주')).toBeVisible({ timeout: 20_000 });
}

async function intoTheWeek({ wall, pad }: Screens) {
  await tap(pad, '시작하기');
  await expect(pad.getByRole('button', { name: /건너뛰기/ })).toBeVisible();
  await tap(pad, /건너뛰기/);
  await expect(wall.getByLabel('이번 주')).toBeVisible({ timeout: 20_000 });
  await expect(pad.getByLabel('조용한 날').first()).toBeVisible();
  // 처음으로는 묻는 창부터: 계속 보기를 누르면 그대로다.
  await tap(pad, /↺ 처음으로/);
  await expect(pad.getByRole('dialog', { name: '처음으로 돌아갈까요' })).toBeVisible();
  await tap(pad, /계속 보기/);
  await expect(pad.getByRole('dialog')).toHaveCount(0);
  await expect(wall.getByLabel('이번 주')).toBeVisible();
}

test('한 주를 걷는다: 사건 → 장면 → 평가 → 요청 → 새 버전, 다시 이번 주 · 5번 이상 고치면 마무리', async ({ browser, baseURL }) => {
  const s = await open(browser, baseURL!);
  const { wall, pad } = s;
  await intoTheWeek(s);
  expect(await noHorizontalScroll(wall)).toBe(true);
  // the tablet says in words where the closing opens, and shows no "read" mark
  await expect(pad.getByText(/5번 이상 고치면 마무리 장면으로 넘어갈 수 있어요/)).toBeVisible();
  await expect(pad.getByText(/읽음|✓/)).toHaveCount(0);

  // an event with a choice: Monday's
  await tap(pad, /연락이 안 되어 찾아보기/);
  await expect(pad.getByRole('button', { name: /다음 →/ })).toBeVisible();
  await expect(pad.getByText(/^ver1 ·/)).toBeVisible();
  await expect(wall.getByLabel(/09:40/)).toBeVisible();
  await tap(pad, '다음 →');
  await tap(pad, '넘기기 ⇥');
  // beside the scene: the village map and the AI's judgment panel
  await expect(wall.getByLabel('마을 지도')).toBeVisible();
  await expect(wall.getByLabel('AI의 판단')).toBeVisible();
  expect(await noHorizontalScroll(wall)).toBe(true);
  // the telling goes on by itself too; whichever way, it ends at the way on to the evaluations
  await expect(pad.getByRole('button', { name: /주민 평가 →/ })).toBeVisible({ timeout: 60_000 });
  await tap(pad, /주민 평가 →/);
  await expect(wall.getByLabel('주민이 겪은 일에 대해 한 말').first()).toBeVisible();
  await expect(wall.getByLabel('이 말이 근거로 든 대사')).toHaveCount(0);
  await expect(wall.getByText('시뮬레이션 주민의 평가').first()).toBeVisible();

  // the requests: each says what it hopes for and what it costs
  await tap(pad, /수정 요청 고르기 →/);
  await expect(wall.getByText('바라는 것').first()).toBeVisible();
  await expect(wall.getByText('따를 부담').first()).toBeVisible();
  // the way back is the residents' words, and from there on to the requests again
  await tap(pad, /← 주민 평가/);
  await expect(wall.getByLabel('주민 평가')).toBeVisible();
  await tap(pad, /수정 요청 고르기 →/);
  await expect(wall.getByText('바라는 것').first()).toBeVisible();
  expect(await noHorizontalScroll(wall)).toBe(true);

  // a touch picks and asks, "돌리기" chooses; the wall makes the new simulation for a few seconds, then the week
  await pad.getByRole('button', { name: /^1/ }).tap();
  await tap(pad, /^돌리기$/);
  await expect(wall.getByText('새로운 시뮬레이션을 만들고 있습니다')).toBeVisible();
  await expect(wall.getByLabel('이번 주')).toBeVisible({ timeout: 20_000 });
  // the event is one version on: a small chip on its card and on the tablet's button, nothing shown straight away
  await expect(wall.getByLabel('ver2')).toBeVisible();
  await expect(pad.getByText('v2')).toBeVisible();
  await expect(pad.getByText(/고친 횟수 1/)).toBeVisible();
  await expect(pad.getByRole('button', { name: /마무리 장면 보기/ })).toBeDisabled();

  // opened again, it is read as ver2; this version offers one request of its own, and the one it makes (ver3) offers none
  await tap(pad, /연락이 안 되어 찾아보기/);
  await expect(pad.getByText(/^ver2 ·/)).toBeVisible();
  await tap(pad, /넘기기/);
  await expect(pad.getByRole('button', { name: /주민 평가 →/ })).toBeVisible({ timeout: 60_000 });
  await tap(pad, /주민 평가 →/);
  await expect(wall.getByText(/ver1에서 바뀐 규칙/)).toBeVisible();
  await tap(pad, /수정 요청 고르기 →/);
  await pad.getByRole('button', { name: /^1/ }).tap();
  await tap(pad, /^돌리기$/);
  await expect(wall.getByLabel('이번 주')).toBeVisible({ timeout: 20_000 });
  await expect(wall.getByLabel('ver3')).toBeVisible();
  await expect(pad.getByText(/고친 횟수 2/)).toBeVisible();
  await tap(pad, /연락이 안 되어 찾아보기/);
  await expect(pad.getByText(/^ver3 ·/)).toBeVisible();
  await tap(pad, /넘기기/);
  await expect(pad.getByRole('button', { name: /주민 평가 →/ })).toBeVisible({ timeout: 60_000 });
  await tap(pad, /주민 평가 →/);
  await expect(wall.getByText('이 사건은 여기까지입니다. 다른 사건을 개선해 보세요.')).toBeVisible();
  await expect(pad.getByRole('button', { name: /수정 요청 고르기 →/ })).toHaveCount(0);
  await tap(pad, /이번 주로 →/);
  await expect(wall.getByLabel('이번 주')).toBeVisible();

  // three more changes (each event once), and the fifth opens the closing; before that it is not offered
  await change(s, /병원 태워다 주고 데려오기/);
  await change(s, /낙상 후 못 일어남/);
  await expect(pad.getByRole('button', { name: /마무리 장면 보기/ })).toBeDisabled();
  await change(s, /보건소장의 안내 전달/);
  await expect(pad.getByText(/고친 횟수 5/)).toBeVisible();
  await tap(pad, /마무리 장면 보기/);
  await expect(wall.getByLabel('마무리')).toBeVisible();
  await expect(wall.getByText(/개의 사건을 5번 고쳤습니다/)).toBeVisible();
  // the way back is not offered until the closing words have been heard
  await expect(pad.getByRole('button', { name: '처음으로', exact: true })).toHaveCount(0);
  await tap(pad, /마무리 말/);
  await expect(wall.getByText('서비스 디자이너의 일은 초안을 고쳐 나가는 일입니다.')).toBeVisible({ timeout: 10_000 });
  await expect(pad.getByRole('button', { name: '처음으로', exact: true })).toBeVisible();

  expect(s.problems).toEqual([]);
  await s.close();
});

test('응급 사건은 고르지 않는다: 요청 없이 주민이 겪은 일로 끝난다', async ({ browser, baseURL }) => {
  const s = await open(browser, baseURL!);
  const { wall, pad } = s;
  await intoTheWeek(s);
  await expect(pad.getByText('응급', { exact: true })).toBeVisible();

  await tap(pad, /119 구급 상황/);
  await expect(pad.getByRole('button', { name: /주민 평가 →/ })).toBeVisible({ timeout: 90_000 });
  await tap(pad, /주민 평가 →/);
  // nothing to choose: only the way back to the week is on the tablet, and the wall says why
  await expect(pad.getByRole('button', { name: /수정 요청 고르기 →/ })).toHaveCount(0);
  await expect(wall.getByText(/일어난 일을 읽습니다/)).toBeVisible();
  await expect(wall.getByText('바라는 것')).toHaveCount(0);
  await tap(pad, /이번 주로 →/);
  await expect(wall.getByLabel('이번 주')).toBeVisible();
  // an emergency is read, not changed: it is still ver1 and counts for no change
  await expect(pad.getByText(/고친 횟수 0/)).toBeVisible();

  expect(s.problems).toEqual([]);
  await s.close();
});

test('태블릿 없이는 걷지 못한다: 코드 없는 누름과 쓰기는 거절된다', async ({ browser, baseURL }) => {
  const s = await open(browser, baseURL!);
  const { wall } = s;
  const refused = await wall.request.post(`${baseURL}/api/sim/stage/command?token=wrong`, { data: { name: 'start' } });
  expect(refused.status()).toBe(403);
  const writes = await wall.request.post(`${baseURL}/api/sim/attempts`, { data: {} });
  expect(writes.status()).toBe(403);
  await s.close();
});
