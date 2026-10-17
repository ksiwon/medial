// 두 화면을 일부러 괴롭혀서 어긋나는지 본다.  node scripts/stress_two_screens.cjs [웹주소]
// 서버(run-exhibition)가 떠 있어야 한다. 기록은 읽기만 한다. 실패가 하나라도 있으면 종료 코드 1.
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:5180';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, name, detail = '') => { results.push(ok); console.log(ok ? '  ok  ' : '  FAIL', name, ok ? '' : detail); };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wallCtx = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  const padCtx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
  const wall = await wallCtx.newPage();
  const pad = await padCtx.newPage();
  const errors = [];
  for (const [n, p] of [['wall', wall], ['pad', pad]]) {
    p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  }

  await wall.goto(`${BASE}/?role=wall`);
  const pairing = await (await fetch(`${BASE}/api/sim/stage/pairing`)).json();
  const padUrl = `${BASE.replace('localhost', pairing.addresses[0])}/?role=pad&t=${encodeURIComponent(pairing.token)}`;
  await pad.goto(padUrl);
  await pad.getByRole('button', { name: '연결하기' }).tap();
  await pad.getByRole('button', { name: '시작하기' }).waitFor({ timeout: 20000 });

  // 소개를 건너뛰어 이번 주로, 거기서 첫 사건을 연다. 이야기는 혼자 흘러서 느린 시험에서는 벌써 끝나
  // "주민 평가 보기" 가 나와 있을 수 있다.
  const enterEvent = async () => {
    await pad.getByRole('button', { name: '시작하기' }).tap();
    await pad.getByRole('button', { name: /건너뛰기/ }).waitFor();
    await pad.getByRole('button', { name: /건너뛰기/ }).tap();
    await pad.getByRole('button', { name: /연락이 안 되어 찾아보기/ }).tap({ timeout: 20000 });
    await pad.getByRole('button', { name: /다음 장면으로|주민 평가 보기/ }).first().waitFor({ timeout: 30000 });
  };

  // 어디까지 걸어갔든 처음으로 돌아가 알려진 자리에서 시작한다 (처음으로 는 두 번 눌러야 한다).
  const startOver = async () => {
    const home = pad.getByRole('button', { name: /처음으로/ }).first();
    if (await home.count()) { await home.tap(); await home.tap(); }
    await pad.getByRole('button', { name: '시작하기' }).waitFor({ timeout: 20000 });
  };

  console.log('· 모니터를 새로고침해도 태블릿이 같은 화면을 다시 받는다');
  await enterEvent();
  await wall.reload();
  await wall.getByLabel('AI 대기 화면').waitFor({ timeout: 20000 }).catch(() => {});
  // 새 모니터 화면은 기록을 처음부터 시작한다: 태블릿은 그것을 따라가야 하고 낡은 화면을 들고 있으면 안 된다
  await pad.getByRole('button', { name: '시작하기' }).waitFor({ timeout: 20000 });
  check(true, '모니터 새로고침 뒤 태블릿이 낡은 장면 화면을 들고 있지 않다');

  console.log('· 한 모니터만 일한다: 모니터 화면을 두 개 열어도 눌림이 두 번 처리되지 않는다');
  const second = await wallCtx.newPage();
  await second.goto(`${BASE}/?role=wall`);
  await wait(1500);
  await pad.getByRole('button', { name: '시작하기' }).tap();
  await wait(1500);
  const intro1 = await wall.getByLabel('소개').count();
  const intro2 = await second.getByLabel('소개').count();
  check(intro1 + intro2 === 1, '눌림은 한 모니터에서만 일어난다', `wall1=${intro1} wall2=${intro2}`);
  await (intro1 ? second : wall).close().catch(() => {});

  console.log('· 서버와의 연결이 끊기면 태블릿이 알아채고, 돌아오면 같은 화면에서 이어진다');
  // 이미 열린 스트림은 Playwright의 오프라인이 끊지 않으므로, 이 태블릿의 스트림 요청만 막고 스트림을 새로 열게 한다.
  let blocked = true;
  await padCtx.route('**/api/sim/stage/events**', (route) => (blocked ? route.abort('connectionfailed') : route.continue()));
  await pad.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await pad.getByText(/큰 화면과의 연결이 끊겼습니다/).waitFor({ timeout: 20000 });
  check(true, '끊기면 태블릿이 "끊겼습니다"라고 말한다');
  blocked = false;
  await pad.getByText(/큰 화면과의 연결이 끊겼습니다/).waitFor({ state: 'hidden', timeout: 30000 });
  check(true, '돌아오면 알림이 사라진다');
  check((await pad.getByRole('button', { name: /다음 장면|건너뛰기|시작하기|평가 보기/ }).count()) > 0, '그리고 같은 화면에서 이어진다');

  console.log('· 빠른 연타에도 순서가 지켜진다');
  await startOver();
  await enterEvent();
  await pad.getByRole('button', { name: /다음 장면으로|주민 평가 보기/ }).first().waitFor({ timeout: 30000 });
  for (let i = 0; i < 6; i += 1) await pad.getByRole('button', { name: /다음 장면으로/ }).tap({ timeout: 1500 }).catch(() => {});
  await wait(2000);
  check(errors.length === 0, '연타 뒤에도 페이지 오류가 없다', errors.join('; '));

  console.log('· 지나간 화면의 눌림은 버려진다 (평가 화면에서 낡은 "고르기"를 보내도 아무것도 안 일어난다)');
  // 어디까지 걸어갔든(연타로 이야기가 끝나 자동으로 넘어갔을 수 있다) 처음으로 돌아가 알려진 자리에서 시작한다.
  const homeBtn = pad.getByRole('button', { name: /처음으로/ }).first();
  await homeBtn.tap(); await homeBtn.tap();
  await pad.getByRole('button', { name: '시작하기' }).waitFor({ timeout: 20000 });
  await enterEvent();
  for (let i = 0; i < 12 && !(await pad.getByRole('button', { name: /주민 평가 보기/ }).isVisible().catch(() => false)); i += 1) {
    await pad.getByRole('button', { name: '다음 장면으로 →' }).tap({ timeout: 3000 }).catch(() => {});
    await wait(600);
  }
  await pad.getByRole('button', { name: /주민 평가 보기/ }).tap({ timeout: 30000 });
  await pad.getByText(/이 일을 겪은 주민/).waitFor({ timeout: 30000 });
  await wall.getByText('서비스를 겪은 주민의 말').waitFor({ timeout: 15000 });
  const stale = await fetch(`${BASE}/api/sim/stage/command?token=${encodeURIComponent(pairing.token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'choose', id: 'nope' }),
  });
  await wait(1200);
  check(stale.ok && (await wall.getByText('서비스를 겪은 주민의 말').count()) === 1, '낡은 choose가 평가 화면을 건드리지 않는다');

  console.log('· 토큰이 없는 눌림은 거절된다');
  const noToken = await fetch(`${BASE}/api/sim/stage/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'home' }),
  });
  check(noToken.status === 403, '토큰 없이 처음으로를 보내도 403', `status=${noToken.status}`);
  check((await wall.getByText('서비스를 겪은 주민의 말').count()) === 1, '그래서 모니터는 그대로다');

  check(errors.length === 0, '두 화면 어디에도 페이지 오류가 없다', errors.join('; '));
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
