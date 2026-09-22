// 발표자료에 넣을 화면 그림을 찍는다.  node exhibition/_shots.mjs
//
// 전시 데모(out/eunjeom-exhibition.html)를 1600x900 으로 띄우고, 정해진 경로를 따라가며
// 네 장을 남긴다. 손으로 찍지 않는 이유는 간단하다 — 대화록을 다시 뽑으면 그림도 같이
// 낡기 때문이다. 결과는 docs/research/screenshots/2026-09-23-eunjeom/ 에 들어간다
// (그 폴더는 .gitignore 로 저장소에 올리지 않는다).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'docs/research/screenshots/2026-09-23-eunjeom';
fs.mkdirSync(OUT, { recursive: true });
const FILE = 'file:///' + path.resolve('exhibition/out/eunjeom-exhibition.html').replace(/\\/g, '/');

const b = await chromium.launch();
const page = await b.newPage({ viewportSize: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto(FILE);
await page.waitForTimeout(900);

const cards = () => page.locator('#full .card');
const pick = async (i) => { await cards().nth(i).click(); await page.waitForTimeout(700); };
const at = async (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  await page.evaluate(([h, m]) => { setPlaying(false); t = h * 60 + m; render(); }, [h, m]);
  await page.waitForTimeout(500);
};
const endBar = async () => {
  await page.evaluate(() => { t = V.clock.end; render(); showEndbar(); });
  await page.waitForTimeout(350);
};
const toReviews = async () => {
  await page.getByRole('button', { name: /주민 리뷰/ }).click();
  await page.waitForTimeout(400);
};
const dayEnd = async () => { await endBar(); await toReviews(); };
const toChoose = async () => {
  await page.locator('#full button').filter({ hasText: /무엇을 고칠지/ }).click();
  await page.waitForTimeout(350);
};

// ── 1. 벽 화면. 1일차 09:52, 이장이 확인하러 가는 중
await pick(0);
await at('09:52');
await page.screenshot({ path: `${OUT}/01-wall-screen.png` });

// ── 2. 하루가 끝난 화면. 22:00 에 시계가 멈추고 아래에 띠가 뜬다
await endBar();
await page.screenshot({ path: `${OUT}/02-day-end.png` });

// ── 3. 그 띠를 누르면 나오는 주민 평가
await toReviews();
await page.screenshot({ path: `${OUT}/03-reviews.png` });

// ── 4. 수정안 세 장. 2일차 갈림길에는 "내일은 걸리는 자리가 없을 수 있다"는 줄이 붙는다
await toChoose();
await pick(0);
await dayEnd();
await toChoose();
const deck = await page.locator('#full .cards').boundingBox();
await page.screenshot({ path: `${OUT}/04-three-changes.png`,
  clip: { x: 40, y: deck.y - 14, width: 1520, height: deck.height + 28 } });

// ── 5. 3일차 저녁의 위급. 지도에서는 형제가 한 마커로 모이고, 오른쪽에는 그 대화가 흐른다
//    (2일차에 두 번째 수정안을 고르면 3일차에 "걸리는 자리가 없었다"가 뜬다 — 0-0-1)
await pick(1);
await at('20:45');
await page.screenshot({ path: `${OUT}/05-emergency.png` });

// ── 6. 실려 간 사람은 한마디를 남기지 못한다
await dayEnd();
const p8 = page.locator('#full .rev .r').filter({ hasText: 'P8' }).first();
await p8.scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
const p7 = await page.locator('#full .rev .r').filter({ hasText: 'P7' }).first().boundingBox();
const b8 = await p8.boundingBox();
await page.screenshot({ path: `${OUT}/06-no-comment.png`,
  clip: { x: 60, y: p7.y - 8, width: 1480, height: b8.y + b8.height - p7.y + 16 } });

await b.close();
for (const f of fs.readdirSync(OUT).sort()) {
  console.log(f, (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB');
}
