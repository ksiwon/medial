// 두 화면(모니터 + 태블릿)을 동시에 열어 태블릿 터치가 모니터에 반영되는지 걷고 캡처한다.
//   node scripts/capture_two_screens.cjs [웹주소] [출력폴더]
// 실행 중인 sim 서버(run-sim)가 필요하다. 기록은 읽기만 한다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5180';
const OUT = process.argv[3] || path.join(__dirname, '..', '.run', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const WALL = { width: 2560, height: 1440 };
const PAD = { width: 1180, height: 820 }; // iPad Air (4세대) 가로

async function main() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wallCtx = await browser.newContext({ viewport: WALL });
  const padCtx = await browser.newContext({ viewport: PAD, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const wall = await wallCtx.newPage();
  const pad = await padCtx.newPage();
  const problems = [];
  for (const [name, page] of [['wall', wall], ['pad', pad]]) {
    page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name} console: ${m.text()}`); });
  }

  const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('shot', name); };
  const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
  const tap = async (page, text, opts = {}) => {
    const el = page.getByRole('button', { name: text }).first();
    await el.waitFor({ state: 'visible', timeout: 15000 });
    await el.tap(opts);
  };

  await wall.goto(`${BASE}/?role=wall`);
  // 카메라 대신: 서버가 모니터에게 주는 짝짓기 주소로 태블릿을 연다 (QR이 담은 주소와 같다).
  const pairing = await (await fetch(`${BASE}/api/sim/stage/pairing`)).json();
  const port = new URL(BASE).port;
  await pad.goto(`http://${pairing.addresses[0]}:${port}/?role=pad&t=${encodeURIComponent(pairing.token)}`);
  await pad.getByRole('button', { name: '연결하기' }).tap();
  await pad.getByText('시작하기').waitFor({ timeout: 30000 });
  await settle(1500);
  await shot(wall, '01-wall-idle');
  await shot(pad, '01-pad-idle');

  await tap(pad, '시작하기');
  await settle(2500);
  await shot(wall, '02-wall-intro');
  await shot(pad, '02-pad-intro');

  await tap(pad, '건너뛰기');
  await pad.getByRole('button', { name: '다음 장면으로 →' }).waitFor({ timeout: 30000 });
  await settle(6000);
  await shot(wall, '03-wall-day');
  await shot(pad, '03-pad-day');

  for (let i = 0; i < 8 && !(await pad.getByRole('button', { name: /평가 보기/ }).isVisible().catch(() => false)); i += 1) {
    await pad.getByRole('button', { name: '다음 장면으로 →' }).tap({ timeout: 3000 }).catch(() => {});
    await settle(700);
  }
  await tap(pad, '주민 에이전트 평가 보기');
  await pad.getByText(/평가를 남긴 주민/).waitFor({ timeout: 30000 });
  await settle(2500);
  await shot(wall, '04-wall-evaluations');
  await shot(pad, '04-pad-evaluations');

  const first = pad.locator('button').filter({ hasText: /\S/ }).nth(2);
  const name = await pad.locator('main button').first().innerText();
  await pad.locator('main button').first().tap();
  await settle(2500);
  await shot(wall, '05-wall-interview');
  await shot(pad, '05-pad-interview');
  console.log('opened interview of:', name.split('\n')[0]);

  await tap(pad, '목록으로');
  await settle(1500);
  await shot(wall, '06-wall-cards-again');

  await tap(pad, '무엇을 고칠지 고르기');
  await settle(2500);
  await shot(wall, '07-wall-choose');
  await shot(pad, '07-pad-choose');

  // the wall has nothing to press
  const wallButtons = await wall.locator('button').count();
  console.log('wall buttons:', wallButtons);

  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no console errors');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
