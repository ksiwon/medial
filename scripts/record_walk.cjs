// 전시장 두 화면(모니터 + 태블릿)을 사람이 걷는 속도로 걸으며 화면을 녹화하고, 모니터에 태블릿 작은 창을 얹은 한 영상으로 합친다.
//   node scripts/record_walk.cjs [웹주소] [출력폴더] [걷기이름=full]
// 실행 중인 sim 서버(run-exhibition)가 필요하다. 기록은 읽기만 한다. 소리는 넣지 않는다(음성은 대본 확정 뒤 따로 더한다).
// 옛 녹화 도구(record_walk, 사진 영상 시절)는 한 주 구조로 바꾸며 지웠다 — 이것이 새 것이다. 결과는 새 폴더에만 쓴다(확정본 영상은 건드리지 않는다).
//
// 걷기(WALKS): 사건 하나를 [고른 요청 번호 …]로 끝까지 읽는다. 같은 사건을 여러 번 열면 ver2 · ver3 을 이어서 읽는다.
//   full  = E1(ver1→ver2→ver3) · E5(ver1→ver2→ver3) · E4 · E3 를 고쳐 6번 → 마무리 장면
//   quick = E5 한 사건(ver1→ver2→ver3)만, 화면 구성 시험용(1분 남짓)
const { chromium } = require('C:/Users/pjo12/Downloads/coding/medial/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.argv[2] || 'http://localhost:5180';
const OUT = process.argv[3] || path.join(__dirname, '..', '.run', 'record');
const WALK = process.argv[4] || 'full';
fs.mkdirSync(OUT, { recursive: true });

const WALLSIZE = { width: 2560, height: 1440 };
const PADSIZE = { width: 1180, height: 820 };
const PAD_WIDTH = 520; // 합친 영상(1920x1080) 위 태블릿 창의 너비
const MARGIN = 32;
const MARGIN_BOTTOM = 84; // 모니터 아래 줄(자동 넘김 안내)을 가리지 않게 올린다

const WALKS = {
  full: [['E1', 1], ['E5', 1], ['E1', 1], ['E5', 1], ['E4', 1], ['E3', 1]],
  quick: [['E5', 1], ['E5', 1]],
};
// 사건을 읽는 속도(ms): 사람이 눈으로 따라가는 만큼.
const PACE = { line: 3800, evaluations: 9000, choose: 7000, week: 3500, closing: 9000 };

async function main() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wallCtx = await browser.newContext({ viewport: WALLSIZE, recordVideo: { dir: path.join(OUT, 'wall'), size: { width: 1920, height: 1080 } } });
  const padCtx = await browser.newContext({ viewport: PADSIZE, hasTouch: true, isMobile: true, recordVideo: { dir: path.join(OUT, 'pad'), size: PADSIZE } });
  const wall = await wallCtx.newPage();
  const t0wall = Date.now();
  const pad = await padCtx.newPage();
  const t0pad = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tap = async (re, opts = {}) => {
    const el = pad.getByRole('button', { name: re }).first();
    await el.waitFor({ state: 'visible', timeout: 30000 });
    await el.tap(opts);
  };
  const titles = (await (await fetch(`${BASE}/api/sim/week`)).json()).events;
  const titleOf = (id) => titles.find((e) => e.id === id).title;

  // 연결: 태블릿이 모니터의 QR 주소로 붙는다.
  await wall.goto(`${BASE}/?role=wall`);
  const pairing = await (await fetch(`${BASE}/api/sim/stage/pairing`)).json();
  await pad.goto(`http://${pairing.addresses[0]}:${new URL(BASE).port}/?role=pad&t=${encodeURIComponent(pairing.token)}`);
  await pad.getByRole('button', { name: '연결하기' }).tap();
  await pad.getByText('시작하기').waitFor({ timeout: 30000 });
  // 영상은 여기서부터가 본편: 앞의 연결 장면은 합칠 때 잘라 낸다.
  const tStart = Date.now();
  await sleep(1500);
  await tap('시작하기');
  // 소개는 끝까지 보여 준다(건너뛰기는 쓰지 않는다): 한 주가 뜰 때까지.
  await wall.getByLabel('이번 주').waitFor({ state: 'visible', timeout: 180000 });
  await sleep(PACE.week);

  for (const [id] of WALKS[WALK]) {
    await tap(new RegExp(titleOf(id)));
    // 장면: 다음 줄을 사람 속도로 넘기고, 끝나면 주민 평가로.
    for (let i = 0; i < 40 && !(await pad.getByRole('button', { name: /주민 평가 →/ }).isVisible().catch(() => false)); i += 1) {
      await sleep(PACE.line);
      await pad.getByRole('button', { name: /다음 →/ }).tap({ timeout: 3000 }).catch(() => {});
    }
    await tap(/주민 평가 →/);
    await sleep(PACE.evaluations);
    if (await pad.getByRole('button', { name: /수정 요청 고르기 →/ }).isVisible().catch(() => false)) {
      await tap(/수정 요청 고르기 →/);
      await sleep(PACE.choose);
      await pad.getByRole('button', { name: /^1/ }).tap();
      await sleep(2000);
      await tap(/^돌리기$/);
    } else {
      await tap(/이번 주로 →/);
    }
    await wall.getByLabel('이번 주').waitFor({ state: 'visible', timeout: 30000 });
    await sleep(PACE.week);
  }

  // 5번 이상 고쳐야 마무리가 열린다(짧은 시험 걷기는 거기까지 가지 않고 끝낸다).
  if (await pad.getByRole('button', { name: /마무리 장면 보기/ }).isEnabled().catch(() => false)) {
    await tap(/마무리 장면 보기/);
    await sleep(PACE.closing);
    await tap(/마무리 말/);
    await sleep(24000);
  } else {
    await sleep(PACE.week);
  }
  const tEnd = Date.now();

  await wallCtx.close(); await padCtx.close(); await browser.close();

  // ---- 합치기: 모니터 위에 태블릿 작은 창. 두 영상은 만들어진 시각이 달라 앞을 맞춰 자른다.
  const one = (dir) => path.join(OUT, dir, fs.readdirSync(path.join(OUT, dir)).filter((f) => f.endsWith('.webm')).sort().pop());
  const wallVid = one('wall'); const padVid = one('pad');
  const wallSkip = (tStart - t0wall) / 1000; const padSkip = (tStart - t0pad) / 1000;
  const len = (tEnd - tStart) / 1000;
  const padH = Math.round((PAD_WIDTH * PADSIZE.height) / PADSIZE.width);
  const out = path.join(OUT, `Dially_v4_${WALK}.mp4`);
  execFileSync('ffmpeg', [
    '-y', '-ss', String(wallSkip), '-t', String(len), '-i', wallVid,
    '-ss', String(padSkip), '-t', String(len), '-i', padVid,
    '-filter_complex',
    `[1:v]scale=${PAD_WIDTH}:${padH},format=yuv420p[p];[p]pad=iw+8:ih+8:4:4:color=0x2a2a28[pb];[0:v][pb]overlay=W-w-${MARGIN}:H-h-${MARGIN_BOTTOM}[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', out,
  ], { stdio: 'inherit' });
  console.log('영상:', out);
}
main().catch((e) => { console.error(e); process.exit(1); });
