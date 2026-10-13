// A first-time visitor's walk, start to end at normal speed (node scripts/record_walk.cjs <out dir>, with
// the sim running on 5180): records a silent video, a frame every 5 s, and plays.json - every voice clip the
// page started and when. scripts/mux_voice.py lays the voice on the video. Presses what a visitor would
// press (the highlighted next button, the first choice).
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2];
fs.rmSync(`${out}/run`, { recursive: true, force: true });
fs.mkdirSync(`${out}/run/frames`, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 2560, height: 1440 }, recordVideo: { dir: `${out}/run`, size: { width: 1920, height: 1080 } } });
  const tPage = Date.now();
  const p = await ctx.newPage();
  const t0 = Date.now();
  // Every voice clip the page starts, with the time it started (the video has no sound of its own).
  await p.addInitScript(() => {
    window.__plays = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push({ file: this.src.split('/').pop(), at: Date.now(), dur: this.duration });
      return orig.call(this);
    };
  });
  const log = [];
  const stamp = (m) => { const s = ((Date.now() - t0) / 1000).toFixed(0); log.push(`${s}s ${m}`); console.log(`${s}s ${m}`); };
  let n = 0;
  const shot = async (tag) => {
    const s = String(Math.round((Date.now() - t0) / 1000)).padStart(4, '0');
    await p.screenshot({ path: `${out}/run/frames/${s}-${tag}.png` }).catch(() => {});
    n += 1;
  };
  await p.goto('http://localhost:5180/');
  stamp('start');
  const deadline = Date.now() + 14 * 60 * 1000;
  let last = '';
  let choices = 0;
  let fast = false;
  while (Date.now() < deadline) {
    const vis = (re) => p.getByRole('button', { name: re }).first().isVisible().catch(() => false);
    let state = 'intro';
    if (await p.getByText('사흘이 끝났습니다').first().isVisible().catch(() => false)) state = 'ending';
    else if (await vis(/이걸로 내일을 돌린다/)) state = 'choice';
    else if (await vis(/다음 주민 보기/)) state = 'eval-page';
    else if (await vis(/결과 보러 가기/)) state = 'eval-last';
    else if (await vis(/이 평가를 보고 무엇을 고칠지/)) state = 'eval';
    else if (await vis(/주민 평가를 보시겠습니까/)) state = 'dayend';
    else if (await vis(/정지|재생/)) state = 'day';
    if (false && state === 'day' && choices >= 2 && !fast) { await p.getByRole('button', { name: '빠르게' }).click().catch(() => {}); fast = true; }
    if (state !== last) { stamp(state); last = state; await shot(state); }
    if (state === 'ending') { await p.waitForTimeout(50000); await shot('ending'); break; }
    if (state === 'dayend') { await p.waitForTimeout(1500); await shot('dayend-wait'); /* the page goes on by itself after 5 s, as a visitor lets it */ }
    else if (state === 'eval-page') { await p.waitForTimeout(6000); await shot('eval-page-read'); await p.getByRole('button', { name: /다음 주민 보기/ }).click().catch(() => {}); }
    else if (state === 'eval' || state === 'eval-last') { await p.waitForTimeout(4000); await shot('eval-read'); await p.getByRole('button', { name: /이 평가를 보고 무엇을 고칠지|결과 보러 가기/ }).click().catch(() => {}); }
    else if (state === 'choice') { await p.waitForTimeout(4000); await shot('choice-read'); await p.getByRole('button', { name: /이걸로 내일을 돌린다/ }).first().click().catch(() => {}); choices += 1; }
    else await p.waitForTimeout(5000), await shot(state);
  }
  stamp('end');
  const plays = await p.evaluate(() => window.__plays).catch(() => []);
  fs.writeFileSync(`${out}/run/plays.json`, JSON.stringify({ tPage, plays }));
  await ctx.close();
  await b.close();
  fs.writeFileSync(`${out}/run/log.txt`, log.join('\n'));
})().catch((e) => { console.log('FAIL', e.message.slice(0, 300)); process.exit(1); });
