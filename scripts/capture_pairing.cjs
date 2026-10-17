// QR로 짝짓는 흐름을 걷고 캡처한다: QR 화면 → (QR 주소를 태블릿으로 연다) → 연결하기 → 시작 화면
// → 끊겼다 돌아오면 이어서 → 토큰 없는 접속은 거절 → 두 번째 태블릿이 첫 번째를 해제.
//   node scripts/capture_pairing.cjs [웹주소] [출력폴더]      서버(run-exhibition)가 떠 있어야 한다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const jsQR = (() => { try { return require('jsqr'); } catch { return null; } })();

const BASE = process.argv[2] || 'http://localhost:5180';
const OUT = process.argv[3] || path.join(__dirname, '..', '.run', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wallCtx = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  const wall = await wallCtx.newPage();
  const problems = [];
  wall.on('pageerror', (e) => problems.push('wall: ' + e.message));
  const step = (m) => console.log('·', m);
  const check = (ok, m) => { console.log(ok ? '  ok ' : '  FAIL', m); if (!ok) problems.push(m); };

  await wall.goto(`${BASE}/?role=wall`);
  await wall.getByLabel('태블릿 연결').waitFor({ timeout: 30000 });
  await wall.getByAltText('태블릿 연결 QR 코드').waitFor({ timeout: 15000 });
  await wait(800);
  await wall.screenshot({ path: path.join(OUT, 'p1-wall-qr.png') });
  step('모니터: QR 화면');

  // 카메라 대신: QR이 가리키는 주소를 모니터 화면에서 읽는다(QR 그림 아래에 주소가 적혀 있고, 토큰은 서버에서 받는다).
  const pairing = await (await fetch(`${BASE}/api/sim/stage/pairing`)).json();
  const lan = pairing.addresses[0];
  const port = new URL(BASE).port;
  const padUrl = `http://${lan}:${port}/?role=pad&t=${encodeURIComponent(pairing.token)}`;
  check(!!lan, `QR 주소의 기계 주소: ${lan}`);

  // 토큰 없이는 못 들어온다
  const strangerCtx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const stranger = await strangerCtx.newPage();
  await stranger.goto(`http://${lan}:${port}/?role=pad`);
  await stranger.getByText('QR 코드를 스캔해 주세요').waitFor({ timeout: 15000 });
  await stranger.screenshot({ path: path.join(OUT, 'p2-pad-no-code.png') });
  check(true, '토큰 없는 태블릿 접속은 "QR 코드를 스캔해 주세요"');

  // 스캔해서 연 태블릿: 연결하기를 누르기 전까지 모니터는 그대로
  const padCtx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const pad = await padCtx.newPage();
  await pad.goto(padUrl);
  await pad.getByRole('button', { name: '연결하기' }).waitFor({ timeout: 15000 });
  await pad.screenshot({ path: path.join(OUT, 'p3-pad-connect.png') });
  await wait(1200);
  check(await wall.getByLabel('태블릿 연결').isVisible(), '연결하기를 누르기 전에는 모니터가 QR 화면');
  await pad.getByRole('button', { name: '연결하기' }).tap();
  await pad.getByRole('button', { name: '시작하기' }).waitFor({ timeout: 15000 });
  await wall.getByLabel('AI 대기 화면').waitFor({ timeout: 15000 });
  await wall.screenshot({ path: path.join(OUT, 'p4-wall-idle-after-pair.png') });
  check(true, '연결하기 → 모니터는 대기 화면, 태블릿은 시작하기');

  // 하던 자리에서 이어서: 같은 코드로 다시 열어도 연결하기 없이 바로
  await pad.getByRole('button', { name: '시작하기' }).tap();
  await wall.getByLabel('소개').waitFor({ timeout: 15000 });
  await pad.reload();
  await pad.getByRole('button', { name: /건너뛰기/ }).waitFor({ timeout: 15000 });
  check(true, '새로고침해도 같은 자리(소개 영상 중)에서 이어짐, 연결하기를 다시 묻지 않음');

  // 두 번째 태블릿이 붙으면 첫 번째는 해제
  const secondCtx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const second = await secondCtx.newPage();
  await second.goto(padUrl);
  await second.getByRole('button', { name: '연결하기' }).tap();
  await second.getByRole('button', { name: /건너뛰기/ }).waitFor({ timeout: 15000 });
  await pad.getByText('다른 태블릿이 연결되었습니다').waitFor({ timeout: 15000 });
  await pad.screenshot({ path: path.join(OUT, 'p5-pad-released.png') });
  check(true, '두 번째 태블릿이 붙으면 첫 번째에 "다른 태블릿이 연결되었습니다"');

  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'ok: 문제 없음');
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
