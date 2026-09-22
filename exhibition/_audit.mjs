// 자연스러움·정합성 점검.  node exhibition/_audit.mjs
//
// 사람이 읽고 판단할 것과, 기계가 잡을 수 있는 것을 나눈다.
// 여기서는 기계가 잡을 수 있는 것만 본다 — 시각 어긋남, 화자 이탈, 대사에 없는 시각,
// 리뷰 귀속, 이동 구간 끊김, 개선안이 실제로 결과를 바꾸는지.
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './gemini.mjs';

const B = JSON.parse(fs.readFileSync(path.join(OUT, 'bundle.json'), 'utf8'));
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const NAME = Object.fromEntries([...B.people.map((p) => [p.id, p.name]), ...Object.entries(B.roles)]);
const problems = [];
const note = (k, s) => problems.push(`[${k}] ${s}`);

// ── 1. task 시간
for (const n of B.nodes) {
  for (const t of n.tasks) {
    if (toMin(t.end) < toMin(t.start)) note('시간역행', `${n.id} ${t.id} ${t.start}→${t.end}`);
    if (toMin(t.end) - toMin(t.start) > 60 * 5) note('과도한길이', `${n.id} ${t.id} ${t.start}→${t.end}`);
  }
}

// ── 2. 대사 속 시각이 facts에 있는 시각인가
const TIME_RE = /(\d{1,2})\s*시\s*(\d{1,2})?\s*분?|(\d{1,2}):(\d{2})/g;
const KO_NUM = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };
let lineCount = 0, timeMentions = 0, timeMismatch = 0;
for (const [key, sc] of Object.entries(B.scenes)) {
  const node = B.nodes.find((n) => n.key === key);
  for (const [tid, tr] of Object.entries(sc.transcripts)) {
    const task = node.tasks.find((x) => x.id === tid);
    const allowed = new Set();
    for (const f of [...task.facts, task.scene, task.start, task.end]) {
      for (const m of String(f).matchAll(/(\d{1,2}):(\d{2})/g)) allowed.add(`${+m[1]}:${+m[2]}`);
    }
    for (const l of tr.lines) {
      lineCount++;
      for (const m of l.text.matchAll(/(\d{1,2}):(\d{2})|(\d{1,2})\s*시\s*(\d{1,2})\s*분/g)) {
        const h = +(m[1] ?? m[3]), mi = +(m[2] ?? m[4]);
        timeMentions++;
        // 사람은 "오후 8시 56분"이라고 말한다. 12시간제도 같은 시각으로 본다.
        const ok = allowed.has(`${h}:${mi}`) || (h <= 12 && allowed.has(`${h + 12}:${mi}`));
        if (!ok) { timeMismatch++; if (timeMismatch <= 6) note('없는시각', `${node.id} ${tid} "${l.text}" (허용: ${[...allowed].join(', ')})`); }
      }
    }
  }
}

// ── 3. 화자가 그 장면 등장인물인가
for (const [key, sc] of Object.entries(B.scenes)) {
  const node = B.nodes.find((n) => n.key === key);
  for (const [tid, tr] of Object.entries(sc.transcripts)) {
    const task = node.tasks.find((x) => x.id === tid);
    const cast = new Set(task.actors);
    for (const l of tr.lines) if (!cast.has(l.speaker)) note('명단밖화자', `${node.id} ${tid} ${l.speaker}`);
  }
}

// ── 4. 리뷰 귀속 — 그날 겪은 사람만 말했는가
let reviewRows = 0, reviewStray = 0;
for (const [key, sc] of Object.entries(B.scenes)) {
  const node = B.nodes.find((n) => n.key === key);
  const experienced = new Set(node.tasks.flatMap((t) => [...t.actors, t.about]).filter(Boolean));
  for (const r of sc.reviews || []) {
    reviewRows++;
    if (!experienced.has(r.speaker)) { reviewStray++; note('겪지않은사람이평가', `${node.id} ${r.speaker}`); }
  }
}

// ── 5. 이동 구간이 이어지는가 (끊김·역행)
for (const n of B.nodes) {
  for (const mv of n.moves || []) {
    let prev = null;
    for (const leg of mv.legs) {
      if (leg.to < leg.from) note('이동역행', `${n.id} ${mv.taskId} ${mv.who}`);
      if (prev && Math.hypot(leg.path[0][0] - prev[0], leg.path[0][1] - prev[1]) > 30) {
        note('이동끊김', `${n.id} ${mv.taskId} ${mv.who} ${Math.round(Math.hypot(leg.path[0][0] - prev[0], leg.path[0][1] - prev[1]))}px`);
      }
      prev = leg.path[leg.path.length - 1];
    }
  }
}

// ── 6. 개선안이 실제로 다음 날을 바꾸는가
const byId = Object.fromEntries(B.nodes.map((n) => [n.id, n]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let branches = 0, identical = 0;
for (const parent of B.nodes.filter((n) => n.options.length)) {
  const kids = B.nodes.filter((n) => n.parent === parent.id);
  branches++;
  const keys = new Set(kids.map((k) => k.key));
  if (keys.size === 1) { identical++; note('선택이결과를안바꿈', `${parent.id} 의 세 갈래가 같은 하루`); }
}

// ── 보고
console.log(`노드 ${B.nodes.length} · 장면 ${Object.keys(B.scenes).length} · 대사 ${lineCount}줄 · 리뷰 ${reviewRows}줄`);
console.log(`대사 속 시각 언급 ${timeMentions}건 중 facts에 없는 것 ${timeMismatch}건`);
console.log(`갈림길 ${branches}곳 중 세 갈래가 똑같은 곳 ${identical}곳`);
console.log(`\n문제 ${problems.length}건`);
for (const p of problems.slice(0, 40)) console.log(' ', p);

// ── 사람이 읽어야 할 것: 기관 장면 전부
console.log('\n\n================ 보건소 · 119 장면 (사람이 읽고 판단할 것) ================');
const seen = new Set();
for (const [key, sc] of Object.entries(B.scenes)) {
  const node = B.nodes.find((n) => n.key === key);
  for (const [tid, tr] of Object.entries(sc.transcripts)) {
    const task = node.tasks.find((x) => x.id === tid);
    if (!task.actors.some((a) => a === 'CLINIC' || a === 'MEDIC')) continue;
    const sig = tr.lines.map((l) => l.text).join('|').slice(0, 60);
    if (seen.has(sig)) continue;
    seen.add(sig);
    if (seen.size > 4) continue;
    console.log(`\n── ${node.id} ${node.day}일차 ${task.start}–${task.end} ${task.title}`);
    for (const l of tr.lines) console.log(`   ${NAME[l.speaker] ?? l.speaker}: ${l.text}`);
  }
}
