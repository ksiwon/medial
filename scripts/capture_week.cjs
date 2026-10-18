// 두 화면(모니터 + 태블릿)으로 한 주의 흐름을 걷고 단계마다 캡처한다.
//   node scripts/capture_week.cjs [웹주소] [출력폴더] [사건id=E1] [요청id=A]
// 실행 중인 sim 서버(run-sim)가 필요하다. 기록은 읽기만 한다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5180';
const OUT = process.argv[3] || path.join(__dirname, '..', '.run', 'week');
const EVENT = process.argv[4] || 'E1';
const REQUEST = process.argv[5] || 'A';
fs.mkdirSync(OUT, { recursive: true });

const WALL = { width: 2560, height: 1440 };
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
  await tap(pad, '건너뛰기'); await settle(1500);
  await shot(wall, '03-wall-week'); await shot(pad, '03-pad-week');

  // 사건 하나를 연다 (태블릿에서 그 사건의 제목이 든 버튼)
  const title = (await (await fetch(`${BASE}/api/sim/week`)).json()).events.find((e) => e.id === EVENT).title;
  await tap(pad, new RegExp(title)); await settle(2500);
  await shot(wall, '04-wall-scene-1'); await shot(pad, '04-pad-scene');
  for (let i = 0; i < 3; i += 1) { await tap(pad, '다음 →'); await settle(500); }
  await shot(wall, '05-wall-scene-2');
  for (let i = 0; i < 12 && !(await pad.getByRole('button', { name: /주민 평가 →/ }).isVisible().catch(() => false)); i += 1) {
    await pad.getByRole('button', { name: /넘기기/ }).tap({ timeout: 3000 }).catch(() => {});
    await settle(500);
  }
  await shot(wall, '06-wall-scene-end');
  await tap(pad, /주민 평가 →/); await settle(1500);
  await shot(wall, '07-wall-evaluations'); await shot(pad, '07-pad-evaluations');

  const emergency = await pad.getByRole('button', { name: /다 읽었어요/ }).isVisible().catch(() => false);
  if (emergency) { await tap(pad, /다 읽었어요/); await settle(1200); await shot(wall, '08-wall-result'); }
  else {
    await tap(pad, /^고르기 →/); await settle(1500);
    await shot(wall, '08-wall-choose'); await shot(pad, '08-pad-choose');
    // A touch picks (lit on the wall); the confirm chooses.
    await pad.getByRole('button', { name: /^1/ }).tap();
    await settle(1200);
    await shot(wall, '08b-wall-considering'); await shot(pad, '08b-pad-considering');
    await tap(pad, /번으로 다시 보기/);
    await settle(2500);
    await shot(wall, '09-wall-after-scene'); await shot(pad, '09-pad-after-scene');
    for (let i = 0; i < 12 && !(await pad.getByRole('button', { name: /반영된 평가 →/ }).isVisible().catch(() => false)); i += 1) {
      await pad.getByRole('button', { name: /넘기기/ }).tap({ timeout: 3000 }).catch(() => {});
      await settle(500);
    }
    await tap(pad, /반영된 평가 →/); await settle(1500);
    await shot(wall, '10-wall-result'); await shot(pad, '10-pad-result');
  }
  await tap(pad, /← 이번 주/); await settle(1200);
  await shot(wall, '11-wall-week-again'); await shot(pad, '11-pad-week-again');
  await tap(pad, /마치기/); await settle(2500);
  await shot(wall, '12-wall-closing'); await shot(pad, '12-pad-closing');
  await tap(pad, /마무리 말/); await settle(20000);
  await shot(wall, '13-wall-closing-words');
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no console errors');
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
