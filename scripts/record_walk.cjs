// 전시장 두 화면(모니터 + 태블릿)을 사람이 걷는 속도로 걸으며 화면과 소리를 녹화한다.
//   node scripts/record_walk.cjs [웹주소] [출력폴더] [걷기이름=full]
// 실행 중인 sim 서버(run-exhibition)가 필요하다. 기록은 읽기만 하고, 모델은 부르지 않는다.
// 옛 녹화 도구(사진 영상 시절)는 한 주 구조로 바꾸며 지웠다 — 이것이 새 것이다. 결과는 새 폴더에만 쓴다(확정본 영상은 건드리지 않는다).
//
// 걷기(WALKS): 사건 하나를 요청 1번으로 끝까지 읽는다. 같은 사건을 여러 번 열면 ver2 · ver3 을 이어서 읽는다.
//   full  = E1 · E5 · E1 · E5 · E4 를 읽고 고쳐 본 버전 5개(마무리가 열리는 기준) → 마무리 장면
//   quick = E5 한 사건(ver1→ver2→ver3)만, 화면 · 소리 구성 시험용
//
// 소리는 이렇게 다룬다 (브라우저 녹화는 소리를 담지 못한다):
//   1. 모니터 쪽 페이지에 "누가 언제 무슨 소리를 틀고 멈췄는지"를 적는 장치를 심는다(audioLog: 파일 이름과 시각만).
//   2. 장면은 스스로 한 줄씩 흘러간다(소리 길이 + 0.8초). 누르지 않고 기다리고, 마지막 줄의 소리가 끝나면 주민 평가로 간다.
//   3. 끝나면 화면 영상 + 태블릿 작은 창 + audioLog 를 출력 폴더에 남기고 scripts/mix_walk.py 가 하나의 영상으로 합친다.
//   음성 파일은 합칠 때 읽는다. 그래서 임시 녹음(lite)을 표준 모델로 바꾼 뒤에는 화면을 다시 녹화하지 않고
//   `python scripts/mix_walk.py <출력폴더>` 만 다시 돌리면 된다. 바뀐 소리가 조금 길어도 다음 줄에 잘리지 않게,
//   녹화 때는 서버를 `python scripts/stage_voice.py` 가 만든 폴더로 띄운다(임시 녹음인 줄만 +2.5초 길게 보여 준다):
//     python scripts/stage_voice.py && MEDIAL_VOICE_DIR=.run/voice_stage bash run-exhibition.sh
const { chromium } = require('C:/Users/pjo12/Downloads/coding/medial/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = process.argv[2] || 'http://localhost:5180';
const OUT = process.argv[3] || path.join(__dirname, '..', '.run', 'record');
const WALK = process.argv[4] || 'full';
fs.mkdirSync(OUT, { recursive: true });

const ROOT = path.join(__dirname, '..');
const VOICE_DIR = process.env.MEDIAL_VOICE_DIR || path.join(ROOT, 'local-data', 'audio', 'gemini-3.8-flash-tts');
const WALLSIZE = { width: 2560, height: 1440 };
const PADSIZE = { width: 1180, height: 820 };

const WALKS = {
  full: [['E1', 1], ['E5', 1], ['E1', 1], ['E5', 1], ['E4', 1]],
  quick: [['E5', 1], ['E5', 1]],
};
// 소리가 없는 화면을 읽는 시간(ms): 사람이 눈으로 따라가는 만큼. 대사는 소리 길이가 정한다.
const PACE = { line: 3800, evaluations: 6500, choose: 5500, pick: 1500, week: 2500, closing: 7000, afterVoice: 500 };

// 모니터 페이지에 심는 장치: 소리를 틀고(play) 멈추고(pause) 크기를 바꾸는(volume) 일을 시각과 함께 적는다.
const AUDIO_PROBE = () => {
  const log = (window.__audioLog = []);
  const ids = new WeakMap();
  let n = 0;
  const idOf = (el) => { if (!ids.has(el)) ids.set(el, ++n); return ids.get(el); };
  const P = HTMLMediaElement.prototype;
  const play = P.play;
  const pause = P.pause;
  P.play = function (...a) {
    log.push({ t: Date.now(), id: idOf(this), op: 'play', src: this.currentSrc || this.src, loop: this.loop, vol: this.volume, at: this.currentTime });
    return play.apply(this, a);
  };
  P.pause = function (...a) {
    log.push({ t: Date.now(), id: idOf(this), op: 'pause', at: this.currentTime });
    return pause.apply(this, a);
  };
  const vol = Object.getOwnPropertyDescriptor(P, 'volume');
  Object.defineProperty(P, 'volume', { ...vol, set(v) { log.push({ t: Date.now(), id: idOf(this), op: 'volume', vol: v }); vol.set.call(this, v); } });
};

async function main() {
  // 소리 길이(초): 서버가 읽는 음성 폴더(MEDIAL_VOICE_DIR, 없으면 기본)의 manifest — 걸을 때 기다릴 시간을 정한다.
  const manifest = JSON.parse(fs.readFileSync(path.join(VOICE_DIR, 'manifest.json'), 'utf8'));
  const seconds = Object.fromEntries(Object.values(manifest).map((r) => [r.file, r.seconds]));

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wallCtx = await browser.newContext({ viewport: WALLSIZE, recordVideo: { dir: path.join(OUT, 'wall'), size: { width: 1920, height: 1080 } } });
  await wallCtx.addInitScript(AUDIO_PROBE);
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

  // 지금까지 튼 대사 소리(파일 이름)와 마지막으로 튼 시각.
  const voicePlays = () => wall.evaluate(() => (window.__audioLog || []).filter((e) => e.op === 'play' && /\/village\/voice\//.test(e.src || '')).map((e) => ({ t: e.t, file: decodeURIComponent(e.src.split('/').pop()) })));
  // 마지막 줄이 막 나왔을 때: 그 줄의 소리가 끝나고 숨 한 번 쉴 때까지.
  const finishLastLine = async () => {
    const plays = await voicePlays();
    const last = plays[plays.length - 1];
    if (!last) { await sleep(PACE.line); return; }
    const end = last.t + (seconds[last.file] ?? 0) * 1000 + PACE.afterVoice;
    await sleep(Math.max(end - Date.now(), 0));
  };

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
    // 장면은 스스로 한 줄씩 흘러간다(줄마다 소리 길이 + 0.8초). 누르지 않고 마지막 줄이 나올 때까지 기다린 뒤,
    // 마지막 줄의 소리가 끝나기를 기다렸다가 주민 평가로 간다.
    await pad.getByRole('button', { name: /주민 평가 →/ }).waitFor({ state: 'visible', timeout: 120000 }).catch(async (e) => {
      await pad.screenshot({ path: path.join(OUT, `stuck-${id}-pad.png`) }).catch(() => {});
      await wall.screenshot({ path: path.join(OUT, `stuck-${id}-wall.png`) }).catch(() => {});
      throw e;
    });
    await finishLastLine();
    await tap(/주민 평가 →/);
    await sleep(PACE.evaluations);
    if (await pad.getByRole('button', { name: /수정 요청 고르기 →/ }).isVisible().catch(() => false)) {
      await tap(/수정 요청 고르기 →/);
      await sleep(PACE.choose);
      await pad.getByRole('button', { name: /^1/ }).tap();
      await sleep(PACE.pick);
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
    const heard = (await voicePlays()).length;
    await tap(/마무리 말/);
    // 마무리 말(나레이션 5줄)은 마지막 줄의 소리가 끝날 때까지 보여 준다.
    const last = 'outro_05_NARRATOR.wav';
    for (let i = 0; i < 240; i += 1) {
      const now = await voicePlays();
      if (now.length > heard && now.some((p) => p.file === last)) break;
      await sleep(500);
    }
    await sleep(((seconds[last] ?? 6) * 1000) + 4000);
  } else {
    await sleep(PACE.week);
  }
  const tEnd = Date.now();

  const audioLog = await wall.evaluate(() => window.__audioLog || []);
  await wallCtx.close(); await padCtx.close(); await browser.close();

  const one = (dir) => path.resolve(OUT, dir, fs.readdirSync(path.join(OUT, dir)).filter((f) => f.endsWith('.webm')).sort().pop());
  const meta = {
    walk: WALK, base: BASE, tStart, tEnd,
    wallVideo: one('wall'), padVideo: one('pad'),
    wallSkip: (tStart - t0wall) / 1000, padSkip: (tStart - t0pad) / 1000,
    length: (tEnd - tStart) / 1000, padSize: PADSIZE, audioLog,
  };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log('녹화 끝:', OUT, `(${meta.length.toFixed(0)}초, 소리 기록 ${audioLog.length}건)`);

  // 합치기: 화면 + 소리. 소리만 바꿀 때는 이 명령만 다시: python scripts/mix_walk.py <출력폴더>
  const r = spawnSync('python', [path.join(__dirname, 'mix_walk.py'), OUT], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
