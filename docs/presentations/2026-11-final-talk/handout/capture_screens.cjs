// 외국인 교수님용 영어 화면 유인물: 모니터 화면을 걸으며 한글 문구를 사전(ko_en_dictionary.json)으로 영어로 바꿔 캡처한다.
// 앱 코드는 건드리지 않는다. 브라우저 안에서 글자만 바꿔 찍는다.
//   node capture_screens.cjs <출력폴더> ko_en_dictionary.json     (W=1440 H=1000 DSF=2 로 찍었다)
//   사전 없이 돌리면 한글 문구 목록이 <출력폴더>/ko.json 에 남는다.
// 실행 중인 전시 서버(run-exhibition.sh, 모니터 http://localhost:5180)가 필요하다. 모델은 부르지 않는다.
// handout walk: captures wall screens (Korean) + all visible text nodes. Usage: node hw.cjs <out> [en.json]
const { chromium } = require(path0.join(__dirname, '..', '..', '..', '..', 'node_modules', 'playwright'));
const path0 = require('path');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:5180';
const OUT = process.argv[2];
const DICT = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
const W = +(process.env.W || 1440), H = +(process.env.H || 810);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// in-page: translate text nodes (and aria/placeholder-free) by dictionary; collect Korean ones
const INSTALL = (dict) => {
  window.__ko = new Set();
  const hasKo = (s) => /[\uAC00-\uD7A3]/.test(s);
  const n = (s) => s.replace(/\s+/g, ' ').trim();
  const walk = () => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = w.nextNode())) {
      const raw = t.nodeValue; if (!hasKo(raw)) continue;
      const k = n(raw);
      if (dict && dict[k] !== undefined) { t.nodeValue = raw.replace(/\S[\s\S]*\S|\S/, dict[k]); }
      else window.__ko.add(k);
    }
  };
  window.__walk = walk;
  new MutationObserver(walk).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  setInterval(walk, 200);
};


const SIG = () => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = w.nextNode())) {
    const s = t.nodeValue.trim(); if (!s) continue;
    const el = t.parentElement; if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    let o = 1, e = el; while (e && e !== document.body) { const cs = getComputedStyle(e); o *= parseFloat(cs.opacity); if (cs.visibility === 'hidden' || cs.display === 'none') o = 0; e = e.parentElement; }
    if (o < 0.9) continue;
    out.push(s.replace(/[0-9]+/g, '#'));
  }
  return out.join('|');
};
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wallCtx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: +(process.env.DSF || 1) });
  await wallCtx.addInitScript(INSTALL, DICT);
  const padCtx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
  const wall = await wallCtx.newPage(); const pad = await padCtx.newPage();
  const tap = async (re, o = {}) => { const el = pad.getByRole('button', { name: re }).first(); await el.waitFor({ state: 'visible', timeout: 60000 }); await el.tap(o); };
  const titles = (await (await fetch(`${BASE}/api/sim/week`)).json()).events;
  const titleOf = (id) => titles.find((e) => e.id === id).title;
  const kos = {};
  const snap = async (name) => {
    for (let k = 0; k < 8; k++) {
      await wall.evaluate(() => window.__walk && window.__walk());
      await sleep(350);
      const vis = await wall.evaluate(SIG);
      if (!/[가-힣]/.test(vis)) break;
    }
    const diag = await wall.evaluate(() => {
      const bad = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let t;
      while ((t = w.nextNode())) {
        if (!/[가-힣]/.test(t.nodeValue)) continue;
        const el = t.parentElement; const r = el.getBoundingClientRect();
        if (r.width && r.height) bad.push(el.outerHTML.slice(0, 220) + ' @' + Math.round(r.top));
      }
      const over = [...document.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > innerHeight + 2 && getComputedStyle(e).position !== 'fixed' && r.top < innerHeight; }).length;
      return { bad, over, sh: document.documentElement.scrollHeight, ih: innerHeight };
    });
    if (diag.bad.length || diag.sh > diag.ih + 2 || diag.over > 0) console.log('DIAG', name, JSON.stringify(diag));
    await wall.screenshot({ path: path.join(OUT, name + '.png') });
    kos[name] = await wall.evaluate(() => { const a = [...window.__ko]; window.__ko.clear(); return a; });
    console.log('snap', name, kos[name].length);
  };
  await wall.goto(`${BASE}/?role=wall`);
  await sleep(1500);
  const pairing = await (await fetch(`${BASE}/api/sim/stage/pairing`)).json();
  await pad.goto(`http://${pairing.addresses[0]}:5180/?role=pad&t=${encodeURIComponent(pairing.token)}`);
  await pad.getByRole('button', { name: '연결하기' }).tap();
  await pad.getByText('시작하기').waitFor({ timeout: 180000 });
  await sleep(2500);
  await snap('00_cover');
  await tap('시작하기');
  // intro: snap whenever the on-screen text settles on something new
  let last = '', n = 0, stable = 0, lastTxt = '';
  for (let i = 0; i < 400; i++) {
    if (await wall.getByLabel('AI 조율자 초안').isVisible().catch(() => false)) break;
    const t = await wall.evaluate(SIG);
    if (t === lastTxt) stable++; else { stable = 0; lastTxt = t; }
    if (stable === 4 && t !== last && t.length > 20) { last = t; n++; await snap('05_intro_' + String(n).padStart(2, '0')); }
    await sleep(700);
  }
  await wall.getByLabel('AI 조율자 초안').waitFor({ state: 'visible', timeout: 180000 });
  await sleep(2500);
  await snap('01_draft');
  await tap(/이번 주로 →/);
  await wall.getByLabel('이번 주').waitFor({ state: 'visible', timeout: 20000 });
  await sleep(1500);
  await snap('02_week');
  const SC = process.env.SCENE_WAIT ? +process.env.SCENE_WAIT : 0;
  const readEvent = async (id, pick, tag, rules) => {
    await tap(new RegExp(titleOf(id)));
    // scene: grab mid-scene frame
    await sleep(14000);
    await snap(`${tag}_scene`);
    await pad.getByRole('button', { name: /주민의 피드백 →/ }).waitFor({ state: 'visible', timeout: 120000 });
    await sleep(800);
    await tap(/주민의 피드백 →/);
    await sleep(2500);
    await snap(`${tag}_feedback`);
    if (rules) {
      await tap(/^현재 규칙$/);
      await wall.getByLabel('현재 규칙').waitFor({ state: 'visible', timeout: 10000 });
      await sleep(1500);
      await snap(`${tag}_rules`);
      await tap(/^규칙 닫기$/);
      await sleep(1000);
    }
    if (pick > 0 && await pad.getByRole('button', { name: /수정 요청 고르기 →/ }).isVisible().catch(() => false)) {
      await tap(/수정 요청 고르기 →/);
      await sleep(2500);
      await snap(`${tag}_requests`);
      await pad.getByRole('button', { name: new RegExp(`^${pick}`) }).tap();
      await sleep(1000);
      await tap(/^반영하기$/);
    } else { await tap(/이번 주로 →/); }
    await wall.getByLabel('이번 주').waitFor({ state: 'visible', timeout: 30000 });
    await sleep(1500);
    await snap(`${tag}_week`);
  };
  await readEvent('E1', 1, '10_E1v1');
  await readEvent('E1', 1, '11_E1v2', true);
  await readEvent('E3', 2, '20_E3v1');
  await readEvent('E3', 0, '21_E3v2');
  await tap(/마무리 장면 보기/); await sleep(2500);
  await snap('30_closing_scene');
  await tap(/마무리 말/);
  last = ''; stable = 0; lastTxt = ''; n = 0;
  for (let i = 0; i < 110; i++) {
    const t = await wall.evaluate(SIG);
    if (t === lastTxt) stable++; else { stable = 0; lastTxt = t; }
    if (stable === 3 && t !== last && t.length > 20) { last = t; n++; await snap('31_closing_' + n); }
    await sleep(500);
  }
  const left = Object.entries(kos).filter(([k, v]) => v.length);
  console.log('LEFTOVER', JSON.stringify(left, null, 1));
  fs.writeFileSync(path.join(OUT, 'ko.json'), JSON.stringify(kos, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
