// 27경로 트리 생성기.
//
//   node exhibition/generate.mjs --plan     돌리지 않고 몇 건인지만
//   node exhibition/generate.mjs --only 0   첫 초기 정책 갈래만 (파일럿)
//   node exhibition/generate.mjs            전부
//
// 트리는 LLM 없이 먼저 펼친다 — 하루 계획과 개선안이 전부 결정적이기 때문이다.
// 그래서 (날, 정책)이 같은 노드는 대화록도 같다. 같은 것은 한 번만 생성하고 노드들이 나눠 쓴다.
// 끊겨도 같은 명령을 다시 치면 된다. 이미 만든 (날, 정책)은 건너뛴다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, parseArgs } from './lib/util.mjs';
import { parseDialogue } from './lib/parse.mjs';
import { loadVillage, hhmm, min, at, positionAt, routePath, travelMinutes, toSourceXY } from './village.mjs';
import { INITIAL_POLICIES, improvementOptions, applyChange, describePolicy } from './policy.mjs';
import { planDay, bindingRules, displayName, MED, CLINIC, MEDIC } from './plan.mjs';
import { promptScene, promptReviews } from './prompts.mjs';
import { chat, spend, MODEL, OUT } from './gemini.mjs';

const args = parseArgs();
const SCENES = path.join(OUT, 'scenes');
const MAX_ATTEMPTS = 3;

const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function writeJSON(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(o, null, 1), 'utf8');
  fs.renameSync(tmp, p);
}

// ---------------------------------------------------------------------------
// 트리 — LLM 없이 펼친다
// ---------------------------------------------------------------------------

export function buildTree(world) {
  const nodes = [];
  const add = (n) => { nodes.push(n); return n; };

  // 다음 날 어떤 규칙이 걸리는지는 그날의 사건 구성이 정한다 — 정책과 무관하므로 한 번만 구한다.
  const bindDay2 = bindingRules(planDay(2, world, INITIAL_POLICIES[0].policy));
  const bindDay3 = bindingRules(planDay(3, world, INITIAL_POLICIES[0].policy));

  INITIAL_POLICIES.forEach((preset, pi) => {
    const policy1 = preset.policy;
    const day1 = planDay(1, world, policy1);
    const n1 = add({ id: `${pi}`, parent: null, day: 1, policy: policy1, plan: day1,
      choice: { kind: 'initial', id: preset.id, title: preset.name, because: preset.rationale },
      options: improvementOptions(policy1, day1, bindDay2), key: hash([1, policy1]) });

    n1.options.forEach((o1, c1) => {
      const policy2 = applyChange(policy1, o1);
      const day2 = planDay(2, world, policy2);
      const n2 = add({ id: `${pi}-${c1}`, parent: n1.id, day: 2, policy: policy2, plan: day2,
        choice: { kind: 'change', ...o1 }, options: improvementOptions(policy2, day2, bindDay3),
        key: hash([2, policy2]) });

      n2.options.forEach((o2, c2) => {
        const policy3 = applyChange(policy2, o2);
        const day3 = planDay(3, world, policy3);
        add({ id: `${pi}-${c1}-${c2}`, parent: n2.id, day: 3, policy: policy3, plan: day3,
          choice: { kind: 'change', ...o2 }, options: [], key: hash([3, policy3]) });
      });
    });
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// 지도 — 위치 표와 요청 때문에 생기는 이동
// ---------------------------------------------------------------------------

/** 화면이 그리는 시간대. 전시 화면의 타임라인과 같다 (PDF 03쪽: 5시부터 22시). */
export const DAY_START = min('05:00');
export const DAY_END = min('22:00');
const STEP = 2;

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * 도로망 간선을 가로 지도 좌표의 선분으로. 같은 간선을 두 번 담지 않는다.
 * 이 선들이 사람이 다닐 수 있는 길의 전부다 — 마커는 여기를 벗어나지 않는다.
 */
function roadEdges(world) {
  const { nodes, adjacency } = world.registry.roadGraph;
  const seen = new Set();
  const out = [];
  for (const [a, list] of Object.entries(adjacency)) {
    for (const [b] of list) {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const [ax, ay] = nodes[a], [bx, by] = nodes[b];
      const p = toSourceXY(world, { x: ax, y: ay });
      const q = toSourceXY(world, { x: bx, y: by });
      out.push([round1(p.x), round1(p.y), round1(q.x), round1(q.y)]);
    }
  }
  return out;
}

/**
 * 기준 일과의 위치 표. 하루는 날마다 같으므로 한 벌만 만들어 세 날이 나눠 쓴다.
 * 좌표는 **가로 지도(원본 래스터)** 기준이다 — 화면이 그대로 쓴다.
 */
function baselineTrack(world) {
  const track = {}, place = {};
  for (const p of world.people) {
    const row = [], where = [];
    for (let t = DAY_START; t <= DAY_END; t += STEP) {
      // 그 시각 어디에 있다고 **기록된** 곳. 툴팁과 지도 밖 목록이 같은 값을 쓴다.
      where.push(at(p, t, world).place);
      const pos = positionAt(p, t, world);
      if (pos.offMap) { row.push(null); continue; }
      const s = toSourceXY(world, pos);
      row.push([round1(s.x), round1(s.y)]);
    }
    track[p.id] = row;
    place[p.id] = where;
  }
  return { track, place };
}

/**
 * 요청 때문에 생기는 이동. 기준 일과를 그 구간만 덮어쓴다.
 * plan.mjs 가 task에 넣어 둔 `move` 를 도로 경로로 펼친다 — 지어낸 선이 아니라 다익스트라 결과다.
 */
function moveOverlays(world, node) {
  const out = [];
  for (const task of node.plan.tasks) {
    const mv = task.move;
    if (!mv) continue;
    let t = mv.startAt ?? task.startAt;
    const pts = [];
    for (const leg of mv.legs) {
      const path = routePath(world, leg.from, leg.to, { fromPerson: leg.fromPerson ?? mv.who, toPerson: leg.toPerson ?? mv.who });
      // `rider` 는 그 구간을 남의 차에 타고 가는 사람이다. 화면은 그 사람을 운전자와
      // 같은 자리에 놓아 한 마커로 묶는다 — 태워 주기가 화면에서 보이는 유일한 방법이다.
      if (path.length) pts.push({ from: t, to: leg.at, rider: leg.rider ?? null,
        path: path.map((q) => { const s = toSourceXY(world, q); return [round1(s.x), round1(s.y)]; }) });
      t = leg.at;
    }
    // 보낸 사람은 그 일이 끝날 때까지 그 자리에 있는다. 도착하자마자 돌아서면,
    // 대화록에서는 22분을 동생 곁에서 흉부압박을 하는 사람이 지도에서는 이미
    // 집으로 걸어가고 있다. 머무는 끝은 그 요청에서 이 사람이 낀 마지막 task다.
    if (pts.length) {
      const stay = Math.max(t, ...node.plan.tasks
        .filter((x) => x.questId === task.questId && (x.actors || []).includes(mv.who))
        .map((x) => x.endAt));
      if (stay > t) {
        const last = pts[pts.length - 1].path;
        pts.push({ from: t, to: stay, rider: null, path: [last[last.length - 1]] });
        t = stay;
      }
    }
    // 돌아가는 길. 이것을 빼면 일이 끝난 사람이 원래 일과 자리로 순간이동한다.
    if (pts.length) {
      const person = world.by[mv.who];
      const last = mv.legs[mv.legs.length - 1];
      const backTo = at(person, t, world).target;
      const backMin = travelMinutes(world, last.to, backTo, { car: mv.car, fromPerson: last.toPerson ?? mv.who, toPerson: mv.who });
      const back = routePath(world, last.to, backTo, { fromPerson: last.toPerson ?? mv.who, toPerson: mv.who });
      if (back.length > 1) {
        pts.push({ from: t, to: t + backMin, path: back.map((q) => { const s = toSourceXY(world, q); return [round1(s.x), round1(s.y)]; }) });
        t += backMin;
      }
    }
    if (pts.length) out.push({ who: mv.who, taskId: task.id, car: !!mv.car, legs: pts, endAt: t });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 한 장면 = 한 호출 (조건 A · 통으로)
// ---------------------------------------------------------------------------

function speakerTable(world, actors) {
  const characters = [...new Set(actors)].map((id) => ({ id, name: displayName(world, id) }));
  return { characters };
}

async function generateScene(world, node, task) {
  const sc = speakerTable(world, task.actors);
  const p = promptScene(world, { day: node.day, policy: node.policy, task });
  const flags = [];
  let best = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await chat({ system: p.system, user: p.user,
      maxTokens: Math.max(2048, task.budget * 220),
      tag: { node: node.id, day: node.day, task: task.id, kind: 'scene' } });
    const { lines, stray } = parseDialogue(sc, r.text);
    if (stray.length) flags.push(`stray:${stray.length}`);
    const unknown = lines.filter((l) => l.unknownSpeaker);
    if (unknown.length) flags.push(`unknown:${unknown.map((l) => l.speaker).join('/')}`);

    if (lines.length === task.budget && unknown.length === 0) return { lines, flags };
    flags.push(`countMismatch:${lines.length}/${task.budget}@${attempt}`);
    if (!best || Math.abs(lines.length - task.budget) < Math.abs(best.length - task.budget)) best = lines;
  }
  return { lines: best || [], flags: [...flags, 'countMismatchFinal'] };
}

async function generateReviews(world, node) {
  const ids = [...new Set(node.plan.tasks.flatMap((t) => t.actors))].filter((id) => world.by[id]);
  const sc = speakerTable(world, ids);
  const p = promptReviews(world, { day: node.day, tasks: node.plan.tasks });
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await chat({ system: p.system, user: p.user, maxTokens: 2048,
      tag: { node: node.id, day: node.day, kind: 'reviews' } });
    const { lines } = parseDialogue(sc, r.text);
    const good = lines.filter((l) => !l.unknownSpeaker);
    if (good.length) return { reviews: good, flags: good.length === ids.length ? [] : [`count:${good.length}/${ids.length}`] };
  }
  return { reviews: [], flags: ['reviewsFailed'] };
}

/** (날, 정책) 하나에 대한 대화록 묶음. 이미 있으면 그대로 쓴다. */
async function generateDay(world, node) {
  const out = path.join(SCENES, `${node.key}.json`);
  let prev = null;
  if (fs.existsSync(out)) {
    try { prev = readJSON(out); } catch { /* 깨진 파일은 다시 만든다 */ }
    if (prev?.status === 'ok' && !args.force && !args['reviews-only'] && !args.redo) return { cached: true, ...prev };
  }
  // --redo <taskId>: 그 장면 하나만 다시 뽑는다 (그 장면의 프롬프트를 고쳤을 때).
  if (args.redo && prev?.status === 'ok') {
    const task = node.plan.tasks.find((t) => t.id === args.redo);
    if (!task) return { cached: true, ...prev };
    const rec = { ...prev, transcripts: { ...prev.transcripts, [task.id]: await generateScene(world, node, task) } };
    writeJSON(out, rec);
    return rec;
  }
  // --reviews-only: 대화록은 그대로 두고 평가만 다시 뽑는다 (평가 프롬프트를 고쳤을 때).
  if (args['reviews-only'] && prev?.status === 'ok') {
    const r = await generateReviews(world, node);
    const rec = { ...prev, reviews: r.reviews, reviewFlags: r.flags, reviewsRegeneratedAt: new Date().toISOString() };
    writeJSON(out, rec);
    return rec;
  }
  const transcripts = {};
  for (const task of node.plan.tasks) {
    transcripts[task.id] = await generateScene(world, node, task);
  }
  const rev = await generateReviews(world, node);
  const rec = { key: node.key, day: node.day, model: MODEL, status: 'ok',
    generatedAt: new Date().toISOString(), transcripts, reviews: rev.reviews, reviewFlags: rev.flags };
  writeJSON(out, rec);
  return rec;
}

// ---------------------------------------------------------------------------

async function main() {
  const world = loadVillage();
  const nodes = buildTree(world);
  const filtered = args.only !== undefined
    ? nodes.filter((n) => n.id === String(args.only) || n.id.startsWith(`${args.only}-`))
    : nodes;

  let keys = [...new Map(filtered.map((n) => [n.key, n])).values()];
  if (args.day) keys = keys.filter((n) => n.day === Number(args.day));
  if (args.limit) keys = keys.slice(0, Number(args.limit));
  const scenes = keys.reduce((s, n) => s + n.plan.tasks.length + 1, 0);
  const done = keys.filter((n) => fs.existsSync(path.join(SCENES, `${n.key}.json`))).length;
  console.log(`노드 ${filtered.length}개 (경로 ${filtered.filter((n) => n.day === 3).length}개) · 서로 다른 (날,정책) ${keys.length}개 · 호출 최대 ${scenes}건 · 이미 있는 것 ${done}개 · 모델 ${MODEL}`);
  if (args.plan) {
    for (const n of keys.slice(0, 12)) console.log(`  ${n.id} ${n.day}일차 key=${n.key} task=${n.plan.tasks.length}`);
    return;
  }

  let ok = 0, cached = 0, fail = 0;
  await pool(keys, Number(process.env.EUNJEOM_CONCURRENCY || 6), (n) => generateDay(world, n),
    (i, total, n, res) => {
      if (res?.error) fail++; else if (res?.cached) cached++; else ok++;
      console.log(`[${i}/${total}] ${n.day}일차 ${n.key} ${res?.error ? 'ERR ' + String(res.error).slice(0, 120) : res?.cached ? '있음' : '생성'}`);
    });

  // 트리 + 대화록을 화면이 읽을 파일 하나로 합친다.
  const bundle = {
    generatedAt: new Date().toISOString(), model: MODEL,
    source: '은점마을 12인 익명 페르소나 (인터뷰 전수 채록). 대화는 전부 합성이다.',
    people: world.people.map((p) => ({ id: p.id, name: p.name, age: p.age, group: p.group,
      close: p.close, day: p.day, health: p.health, digital: p.digital, job: p.job,
      home: toSourceXY(world, p.home) })),
    roles: { [MED]: 'MEDial', [CLINIC]: '보건소 담당', [MEDIC]: '구급대원' },
    // 지도 — 원본 래스터(가로로 긴 방향)와 그 위의 장소·경계
    map: {
      width: world.map.srcWidth, height: world.map.srcHeight, mPerPx: world.map.mPerPx,
      north: '오른쪽',
      png: 'data:image/png;base64,' + fs.readFileSync(world.map.file).toString('base64'),
      places: Object.values(world.places)
        .filter((p) => !['TOWN', 'TOWNEXIT'].includes(p.id))
        .map((p) => ({ id: p.id, label: p.label, ...toSourceXY(world, p) })),
      // 추출된 도로망 350개 간선. 사람은 이 선 위에서만 움직인다 — 화면이 그것을 보여 준다.
      roads: roadEdges(world),
    },
    clock: { start: DAY_START, end: DAY_END, step: STEP },
    ...baselineTrack(world),
    initial: INITIAL_POLICIES.map((p) => ({ id: p.id, name: p.name, rationale: p.rationale })),
    nodes: nodes.map((n) => ({
      id: n.id, parent: n.parent, day: n.day, key: n.key, choice: n.choice,
      title: n.plan.title, summary: n.plan.summary,
      policy: describePolicy(n.policy),
      metrics: n.plan.metrics,
      tasks: n.plan.tasks.map((t) => ({ id: t.id, type: t.type, questId: t.questId, title: t.title,
        start: hhmm(t.startAt), end: hhmm(t.endAt), outcome: t.outcome, channel: t.channel,
        actors: t.actors, scene: t.scene, facts: t.facts, budget: t.budget,
        about: t.about ?? null })),
      moves: moveOverlays(world, n),
      // 마을을 벗어나 있는 구간 (읍내 진료 · 병원 이송). 지도에서 그 사람을 뺀다.
      absences: n.plan.tasks.filter((t) => t.absence)
        .flatMap((t) => (Array.isArray(t.absence) ? t.absence : [t.absence])),
      options: n.options,
    })),
    // 디스크에 있는 것은 전부 담는다 — 일부만 돌린 뒤에도 화면이 그만큼은 보여 준다.
    scenes: Object.fromEntries([...new Map(nodes.map((n) => [n.key, n])).values()]
      .filter((n) => fs.existsSync(path.join(SCENES, `${n.key}.json`)))
      .map((n) => [n.key, readJSON(path.join(SCENES, `${n.key}.json`))])),
  };
  writeJSON(path.join(OUT, 'bundle.json'), bundle);
  const s = spend();
  console.log(`\n생성 ${ok} · 있음 ${cached} · 실패 ${fail}`);
  console.log(`누적 호출 ${s.calls}건 · 입력 ${s.input.toLocaleString()} · 출력 ${s.output.toLocaleString()} 토큰`);
  console.log(`묶음 파일: exhibition/out/bundle.json`);
}

if (path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
