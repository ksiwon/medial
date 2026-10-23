// 두 화면(모니터 + 태블릿)으로 한 사건의 버전 흐름을 걷고 단계마다 캡처한다.
//   node scripts/capture_week.cjs [웹주소] [출력폴더] [사건id=E1] [요청id(쓰지 않음)] [close]
// 사건 하나: 장면 → 주민의 피드백 → 요청 고르기 → 돌리기(생성 중) → 한 주(그 사건에 v2 칩) → 다시 열기(ver2 장면·평가).
// `close` 를 주면 이어서 다른 사건 넷을 한 번씩 고쳐 5번을 채우고 마무리 장면까지 찍는다.
// 실행 중인 sim 서버(run-exhibition)가 필요하다. 기록은 읽기만 한다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5180';
const OUT = process.argv[3] || path.join(__dirname, '..', '.run', 'week');
const EVENT = process.argv[4] || 'E1';
const CLOSE = process.argv[6] === 'close';
fs.mkdirSync(OUT, { recursive: true });

// 모니터 크기는 MEDIAL_WALL=1440x900 처럼 바꿀 수 있다(노트북 창 점검).
const [WALL_W, WALL_H] = (process.env.MEDIAL_WALL || '2560x1440').split('x').map(Number);
const WALL = { width: WALL_W, height: WALL_H };
const PAD = { width: 1180, height: 820 }; // iPad Air (4세대) 가로

async function main() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wall = await (await browser.newContext({ viewport: WALL })).newPage();
  const pad = await (await browser.newContext({ viewport: PAD, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage();
  const problems = [];
  for (const [name, page] of [['wall', wall], ['pad', pad]]) {
    page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name} console: ${m.text()}`); });
  }
  const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('shot', name); };
  const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
  const tap = async (page, text, opts = {}) => {
    const el = page.getByRole('button', { name: text }).first();
    await el.waitFor({ state: 'visible', timeout: 20000 });
    await el.tap(opts);
  };
  const titles = (await (await fetch(`${BASE}/api/sim/week`)).json()).events;
  const titleOf = (id) => titles.find((e) => e.id === id).title;
  /** 장면을 끝까지 넘겨 "주민의 피드백 →" 가 보일 때까지. */
  const skipTelling = async () => {
    for (let i = 0; i < 14 && !(await pad.getByRole('button', { name: /주민의 피드백 →/ }).isVisible().catch(() => false)); i += 1) {
      await pad.getByRole('button', { name: /넘기기/ }).tap({ timeout: 3000 }).catch(() => {});
      await settle(450);
    }
  };

  await wall.goto(`${BASE}/?role=wall`);
  const pairing = await (await fetch(`${BASE}/api/sim/stage/pairing`)).json();
  const port = new URL(BASE).port;
  await pad.goto(`http://${pairing.addresses[0]}:${port}/?role=pad&t=${encodeURIComponent(pairing.token)}`);
  await pad.getByRole('button', { name: '연결하기' }).tap();
  await pad.getByText('시작하기').waitFor({ timeout: 30000 });
  await settle(1500);
  await shot(wall, '01-wall-idle'); await shot(pad, '01-pad-idle');

  await tap(pad, '시작하기'); await settle(2500);
  await shot(wall, '02-wall-intro');
  await tap(pad, '건너뛰기');
  await wall.getByLabel('AI 조율자 초안').waitFor({ state: 'visible', timeout: 40000 }); await settle(1800);
  await shot(wall, '03a-wall-draft'); await shot(pad, '03a-pad-draft');
  await tap(pad, /이번 주로 →/); await settle(1500);
  await shot(wall, '03-wall-week'); await shot(pad, '03-pad-week');

  // ---- ver1: 사건 하나를 연다 (태블릿에서 그 사건의 제목이 든 버튼)
  await tap(pad, new RegExp(titleOf(EVENT))); await settle(2500);
  await shot(wall, '04-wall-scene-1'); await shot(pad, '04-pad-scene');
  for (let i = 0; i < 3; i += 1) { await tap(pad, '다음 →'); await settle(500); await shot(wall, `04b-wall-line-${i}`); }
  await shot(wall, '05-wall-scene-2');
  await skipTelling();
  await shot(wall, '06-wall-scene-end');
  await tap(pad, /주민의 피드백 →/); await settle(1500);
  await shot(wall, '07-wall-evaluations'); await shot(pad, '07-pad-evaluations');

  const emergency = !(await pad.getByRole('button', { name: /수정 요청 고르기 →/ }).isVisible().catch(() => false));
  if (!emergency) {
    await tap(pad, /수정 요청 고르기 →/); await settle(1500);
    await shot(wall, '08-wall-choose'); await shot(pad, '08-pad-choose');
    // 손가락이 번호를 누르면 모니터에 켜지고, 태블릿이 반영할지 묻는다. "돌리기" 가 고른다.
    await pad.getByRole('button', { name: /^1/ }).tap();
    await settle(1200);
    await shot(wall, '08b-wall-considering'); await shot(pad, '08b-pad-asking');
    await tap(pad, /^돌리기$/);
    await settle(1200);
    await shot(wall, '08c-wall-generating'); await shot(pad, '08c-pad-generating');
    // 기다림이 끝나면 한 주로 돌아오고, 그 사건 카드에 v2 칩이 붙는다.
    await wall.getByLabel('ver2').waitFor({ state: 'visible', timeout: 20000 });
    await settle(1000);
    await shot(wall, '11-wall-week-again'); await shot(pad, '11-pad-week-again');
    // ---- ver2: 칩이 붙은 사건을 다시 연다
    await tap(pad, new RegExp(titleOf(EVENT))); await settle(2500);
    await shot(wall, '12-wall-v2-scene'); await shot(pad, '12-pad-v2-scene');
    await skipTelling();
    await tap(pad, /주민의 피드백 →/); await settle(1500);
    await shot(wall, '13-wall-v2-evaluations'); await shot(pad, '13-pad-v2-evaluations');
    // ver2 가 요청을 가졌으면(E1 · E4 · E5) 한 번 더 고른다: ver3.
    if (await pad.getByRole('button', { name: /수정 요청 고르기 →/ }).isVisible().catch(() => false)) {
      await tap(pad, /수정 요청 고르기 →/); await settle(1500);
      await shot(wall, '13b-wall-v3-choose'); await shot(pad, '13b-pad-v3-choose');
      await pad.getByRole('button', { name: /^1/ }).tap(); await settle(800);
      await tap(pad, /^돌리기$/); await settle(1200);
      await wall.getByLabel('ver3').waitFor({ state: 'visible', timeout: 20000 });
      await settle(1000);
      await shot(wall, '13c-wall-week-v3'); await shot(pad, '13c-pad-week-v3');
      await tap(pad, new RegExp(titleOf(EVENT))); await settle(2500);
      await shot(wall, '13d-wall-v3-scene');
      await skipTelling();
      await tap(pad, /주민의 피드백 →/); await settle(1500);
      await shot(wall, '13e-wall-v3-evaluations'); await shot(pad, '13e-pad-v3-evaluations');
    }
    await tap(pad, /이번 주로 →/); await settle(1200);
  } else {
    await tap(pad, /이번 주로 →/); await settle(1200);
    await shot(wall, '11-wall-week-again'); await shot(pad, '11-pad-week-again');
  }

  if (CLOSE) {
    // 마무리는 5번 고친 뒤에 열린다: 이 사건 하나에 다른 사건 넷을 한 번씩 더한다.
    for (const more of ['E3', 'E4', 'E2', 'E5']) {
      await tap(pad, new RegExp(titleOf(more))); await settle(1500);
      await skipTelling();
      await tap(pad, /주민의 피드백 →/); await tap(pad, /수정 요청 고르기 →/); await settle(800);
      await pad.getByRole('button', { name: /^1/ }).tap(); await tap(pad, /^돌리기$/);
      await wall.getByLabel('이번 주').waitFor({ state: 'visible', timeout: 20000 });
      await settle(800);
    }
    await shot(wall, '14-wall-week-five'); await shot(pad, '14-pad-week-five');
    await tap(pad, /마무리 장면 보기/); await settle(2500);
    await shot(wall, '15-wall-closing'); await shot(pad, '15-pad-closing');
    await tap(pad, /마무리 말/); await settle(20000);
    await shot(wall, '16-wall-closing-words'); await shot(pad, '16-pad-closing-words');
  }
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no console errors');
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
