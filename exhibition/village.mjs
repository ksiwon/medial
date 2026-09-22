// 은점마을 — 사람·일과·지리. **LLM이 만들지 않는 부분**이다.
//
// 두 개의 로컬 원본을 읽는다. 둘 다 저장소에 커밋되지 않는다.
//   1. 익명 페르소나 JSON  — 말투·성향·연기 지침 (외부 API로 보내는 것은 이 익명본뿐이다)
//   2. medial 정규화 레지스트리 (`local-data/normalized/village.v1.json`)
//      — 실제 지도 위의 집·장소 좌표, 268노드 도로망, 12인의 일과(plan.baseline), 이동 속도
//
// 좌표계는 레지스트리의 **북쪽 위(north-up)** 프레임이다: 490 × 1230 px, 1 px = 0.981 m.
// 지도 래스터(village-map.png)는 원본 방향(1230 × 490, 북쪽이 오른쪽)이라 가로로 길다.
// 화면에 가로로 크게 걸려면 래스터를 그대로 쓰고 좌표만 돌린다 — `toSourceXY` 가 그 변환이다.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/** 정규화 레지스트리는 이 저장소 안에 있다 (`scripts/import_village` 가 만든다. 커밋되지 않는다). */
const DEFAULT_REGISTRY = path.resolve(HERE, '..', 'local-data', 'normalized', 'village.v1.json');

/**
 * 익명 페르소나는 저장소 밖 원자료 폴더에 있다. 경로는 `docs/research/source-manifest.json`
 * 이 가리키는 곳과 같다. 다른 곳에 두었으면 EUNJEOM_PERSONAS 로 지정한다.
 */
const DEFAULT_PERSONAS =
  'C:/Users/pjo12/Downloads/5학년/AEL/URP/참여자 정보/은점마을_페르소나_익명.json';

/** 장소별 관측 성질. 일과가 그 사람을 어디에 두느냐가 곧 닿는지·갈 수 있는지를 정한다. */
const PLACE_KIND = {
  HOME:  { label: '자택',            reach: 1, assign: 1 },
  HALL:  { label: '마을회관',        reach: 1, assign: 1 },
  PATROL:{ label: '마을 순찰',       reach: 1, assign: 1, finish: 1 },
  FARM:  { label: '밭',              reach: 0, assign: 0 },
  SEA:   { label: '조업 구역',       reach: 0, assign: 0 },
  PORT:  { label: '은점항',          reach: 1, assign: 0 },
  FOOD:  { label: '은점마을식품',    reach: 1, assign: 1 },
  MIGA:  { label: '미가식당',        reach: 1, assign: 1 },
  EXP:   { label: '어촌체험마을',    reach: 1, assign: 0 },
  TOWN:  { label: '읍내',            reach: 1, assign: 0, errand: 1, offMap: 1 },
};

/** 그 장소가 **직장**인 사람은 자리를 뜰 수 없다. 같은 식당이라도 손님과 주인은 다르다. */
const WORKPLACE = { P4: 'FOOD', P10: 'MIGA', P11: 'MIGA' };

/** 차를 쓰는 사람. 인터뷰: 거의 모든 집에 차가 있으나 P9는 본인이 운전하지 않는다. */
const DRIVES = new Set(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P12']);

export const min = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export const hhmm = (m) => {
  const t = Math.max(0, Math.round(m));
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// 도로망 — 다익스트라
// ---------------------------------------------------------------------------

function makeRouter(graph) {
  const adj = graph.adjacency;
  const nodeXY = (k) => graph.nodes[k];
  const cache = new Map();

  /** a,b 는 노드 키. → { metres, nodes: [key...] }. 닿지 않으면 metres = Infinity. */
  function route(a, b) {
    if (a === b) return { metres: 0, nodes: [a] };
    const key = `${a}|${b}`;
    if (cache.has(key)) return cache.get(key);

    const dist = new Map([[a, 0]]);
    const prev = new Map();
    const seen = new Set();
    // 노드가 268개뿐이라 이진 힙 없이 선형 탐색으로 충분하다.
    while (true) {
      let u = null, best = Infinity;
      for (const [k, d] of dist) if (!seen.has(k) && d < best) { best = d; u = k; }
      if (u === null) break;
      if (u === b) break;
      seen.add(u);
      for (const [v, w] of adj[u] || []) {
        const nd = best + w;
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); }
      }
    }
    const metres = dist.get(b) ?? Infinity;
    const nodes = [];
    if (Number.isFinite(metres)) {
      for (let k = b; k !== undefined; k = prev.get(k)) { nodes.unshift(k); if (k === a) break; }
    }
    const out = { metres, nodes };
    cache.set(key, out);
    return out;
  }

  return { route, nodeXY };
}

// ---------------------------------------------------------------------------
// 로드
// ---------------------------------------------------------------------------

export function loadVillage({
  personaPath = process.env.EUNJEOM_PERSONAS || DEFAULT_PERSONAS,
  registryPath = process.env.EUNJEOM_REGISTRY || DEFAULT_REGISTRY,
} = {}) {
  if (!fs.existsSync(personaPath)) throw new Error(`익명 페르소나 파일이 없다: ${personaPath}`);
  if (!fs.existsSync(registryPath)) throw new Error(`정규화 레지스트리가 없다: ${registryPath}\n(medial 저장소에서 scripts/import_village 를 먼저 돌린다)`);

  const raw = JSON.parse(fs.readFileSync(personaPath, 'utf8'));
  if (!/익명/.test(raw['메타']?.['제목'] || '')) {
    throw new Error('익명본이 아닌 페르소나 파일이다. 실명본은 외부 API로 보내지 않는다.');
  }
  const reg = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const router = makeRouter(reg.roadGraph);

  const byRegId = Object.fromEntries(reg.residents.map((r) => [r.id, r]));
  const people = raw['페르소나'].map((p) => {
    const r = byRegId[p.id];
    if (!r) throw new Error(`레지스트리에 ${p.id} 가 없다`);
    return {
      id: p.id,
      name: p['이름'],
      age: p['나이'],
      group: p['관계']?.['그룹'] ?? '',
      close: (p['관계']?.['가까운 사람'] ?? []).map((s) => s.split(' ')[0]),
      day: p['하루'],
      health: p['건강']?.['요약'] ?? '',
      digital: p['디지털']?.['수준'] ?? '',
      dos: p['연기 지침']?.['해야 할 것'] ?? [],
      donts: p['연기 지침']?.['하지 말 것'] ?? [],
      systemPrompt: p.system_prompt,
      // 레지스트리에서 오는 것
      home: { x: r.home.x, y: r.home.y, node: r.home.anchor.node },
      isHead: !!r.isVillageHead,
      job: r.job,
      // 부부가 식당을 보느라 하루 종일 자리를 뜨지 못한다 — 레지스트리가 그렇게 표시한다.
      pinned: !!r.pinnedAtHome,
      workplace: WORKPLACE[p.id] ?? null,
      drives: DRIVES.has(p.id),
      plan: r.plan.baseline.map((s) => ({ at: s.departMin, target: s.target, car: !!s.car })),
    };
  });

  const places = Object.fromEntries(Object.entries(reg.places).map(([id, p]) => [id, {
    id, label: p.label, x: p.x, y: p.y, node: p.anchor.node, offsetPx: p.anchor.offsetPx || 0,
  }]));

  const world = {
    people,
    by: Object.fromEntries(people.map((p) => [p.id, p])),
    // 마을 공통 배경(의료 접근성·생활 조건·말투). 프롬프트의 상황 소개가 이것을 쓴다.
    common: raw['메타']?.['공통 배경'] ?? {},
    places,
    patrol: reg.patrol,
    travel: reg.travel,                       // walkMPerMin 70 · driveMPerMin 300 · offMapTownMin 30
    map: {
      file: path.join(path.dirname(registryPath), reg.mapImage.file),
      srcWidth: reg.mapImage.sourceWidthPx,   // 1230 — 원본 방향(북쪽이 오른쪽)에서 가로
      srcHeight: reg.mapImage.sourceHeightPx, // 490
      mPerPx: reg.mapImage.mPerPx,
    },
    frame: reg.geometry.frame,                // 북쪽 위 프레임 490 × 1230
    router,
    // 도로망 원본. 화면이 길을 그릴 때 쓴다.
    registry: { roadGraph: reg.roadGraph },
    sources: { personaPath, registryPath },
  };

  // 사람이 갈 수 있는 지점(자택·장소)의 노드 키를 한 곳에 모은다.
  world.nodeOf = (target, personId) => {
    if (target === 'HOME') return world.by[personId].home.node;
    if (target === 'PATROL') return places.HALL.node;
    if (/^P\d+$/.test(target)) return world.by[target].home.node;   // "P5" = 그 사람 집
    return places[target]?.node ?? places.HALL.node;
  };
  world.xyOf = (target, personId) => {
    if (target === 'HOME') return world.by[personId].home;
    if (/^P\d+$/.test(target)) return world.by[target].home;
    return places[target] ?? places.HALL;
  };
  return world;
}

// ---------------------------------------------------------------------------
// 거리와 시간
// ---------------------------------------------------------------------------

/** 두 지점(자택·장소 id) 사이의 도로 거리 m. */
export function routeMeters(world, a, b, { fromPerson, toPerson } = {}) {
  const na = world.nodeOf(a, fromPerson);
  const nb = world.nodeOf(b, toPerson);
  return world.router.route(na, nb).metres;
}

/** 이동 시간(분). 마을 밖(TOWN)은 경로 계산이 아니라 원본의 고정값 30분이다. */
export function travelMinutes(world, a, b, { car = false, fromPerson, toPerson } = {}) {
  if (a === 'TOWN' || b === 'TOWN') return world.travel.offMapTownMin;
  const m = routeMeters(world, a, b, { fromPerson, toPerson });
  if (!Number.isFinite(m)) return world.travel.offMapTownMin;
  const speed = car ? world.travel.driveMPerMin : world.travel.walkMPerMin;
  return Math.max(1, Math.round(m / speed));
}

/** 지도에 그릴 경로(북쪽 위 프레임의 점 배열). */
export function routePath(world, a, b, { fromPerson, toPerson } = {}) {
  const na = world.nodeOf(a, fromPerson);
  const nb = world.nodeOf(b, toPerson);
  const { nodes } = world.router.route(na, nb);
  return nodes.map((k) => { const [x, y] = world.router.nodeXY(k); return { x, y }; });
}

// ---------------------------------------------------------------------------
// 그 시각에 어디 있는가
// ---------------------------------------------------------------------------

/** 일과의 구간들. 각 구간은 [출발시각, 다음 출발시각) 동안의 목적지다. */
function segments(person) {
  return person.plan.map((s, i) => ({
    from: s.at,
    to: person.plan[i + 1]?.at ?? 24 * 60,
    target: s.target,
    car: s.car,
  }));
}

/**
 * 그 시각 그 사람은 어디에 있고 무엇이 가능한가.
 *   reach  — 본인에게 연락이 닿는가 (안내 시계·전화)
 *   assign — 남을 도우러 갈 수 있는가
 *   finish — 수락은 해도 이 구간이 끝나야 출발한다 (이장의 순찰)
 */
export function at(person, t, world) {
  const segs = segments(person);
  const seg = segs.find((s) => t >= s.from && t < s.to) ?? segs[segs.length - 1];
  const kind = PLACE_KIND[seg.target] ?? PLACE_KIND.HOME;
  const isWork = person.workplace && person.workplace === seg.target;
  return {
    target: seg.target,
    place: seg.target === 'HOME' ? (person.pinned ? '가게' : '자택') : kind.label,
    until: seg.to,
    reach: kind.reach,
    // 직장에 있는 사람, 그리고 가게를 보느라 종일 묶인 사람은 자리를 뜰 수 없다.
    assign: (isWork || person.pinned) ? 0 : kind.assign,
    finish: kind.finish ?? 0,
    errand: kind.errand ?? 0,
    offMap: kind.offMap ?? 0,
    car: seg.car ? 1 : 0,
  };
}

/**
 * 지도 애니메이션용 위치. 구간 출발 시각에 길을 나서고, 도로 거리만큼 걸린 뒤 도착해 머문다.
 * 순찰은 폐루프를 따라 계속 돈다. 읍내는 지도 밖이라 위치를 주지 않는다.
 */
export function positionAt(person, t, world) {
  const segs = segments(person);
  let prev = 'HOME';
  for (const seg of segs) {
    if (t >= seg.to) { prev = seg.target; continue; }
    if (t < seg.from) break;

    if (seg.target === 'TOWN') {
      const mins = world.travel.offMapTownMin;
      if (t < seg.from + mins) return { ...lerpAlong(world, prev, 'TOWNEXIT', person, (t - seg.from) / mins), moving: true };
      return { offMap: true };
    }
    if (seg.target === 'PATROL') {
      const loop = world.patrol;
      const total = loopLength(loop);
      const walked = ((t - seg.from) * world.travel.walkMPerMin / world.map.mPerPx) % total;
      return { ...pointAlong(loop, walked), moving: true, patrol: true };
    }
    const mins = travelMinutes(world, prev, seg.target, { car: seg.car, fromPerson: person.id, toPerson: person.id });
    if (t < seg.from + mins) return { ...lerpAlong(world, prev, seg.target, person, (t - seg.from) / mins), moving: true };
    const p = world.xyOf(seg.target, person.id);
    return { x: p.x, y: p.y };
  }
  const p = world.xyOf(prev, person.id);
  return { x: p.x, y: p.y };
}

/**
 * 부탁을 수락한 사람이 **실제로 출발할 수 있는 시각**.
 * 순찰 중이면 돌던 한 바퀴를 마저 돈다 — 한 바퀴는 폐루프 3,930 m ÷ 걷는 속도 70 m/분 = 56분이다.
 * (원본 기록의 "오후 순찰이 끝나 그때서야 출발"을 지도에서 다시 계산한 값이다.)
 * 그 밖의 구간은 하던 일을 마치는 구간 끝까지 기다린다.
 */
export function readyAt(person, t, world) {
  const s = at(person, t, world);
  if (!s.finish) return t;
  if (s.target === 'PATROL') {
    const segs = segments(person);
    const seg = segs.find((x) => t >= x.from && t < x.to);
    const lap = loopLength(world.patrol) * world.map.mPerPx / world.travel.walkMPerMin;
    const laps = Math.ceil(Math.max(1e-6, t - seg.from) / lap);
    return Math.round(Math.min(seg.to, seg.from + laps * lap));
  }
  return s.until;
}

function loopLength(loop) {
  let s = 0;
  for (let i = 1; i < loop.length; i++) s += Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]);
  return s;
}

function pointAlong(loop, d) {
  let s = 0;
  for (let i = 1; i < loop.length; i++) {
    const seg = Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]);
    if (s + seg >= d) {
      const u = seg === 0 ? 0 : (d - s) / seg;
      return { x: loop[i - 1][0] + (loop[i][0] - loop[i - 1][0]) * u, y: loop[i - 1][1] + (loop[i][1] - loop[i - 1][1]) * u };
    }
    s += seg;
  }
  return { x: loop[0][0], y: loop[0][1] };
}

/** 도로 경로 위를 비율 u 만큼 간 지점. */
function lerpAlong(world, a, b, person, u) {
  const pts = routePath(world, a, b, { fromPerson: person.id, toPerson: person.id });
  if (pts.length < 2) { const p = world.xyOf(b, person.id); return { x: p.x, y: p.y }; }
  let total = 0;
  const segLens = [];
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segLens.push(L); total += L;
  }
  let d = total * Math.max(0, Math.min(1, u)), s = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (s + segLens[i] >= d) {
      const k = segLens[i] === 0 ? 0 : (d - s) / segLens[i];
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    }
    s += segLens[i];
  }
  return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
}

/**
 * 북쪽 위 좌표 → 원본 래스터 좌표(가로로 긴 지도).
 * 레지스트리의 역변환: x_up = y_src, y_up = srcWidth − x_src.
 */
export const toSourceXY = (world, p) => ({ x: world.map.srcWidth - p.y, y: p.x });
