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

async function intoTheWeek({ wall, pad }: Screens) {
  await tap(pad, '시작하기');
  await expect(pad.getByRole('button', { name: /건너뛰기/ })).toBeVisible();
  await tap(pad, /건너뛰기/);
  await expect(wall.getByLabel('이번 주')).toBeVisible({ timeout: 20_000 });
  await expect(pad.getByText('이날은 조용했습니다').first()).toBeVisible();
}

test('한 주를 걷는다: 사건 → 장면 → 평가 → 요청 → 반영된 결과 → 다시 이번 주', async ({ browser, baseURL }) => {
  const s = await open(browser, baseURL!);
  const { wall, pad } = s;
  await intoTheWeek(s);
  expect(await noHorizontalScroll(wall)).toBe(true);

  // an event with a choice: Monday's
  await tap(pad, /연락이 안 되어 찾아보기/);
  await expect(pad.getByRole('button', { name: /다음 줄/ })).toBeVisible();
  await expect(wall.getByLabel(/09:40/)).toBeVisible();
  await tap(pad, '다음 줄');
  await tap(pad, '장면 넘기기 ⇥');
  // beside the scene: the village map and the AI's judgment panel
  await expect(wall.getByLabel('마을 지도')).toBeVisible();
  await expect(wall.getByLabel('AI의 판단')).toBeVisible();
  // the telling goes on by itself too; whichever way, it ends at the way on to the evaluations
  await expect(pad.getByRole('button', { name: /주민 평가 보기/ })).toBeVisible({ timeout: 60_000 });
  await tap(pad, /주민 평가 보기/);
  await expect(wall.getByLabel('주민이 겪은 일에 대해 한 말').first()).toBeVisible();
  await expect(wall.getByLabel('이 말이 근거로 든 대사').first()).toBeVisible();
  await expect(wall.getByText('시뮬레이션 주민의 평가').first()).toBeVisible();

  // one resident's card
  await tap(pad, /한상덕/);
  await expect(pad.getByRole('button', { name: /목록으로/ })).toBeVisible();
  await tap(pad, /목록으로/);

  // the requests: each says what it hopes for and what it costs
  await tap(pad, /무엇을 고칠지 고르기/);
  await expect(wall.getByText('바라는 것').first()).toBeVisible();
  await expect(wall.getByText('따를 부담').first()).toBeVisible();
  await expect(wall.getByText(/의 평가에서/).first()).toBeVisible();
  expect(await noHorizontalScroll(wall)).toBe(true);

  // a touch picks, the confirm chooses
  await pad.locator('button', { hasText: /바라는 것/ }).first().tap();
  await tap(pad, /1번 요청으로 다시 보기/);
  await expect(pad.getByRole('button', { name: /반영된 평가 보기/ })).toBeVisible({ timeout: 60_000 });
  await tap(pad, /반영된 평가 보기/);
  await expect(wall.getByText('이 결정이 이렇게 반영되었습니다')).toBeVisible();
  await expect(wall.getByText('수정 전').first()).toBeVisible();
  await expect(wall.getByText('반영 후').first()).toBeVisible();

  // back to the week: it remembers what was read
  await tap(pad, /이번 주로/);
  await expect(wall.getByLabel('이번 주')).toBeVisible();
  await expect(pad.getByText(/1 \/ 8개 봤어요/)).toBeVisible();
  await expect(pad.getByText('읽음')).toBeVisible();

  // and the visitor can finish: what was changed, then the closing words
  await tap(pad, /마치기/);
  await expect(wall.getByLabel('마무리')).toBeVisible();
  await expect(wall.getByText(/개의 사건을 읽고, 이렇게 고쳤습니다/)).toBeVisible();
  await tap(pad, /마무리 말 듣기/);
  await expect(wall.getByText('서비스 디자이너의 일은 초안을 고쳐 나가는 일입니다.')).toBeVisible({ timeout: 10_000 });

  expect(s.problems).toEqual([]);
  await s.close();
});

test('응급 사건은 고르지 않는다: 요청 없이 주민이 겪은 일로 끝난다', async ({ browser, baseURL }) => {
  const s = await open(browser, baseURL!);
  const { wall, pad } = s;
  await intoTheWeek(s);
  await expect(pad.getByText('응급 · 읽기만')).toBeVisible();

  await tap(pad, /119 구급 상황/);
  await expect(pad.getByRole('button', { name: /주민 평가 보기/ })).toBeVisible({ timeout: 90_000 });
  await tap(pad, /주민 평가 보기/);
  await expect(pad.getByRole('button', { name: /다 읽었어요/ })).toBeVisible();
  await expect(pad.getByRole('button', { name: /무엇을 고칠지 고르기/ })).toHaveCount(0);
  await tap(pad, /다 읽었어요/);
  await expect(wall.getByText('주민들이 겪은 일')).toBeVisible();
  await expect(wall.getByText(/규칙을 바꾸는 선택지는 두지 않았습니다/)).toBeVisible();
  await expect(wall.getByText('바라는 것')).toHaveCount(0);

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
