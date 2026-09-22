// bundle.json → 전시 데모 한 파일.  node exhibition/build-html.mjs
//
// 전시장 구성(PDF 09쪽)은 벽면 가로 프로젝터 + 앞의 태블릿 두 대다. 이 파일은 그 루프를
// 노트북 한 화면에서 미리 보는 **임시 데모**다: 벽 화면으로 하루를 재생하고, 하루가 끝나면
// 주민 평가 → 개선안 셋 → 다음 날로 넘어간다.
//
// 지켜야 하는 것 (랩세미나 PDF 03·04·11쪽):
//   · 화면 속 사람은 P번호로 식별한다. 대사에서 서로를 이름으로 부르므로 번호에 가명을
//     붙여(`P1 ◯◯◯`) 누가 누구인지 붙게 한다. 실명은 어디에도 들어가지 않는다
//   · 합성임을 화면 안에 적는다
//   · 겪지 않은 사람을 불만족으로 세지 않는다     → 평가 목록에서 '미경험'으로 따로 둔다
//   · 실시간 모델 호출은 없다. 미리 뽑아 둔 것만 재생한다
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './gemini.mjs';

const B = JSON.parse(fs.readFileSync(path.join(OUT, 'bundle.json'), 'utf8'));

/** ※ 로 표시된 줄은 모델에게만 주는 연기 지시다. 화면에는 내보내지 않는다. */
const shown = (facts) => (facts || []).filter((f) => !/^※/.test(f));

// ---------------------------------------------------------------------------
// 이름 표기
//
// 사람을 **가리키는 자리**(마커·목록·화자 이름표)에는 `P1 ◯◯◯`처럼 번호와 가명을 함께 쓴다.
// 대사와 평가 문장 안의 이름은 그대로 둔다 — 서로를 이름으로 부르는데 화면에 번호만 있으면
// 누가 누구인지 붙지 않기 때문이다. 가명은 익명본의 것이고 실제 인물과 무관하다.
// ---------------------------------------------------------------------------
// MEDial 조율 현황 — 요청 하나를 관측 · 판단 · 조율 · 결과로 갠다 (PDF 03쪽 형식)
// ---------------------------------------------------------------------------

const QUEST_LABEL = {
  'quest:no-response-welfare-check': '응답 없는 안부 확인',
  'quest:medical-transport': '병원 동행',
  'quest:medicine-errand': '약 심부름',
  'quest:emergency': '위급',
};
const QUEST_COLOR = {
  'quest:no-response-welfare-check': '#2563eb',
  'quest:medical-transport': '#b45309',
  'quest:medicine-errand': '#7c3aed',
  'quest:emergency': '#dc2626',
};
const RULES_FOR_TYPE = {
  contact: ['retry_before_help', 'quiet_period', 'disclosure_scope'],
  request_help: ['contact_order', 'neighbour_ask_limit', 'helper_daily_cap', 'disclosure_scope'],
  arrange_transport: ['ride_candidate_order', 'ride_detour_limit', 'helper_daily_cap'],
  escalate_handoff: ['institution_deadline', 'disclosure_scope'],
  notify_close: ['disclosure_scope'],
};

function dashboard(node) {
  const byQuest = new Map();
  for (const t of node.tasks) {
    if (!byQuest.has(t.questId)) byQuest.set(t.questId, []);
    byQuest.get(t.questId).push(t);
  }
  const policyBy = Object.fromEntries(node.policy.map((r) => [r.ruleType, r]));
  return [...byQuest.entries()].map(([questId, tasks]) => {
    const last = tasks[tasks.length - 1];
    const ruleTypes = [...new Set(tasks.flatMap((t) => RULES_FOR_TYPE[t.type] ?? []))];
    return {
      questId, label: QUEST_LABEL[questId] ?? questId, color: QUEST_COLOR[questId] ?? '#555',
      about: tasks[0].about,
      startAt: tasks[0].start, endAt: last.end, outcome: last.outcome,
      observed: tasks.filter((t) => t.type === 'contact').flatMap((t) => shown(t.facts)).slice(0, 3),
      judged: ruleTypes.map((k) => policyBy[k]).filter(Boolean).map((r) => `${r.label} — ${r.sentence}`),
      coordinated: tasks.filter((t) => ['request_help', 'arrange_transport'].includes(t.type)).flatMap((t) => shown(t.facts)),
      result: shown(last.facts).slice(-3),
    };
  });
}

// ---------------------------------------------------------------------------
// 화면이 읽을 만큼만 담은 데이터
// ---------------------------------------------------------------------------

const view = ({
  model: B.model,
  map: { ...B.map, png: undefined },
  clock: B.clock,
  track: B.track,
  place: B.place,
  people: B.people.map((p) => ({ id: p.id, name: p.name, age: p.age, job: p.job, group: p.group, home: p.home })),
  roles: B.roles,
  initial: B.initial,
  nodes: B.nodes.map((n) => ({
    id: n.id, parent: n.parent, day: n.day, key: n.key, choice: n.choice,
    title: n.title, summary: n.summary, policy: n.policy, metrics: n.metrics,
    tasks: n.tasks.map((t) => ({ ...t, facts: shown(t.facts), color: QUEST_COLOR[t.questId] ?? '#555', quest: QUEST_LABEL[t.questId] ?? t.questId })),
    moves: n.moves, absences: n.absences || [], options: n.options, dashboard: dashboard(n),
    // 오늘 실제로 걸리는 규칙. 어제 고친 것이 여기 없으면 화면이 그 사실을 적는다.
    binding: [...new Set(n.tasks.flatMap((t) => RULES_FOR_TYPE[t.type] || []))],
  })),
  scenes: B.scenes,
});

const DATA = JSON.stringify(view).replace(/</g, '\\u003c');
const MAP_PNG = B.map.png;

// ---------------------------------------------------------------------------

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>은점마을 · Village Simulator (전시 데모)</title>
<style>
  :root{
    --paper:#ffffff; --bg:#e9e7e3; --ink:#15150f; --muted:#6b675f; --rule:#dedbd5; --fill:#f5f3ef;
    --accent:#e2542c;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    background:var(--bg);color:var(--ink);word-break:keep-all;overflow:hidden;
    font-family:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased;display:flex;flex-direction:column;
  }
  button{font:inherit;color:inherit;cursor:pointer;background:none;border:none}

  /* ---------------- 상단 바 ---------------- */
  header{flex:none;display:flex;align-items:center;gap:14px;padding:9px 18px;
         background:var(--paper);border-bottom:1px solid var(--rule)}
  .brand{font-weight:800;letter-spacing:-.01em;font-size:16px}
  .daychip{font-size:12.5px;font-weight:800;padding:4px 10px;border-radius:999px;background:var(--ink);color:#fff}
  .clock{font-variant-numeric:tabular-nums;font-weight:800;font-size:25px;letter-spacing:-.02em;min-width:98px}
  .grow{flex:1 1 auto;min-width:0}
  .note{font-size:11.5px;font-weight:700;color:var(--muted);border:1px solid var(--rule);
        border-radius:999px;padding:4px 10px;background:var(--fill)}

  /* ---------------- 본문: 지도 + 우측 열 ---------------- */
  main{flex:1 1 auto;min-height:0;display:flex;gap:10px;padding:10px 12px 12px}
  .stage{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:10px}
  .mapwrap{position:relative;flex:0 1 auto;width:100%;max-height:100%;aspect-ratio:var(--ar);
           background:var(--paper);border:1px solid var(--rule);border-radius:12px;overflow:hidden}
  .mapinner{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;container-type:size}
  .mapbox{position:relative;line-height:0;width:min(100cqw, calc(100cqh * var(--ar)));height:auto}
  .mapbox img{display:block;width:100%;height:100%;object-fit:contain;filter:saturate(.92)}
  .mapbox svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
  .lab{font-weight:600;fill:#1D2935;paint-order:stroke;stroke:#ffffff;stroke-linejoin:round}
  .pid{font-weight:650;fill:#496054;text-anchor:start}
  .xn{fill:#fff;text-anchor:middle;font-weight:700}
  .corner{position:absolute;left:10px;top:9px;display:flex;gap:6px;flex-wrap:wrap;max-width:60%}
  .chip{font-size:11px;font-weight:700;background:#fff;border:1px solid var(--rule);
        border-radius:999px;padding:3px 9px}
  .compass{position:absolute;right:10px;top:9px;font-size:11px;font-weight:800;background:#fff;
           border:1px solid var(--rule);border-radius:999px;padding:3px 9px}
  .mk{cursor:pointer}
  .tip{position:fixed;z-index:50;display:none;pointer-events:none;width:210px;
       background:rgba(21,21,15,.94);color:#fff;border-radius:9px;padding:9px 11px;line-height:1.5;
       box-shadow:0 6px 20px rgba(0,0,0,.25)}
  .tip.on{display:block}
  .tip b{font-size:13px;font-weight:800}
  .tip i{font-size:11px;font-style:normal;opacity:.65}
  .tip .r1{font-size:12.5px;margin-top:4px}
  .tip .r2{font-size:11px;opacity:.65;margin-top:2px}
  .tip .r3{font-size:11.5px;font-weight:800;margin-top:4px;filter:brightness(1.7)}
  .tip .r4{font-size:11.5px;margin-top:4px;border-top:1px solid rgba(255,255,255,.18);padding-top:4px}
  .credit{position:absolute;right:10px;bottom:0;font-size:9px;line-height:1.3;color:#8B96A1;
          background:#fff;border-radius:3px;padding:0 4px;pointer-events:none}
  .scale{position:absolute;right:10px;bottom:15px;font-size:10.5px;font-weight:700;color:var(--muted);
         background:#fff;border:1px solid var(--rule);border-radius:6px;padding:3px 8px}

  /* ---------------- 우측 열 ---------------- */
  aside{flex:0 0 28%;max-width:420px;min-width:300px;display:flex;flex-direction:column;gap:10px;min-height:0}
  .panel{background:var(--paper);border:1px solid var(--rule);border-radius:12px;display:flex;
         flex-direction:column;min-height:0}
  .panel>h2{flex:none;font-size:12px;font-weight:800;letter-spacing:.02em;padding:9px 12px;
            border-bottom:1px solid var(--rule);display:flex;align-items:center;gap:8px}
  .panel>h2 .n{min-width:18px;padding:1px 6px;border-radius:999px;background:var(--ink);color:#fff;font-size:11px}
  .panel .body{overflow:auto;padding:7px 10px 12px;flex:1 1 auto}
  #p-events{flex:1 1 50%}
  #p-dash{flex:1 1 50%}

  .ev{border:1px solid var(--rule);border-radius:9px;margin-bottom:7px;overflow:hidden;background:var(--paper)}
  .ev.now{border-color:var(--ink);box-shadow:0 0 0 2px rgba(21,21,15,.06)}
  .ev>.h{display:flex;gap:7px;align-items:baseline;padding:7px 10px;cursor:pointer}
  .ev>.h:hover{background:var(--fill)}
  .dot{width:8px;height:8px;border-radius:999px;flex:none;margin-top:5px}
  .time{font-variant-numeric:tabular-nums;font-weight:800;font-size:11.5px;color:var(--muted);flex:none}
  .et{font-size:12.5px;font-weight:800;letter-spacing:-.01em;line-height:1.3}
  .em{font-size:10.5px;color:var(--muted);margin-top:2px;line-height:1.4}
  .pill{font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;border:1px solid var(--rule);
        color:var(--muted);white-space:nowrap;flex:none}
  .pill.done{background:#f0fdf4;border-color:#bbf7d0;color:#15803d}
  .pill.refused,.pill.unresolved{background:#fef2f2;border-color:#fecaca;color:#b91c1c}
  .pill.no_answer{background:#fff7ed;border-color:#fed7aa;color:#b45309}
  .pill.handed_off,.pill.accepted{background:#eff6ff;border-color:#bfdbfe;color:#2563eb}
  .pill.live{background:var(--ink);border-color:var(--ink);color:#fff}
  .ev .b{display:none;padding:0 10px 9px}
  .ev.open .b, .ev.now .b{display:block}
  .facts{font-size:11px;color:var(--muted);background:var(--fill);border-radius:7px;padding:7px 9px;margin:5px 0 7px;line-height:1.5}
  .facts li{margin-left:14px}
  .line{display:flex;gap:7px;padding:2px 0;font-size:12.5px;line-height:1.45;animation:in .25s ease-out}
  @keyframes in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  .who{flex:none;width:74px;text-align:right;font-weight:800;color:var(--muted);font-size:11px;padding-top:2px;line-height:1.35}
  .line.med .who{color:var(--accent)}
  .line.med .say{background:#fdf1ec;border-radius:7px;padding:2px 8px}
  .caret{font-size:11px;color:var(--muted);flex:none}

  .q{border:1px solid var(--rule);border-radius:9px;padding:8px 10px;margin-bottom:6px}
  .q .qh{display:flex;align-items:center;gap:8px;margin-bottom:5px}
  .q .ql{font-size:12.5px;font-weight:800}
  .kv{display:flex;gap:7px;font-size:11px;padding:3px 0;border-top:1px dotted var(--rule);line-height:1.5}
  .kv b{flex:none;width:34px;color:var(--muted);font-weight:800}
  .kv li{margin-left:13px}
  .rule{display:flex;gap:7px;font-size:11px;padding:3px 0;border-bottom:1px dotted var(--rule);line-height:1.45}
  .rule b{flex:none;width:120px;color:var(--muted);font-weight:700}
  .rule.chg{background:#fffbeb}
  .rule.chg b{color:#b45309}
  details.rules{margin-top:8px}
  details.rules summary{cursor:pointer;font-size:11px;font-weight:800;color:var(--muted);padding:4px 0}

  /* ---------------- 지도 밖: 마을을 벗어나 있는 사람 ---------------- */
  .offmap{flex:none;background:var(--paper);border:1px solid var(--rule);border-radius:12px;
          padding:9px 13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:44px}
  .offmap .k{font-size:11.5px;font-weight:800;color:var(--muted);flex:none}
  .offmap .who2{font-size:12px;font-weight:700;background:var(--fill);border:1px solid var(--rule);
                border-radius:999px;padding:4px 10px}
  .offmap .who2 span{color:var(--muted);font-weight:600;margin-left:5px}
  .offmap .note{font-size:10.5px;color:#8B96A1;margin-left:auto}

  /* ---------------- 타임라인 ---------------- */
  .tl{flex:none;background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:9px 13px;
      display:flex;align-items:center;gap:13px}
  .play{width:36px;height:36px;border-radius:999px;background:var(--ink);color:#fff;font-size:13px;
        display:flex;align-items:center;justify-content:center;flex:none}
  .speeds{display:flex;gap:4px;flex:none}
  .speeds button{font-size:11px;font-weight:800;padding:5px 9px;border:1px solid var(--rule);border-radius:999px;color:var(--muted)}
  .speeds button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .bars{flex:1 1 auto;min-width:0;position:relative;height:44px;cursor:pointer}
  .bars .row{position:absolute;height:8px;border-radius:999px;opacity:.85}
  .bars .axis{position:absolute;left:0;right:0;bottom:0;height:15px;border-top:1px solid var(--rule)}
  .bars .tick{position:absolute;font-size:10px;font-weight:700;color:var(--muted);transform:translateX(-50%);bottom:0}
  .bars .cursor{position:absolute;top:0;bottom:15px;width:2px;background:var(--ink)}

  /* ---------------- 하루 끝 알림 ---------------- */
  .endbar{position:fixed;left:0;right:0;bottom:0;background:var(--ink);color:#fff;z-index:30;
          display:none;align-items:center;gap:16px;padding:16px 22px}
  .endbar.on{display:flex}
  .endbar .t{font-size:17px;font-weight:800;letter-spacing:-.015em}
  .endbar .s{font-size:13px;opacity:.75}
  .endbar button{background:#fff;color:var(--ink);font-weight:800;font-size:14px;padding:10px 20px;border-radius:999px}

  /* ---------------- 전면 화면 ---------------- */
  .full{position:fixed;inset:0;background:var(--bg);z-index:60;display:none;overflow:auto}
  .full.on{display:block}
  .pad{max-width:1180px;margin:0 auto;padding:40px 24px 70px}
  .kick{font-size:12px;font-weight:800;letter-spacing:.09em;color:var(--accent)}
  h1{font-size:34px;font-weight:800;letter-spacing:-.025em;margin:8px 0 6px}
  .sub{font-size:15px;color:var(--muted);line-height:1.65;max-width:76ch}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:24px}
  .card{background:var(--paper);border:1px solid var(--rule);border-radius:14px;padding:20px;text-align:left}
  .card:hover{border-color:var(--ink)}
  .card .cl{font-size:11.5px;font-weight:800;color:var(--muted);letter-spacing:.04em}
  .card .ct{font-size:18px;font-weight:800;letter-spacing:-.015em;margin:8px 0 10px;line-height:1.35}
  .card .cw{font-size:13.5px;color:var(--muted);line-height:1.6}
  .card .cd{font-size:12.5px;margin-top:14px;border-top:1px solid var(--rule);padding-top:10px;line-height:1.55}
  .card .cd .b{color:#9d9890;text-decoration:line-through}
  .card .cd .a{font-weight:700}
  .warn{font-size:12px;font-weight:700;color:#b45309;background:#fff7ed;border:1px solid #fed7aa;
        border-radius:8px;padding:8px 10px;margin-top:10px;line-height:1.5}
  .rev{background:var(--paper);border:1px solid var(--rule);border-radius:12px;overflow:hidden;margin-top:20px}
  .rev .r{display:flex;gap:14px;padding:13px 18px;border-bottom:1px solid var(--rule)}
  .rev .r:last-child{border-bottom:none}
  .rev .r.none{background:var(--fill)}
  .pid2{flex:none;width:108px;font-weight:800;font-size:14px}
  .tag{flex:none;font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:#eef2ff;color:#2563eb;height:fit-content}
  .tag.n{background:var(--fill);color:var(--muted)}
  .tag.q{background:#fff7ed;color:#b45309}
  .rv{font-size:14.5px;line-height:1.6}
  .rx{font-size:12px;color:var(--muted);margin-top:4px}
  .btn{font-weight:800;font-size:14px;padding:11px 22px;border-radius:999px;background:var(--ink);color:#fff;margin-top:24px}
  .btn.ghost{background:none;color:var(--muted);border:1px solid var(--rule)}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  table{border-collapse:collapse;margin-top:18px;background:var(--paper);width:100%;border:1px solid var(--rule);border-radius:12px;overflow:hidden}
  th,td{padding:10px 14px;font-size:13.5px;text-align:left;border-bottom:1px solid var(--rule)}
  th{background:var(--fill);font-weight:800;color:var(--muted);font-size:12px}
  tr:last-child td{border-bottom:none}
  @media (max-width:1100px){ aside{flex-basis:40%} .cards{grid-template-columns:1fr} }
</style>
</head>
<body>

<header>
  <span class="brand">MEDial</span>
  <span class="daychip" id="daychip">1일차</span>
  <span class="clock" id="clock">05:00</span>
  <span class="grow"></span>
  <span class="note">화면 속 사람은 전부 시뮬레이션입니다 · 이름은 가명입니다</span>
</header>

<main>
  <div class="stage">
    <div class="mapwrap">
      <div class="mapinner"><div class="mapbox" id="mapbox">
        <img id="mapimg" alt="은점마을 지도">
        <svg id="ov" preserveAspectRatio="none"></svg>
      </div></div>
      <div class="corner" id="corner"></div>
      <div class="compass" id="compass">북 →</div>
      <div class="scale" id="scale"></div>
      <div class="credit">© OpenStreetMap 기여자</div>
    </div>

    <div class="offmap" id="offmap"></div>

    <div class="tl">
      <button class="play" id="play">▶</button>
      <div class="speeds" id="speeds"></div>
      <div class="bars" id="bars"></div>
    </div>
  </div>

  <aside>
    <section class="panel" id="p-events">
      <h2>오늘 일어난 일<span class="n" id="n-ev">0</span></h2>
      <div class="body" id="body-ev"></div>
    </section>
    <section class="panel" id="p-dash">
      <h2>MEDial · 조율 현황<span class="n" id="n-db">0</span></h2>
      <div class="body" id="body-db"></div>
    </section>
  </aside>
</main>

<div class="endbar" id="endbar">
  <div><div class="t" id="endt">하루가 끝났습니다</div><div class="s" id="ends"></div></div>
  <span class="grow"></span>
  <button id="toreview">주민 리뷰를 보시겠습니까</button>
</div>

<div class="tip" id="tip"></div>

<div class="full" id="full"><div class="pad" id="full-pad"></div></div>

<script id="data" type="application/json">${DATA}</script>
<script>
const V = JSON.parse(document.getElementById('data').textContent);
document.getElementById('mapimg').src = ${JSON.stringify(MAP_PNG)};
const mapbox = document.getElementById('mapbox');
mapbox.style.aspectRatio = V.map.width + ' / ' + V.map.height;
mapbox.style.setProperty('--ar', V.map.width / V.map.height);
document.querySelector('.mapwrap').style.setProperty('--ar', V.map.width / V.map.height);
document.getElementById('scale').textContent = '1 px ≈ ' + V.map.mPerPx + ' m · 마을 남북 약 1.15 km';
document.getElementById('compass').textContent = '북 ' + (V.map.north === '오른쪽' ? '→' : '↑');

const byId = Object.fromEntries(V.nodes.map(n => [n.id, n]));
const PERSON = Object.fromEntries(V.people.map(p => [p.id, p]));
/** 사람을 가리키는 자리에는 번호와 가명을 함께 쓴다. */
const label = id => PERSON[id] ? id + ' ' + PERSON[id].name : (V.roles[id] || id);
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const hhmm = m => String(Math.floor(m/60)%24).padStart(2,'0') + ':' + String(Math.round(m)%60).padStart(2,'0');
const toMin = s => { const [h,m] = s.split(':').map(Number); return h*60+m; };
const WORD = {done:'해결', accepted:'수락', refused:'거절', no_answer:'응답 없음', unresolved:'미해결', handed_off:'기관 인계'};

let pick = [], node = null, t = V.clock.start;
/** 지금 같은 자리에 서 있는 사람들. drawMap 이 채우고 툴팁이 읽는다. */
let withMe = {}, clusters = [];
let playing = false, secPerLine = 1.0, raf = null, lastTs = 0;

/* ------------------------------------------------------------- 위치 */
function trackPos(id, tt){
  const {start, step} = V.clock;
  const i = (tt - start) / step;
  const a = Math.max(0, Math.floor(i)), b = Math.min(a + 1, V.track[id].length - 1);
  const pa = V.track[id][a], pb = V.track[id][b];
  if (!pa || !pb) return pa || pb || null;
  const u = i - a;
  return [pa[0] + (pb[0]-pa[0])*u, pa[1] + (pb[1]-pa[1])*u];
}
function alongPath(path, u){
  if (path.length === 1) return path[0];
  let total = 0; const L = [];
  for (let i=1;i<path.length;i++){ const d = Math.hypot(path[i][0]-path[i-1][0], path[i][1]-path[i-1][1]); L.push(d); total += d; }
  let d = total * Math.max(0, Math.min(1, u)), s = 0;
  for (let i=0;i<L.length;i++){
    if (s + L[i] >= d){ const k = L[i] ? (d-s)/L[i] : 0; return [path[i][0]+(path[i+1][0]-path[i][0])*k, path[i][1]+(path[i+1][1]-path[i][1])*k]; }
    s += L[i];
  }
  return path[path.length-1];
}
/** 지도에 찍지 않고 밖에 적는 자리. 배를 타고 나간 사람은 바다 위 점이 아니라 목록으로 본다. */
const OFF_MAP_PLACES = { '조업 구역': '조업' };

function posOf(id, tt){
  // 남의 차에 타고 가는 사람이 먼저다. 마을을 비운 시간이라도 차 안에 있으면
  // 차와 함께 지도 위에 있다 — 태워 주기는 그렇게만 보인다.
  for (const mv of node.moves){
    for (const leg of mv.legs){
      if (leg.rider !== id || tt < leg.from || tt > leg.to) continue;
      return { p: alongPath(leg.path, (tt-leg.from)/Math.max(1, leg.to-leg.from)),
               onTask: mv.taskId, car: !!mv.car, moving: leg.path.length > 1 };
    }
  }
  const off = OFF_MAP_PLACES[placeAt(id, tt)];
  if (off) return { p: null, label: off };
  for (const ab of node.absences){
    if (ab.who === id && tt >= ab.from && tt < ab.to) return { p: null, label: ab.label };
  }
  for (const mv of node.moves){
    if (mv.who !== id) continue;
    for (const leg of mv.legs){
      if (tt >= leg.from && tt <= leg.to) return { p: alongPath(leg.path, (tt-leg.from)/Math.max(1, leg.to-leg.from)),
                                                   onTask: mv.taskId, car: !!mv.car, moving: leg.path.length > 1 };
    }
  }
  // 겹쳐 그린 이동이 끝나도, 기준 일과가 그 자리에 닿을 때까지는 그 자리에 둔다.
  // 차로 먼저 돌아온 사람이 1분 뒤 도로 한복판으로 튀어 가면 안 된다 — 일찍 닿은
  // 사람은 기다리는 것이지 되돌아가는 것이 아니다.
  const base = trackPos(id, tt);
  for (const mv of node.moves){
    if (mv.who !== id || tt <= mv.endAt || tt - mv.endAt > 120) continue;
    const path = mv.legs[mv.legs.length - 1].path;
    const end = path[path.length - 1];
    if (base && Math.hypot(base[0] - end[0], base[1] - end[1]) > 25) return { p: end };
  }
  return { p: base };
}

/* ------------------------------------------------------------- 마커 */
// 얼굴·활동 아이콘·겹침 밀어내기는 마을 본체 시뮬레이터에서 그대로 옮겼다
// (src/features/simulation/components/Marks.tsx, src/features/simulation/positions.ts).
// 얼굴은 번호에서 만들어 낸 도식이다 — 사진도, 실제 주민의 모습도 아니다.
const FACE_BG = ['#dce8e3','#e5e1ed','#f0e1cb','#dae4ed'];
const FACE_SHIRT = ['#557f79','#7b7895','#b38b57','#63819b'];
const FACE_HAIR = ['#726b63','#c3bbb0','#584f48'];
function faceMark(id, x, y, r, ring){
  const n = Number(String(id).replace(/\D/g, '')) || 6;
  const head = PERSON[id] && PERSON[id].job === '이장';
  return '<g transform="translate('+x+' '+y+')">'
    + '<circle r="'+(r*1.16)+'" fill="#fff" stroke="'+(ring || '#cedbd1')+'" stroke-width="'+(r*.12)+'"/>'
    + '<g transform="scale('+(r/20)+') translate(-20 -20)"><g clip-path="url(#fc)">'
    + '<rect width="40" height="40" fill="'+FACE_BG[n%4]+'"/>'
    + '<path d="M8 40 Q9 27 20 27 Q32 27 33 40" fill="'+FACE_SHIRT[n%4]+'"/>'
    + '<ellipse cx="20" cy="19" rx="10" ry="12" fill="#d9b899"/>'
    + '<path d="M10 19 Q7 4 20 5 Q33 5 30 20 L27 12 Q18 15 12 11Z" fill="'+FACE_HAIR[n%3]+'"/>'
    + '<circle cx="16" cy="20" r="1" fill="#343831"/><circle cx="24" cy="20" r="1" fill="#343831"/>'
    + '<path d="M17 26 Q20 28 23 25" fill="none" stroke="#9d7260"/>'
    + (n%2 === 1 ? '<path d="M11 18 H18 V23 H12Z M22 18 H29 V23 H22Z M18 20 H22" fill="none" stroke="#65706d"/>' : '')
    + (head ? '<path d="M10 11 Q20 3 30 11" fill="none" stroke="#6b7970" stroke-width="2"/>' : '')
    + '</g></g></g>';
}
/**
 * 색을 흰색에 섞어 **불투명한** 연한 색을 만든다. 알약을 반투명으로 두면 그 아래
 * 지도 글씨가 비쳐 올라와 마커 안의 번호와 겹쳐 읽힌다.
 */
function tint(hex, a){
  const n = parseInt(hex.slice(1), 16);
  const m = v => Math.round(v * a + 255 * (1 - a)).toString(16).padStart(2, '0');
  return '#' + m(n >> 16 & 255) + m(n >> 8 & 255) + m(n & 255);
}

/** 차 한 대. 몸통 28x16 px — 점이 아니라 차로 읽히는 최소 크기다. */
function carMark(occupied){
  let d = '';
  for (let i = 0; i < occupied; i++)
    d += '<circle cx="'+(-4 + i*4)+'" cy="-13.5" r="1.7" fill="#7A2618" stroke="#7A2618" stroke-width="1"/>';
  return '<rect x="-14" y="-5" width="28" height="11" rx="3" fill="#7A2618" stroke="#3E120B" stroke-width="1.4"/>'
    + '<path d="M -8 -5 L -6 -9.5 L 5 -9.5 L 8 -5 Z" fill="#7A2618" stroke="#3E120B" stroke-width="1.4" stroke-linejoin="round"/>'
    + '<rect x="-6" y="-8.6" width="12" height="3.4" rx="0.8" fill="#F3DDD6"/>'
    + '<circle cx="-8" cy="6" r="3" fill="#1F1210" stroke="#FFFFFF" stroke-width="1"/>'
    + '<circle cx="8" cy="6" r="3" fill="#1F1210" stroke="#FFFFFF" stroke-width="1"/>' + d;
}
const ACT = {
  travel: '<path d="M -4.5 0 L 1.8 0 M 1.8 -2.7 L 4.5 0 L 1.8 2.7" stroke="#1D2935" stroke-width="1.62" '
        + 'fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  task: '<path d="M -3.15 0 L -0.675 2.7 L 3.375 -2.7" stroke="#25665B" stroke-width="1.8" fill="none" '
      + 'stroke-linecap="round" stroke-linejoin="round"/>',
};
/** 겹친 마커를 화면 픽셀에서 밀어 낸다. 누가 누구와 서 있는지는 바뀌지 않는다. */
function spreadOverlaps(marks, minGap){
  const placed = [], outm = new Map();
  for (const mk of [...marks].sort((a, b) => a.top - b.top || a.key.localeCompare(b.key))){
    let left = mk.left, top = mk.top;
    for (let guard = 0; guard < 24; guard++){
      const hit = placed.find(q => Math.hypot(q.left - left, q.top - top) < minGap);
      if (!hit) break;
      const dx = left - hit.left, dy = (top - hit.top) || (dx === 0 ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      left = hit.left + (dx/len)*minGap; top = hit.top + (dy/len)*minGap;
    }
    placed.push({ key: mk.key, left, top });
    outm.set(mk.key, { left, top, moved: Math.hypot(left - mk.left, top - mk.top) > 1 });
  }
  return outm;
}

/* ------------------------------------------------------------- 지도 */
const activeTasks = tt => node.tasks.filter(x => tt >= toMin(x.start) && tt <= toMin(x.end));

// 추출된 도로망은 그리지 않는다 — 지도 래스터에 이미 길이 그려져 있다.
// 사람의 이동은 그래도 그 도로망(다익스트라) 위에서만 일어난다.
function drawMap(){
  const act = activeTasks(t);
  const colorOf = {};
  act.forEach(x => x.actors.forEach(a => { if (!colorOf[a]) colorOf[a] = x.color; }));

  // 지도에 그려 넣는 것의 크기는 전부 화면 픽셀이다. 지도를 키워도 집과 얼굴은
  // 같은 크기로 남고, 커지는 것은 마을뿐이다.
  const k = V.map.width / (document.getElementById('ov').clientWidth || V.map.width);

  let g = '';
  // 이동 경로는 그리지 않는다. 길은 이미 래스터에 그려져 있고, 그 위를 지나는
  // 마커가 곧 경로다 — 선을 한 겹 더 얹으면 지도를 덮을 뿐이다 (본체와 같은 판단).

  // 확인된 집 열두 채. 작은 테두리 하나로 조용히 둔다 — 이름표도, 지붕 그림도 없다.
  // 어느 집에 누가 사는지는 화면에 적지 않는다.
  for (const p of V.people){
    g += '<rect x="'+(p.home.x - 3*k)+'" y="'+(p.home.y - 3*k)+'" width="'+(6*k)+'" height="'+(6*k)+'" '
      + 'rx="'+(1.2*k)+'" fill="#ffffff" stroke="#9aa5b0" stroke-width="'+(1.1*k)+'" '
      + 'style="pointer-events:none"/>';
  }
  // 장소
  for (const pl of V.map.places){
    g += '<g style="pointer-events:none"><circle cx="'+pl.x+'" cy="'+pl.y+'" r="'+(3.6*k)+'" '
      + 'fill="#ffffff" stroke="#596775" stroke-width="'+(1.4*k)+'"/>'
      + '<text class="lab" x="'+(pl.x + 7*k)+'" y="'+(pl.y + 3.6*k)+'" font-size="'+(10*k)+'" '
      + 'stroke-width="'+(2.6*k)+'">'+esc(pl.label)+'</text></g>';
  }
  // 사람 — 마을 본체 시뮬레이터(src/features/simulation/components/VillageMap.tsx)의
  // 마커 규칙을 그대로 옮겼다. 그린 얼굴 하나가 한 사람이고, 한자리에 선 사람들은
  // **마커 하나**로 묶인다. 혼자일 때만 P번호(이장은 '이장')를 적고, 여럿이면 얼굴만
  // 겹쳐 놓는다. 지도 위에 이름은 적지 않는다.
  const out = [], here = [];
  for (const p of V.people){
    const r = posOf(p.id, t);
    if (!r.p) out.push({ id: p.id, why: r.label || placeAt(p.id, t) });
    else here.push({ id: p.id, x: r.p[0], y: r.p[1], moving: !!r.moving, car: !!r.car });
  }
  // 한 자리 = 한 마커. 누가 누구와 서 있는지는 위치가 정하고, 화면은 그것을 가리지만 않는다.
  clusters = [];
  for (const h of here){
    const c0 = clusters.find(q => Math.hypot(q.x - h.x, q.y - h.y) < 3);
    if (c0) c0.members.push(h); else clusters.push({ key: 'c' + clusters.length, x: h.x, y: h.y, members: [h] });
  }
  for (const q of clusters){
    q.x = q.members.reduce((a, m) => a + m.x, 0) / q.members.length;
    q.y = q.members.reduce((a, m) => a + m.y, 0) / q.members.length;
    q.members.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }
  withMe = {};
  for (const q of clusters) for (const m of q.members) {
    withMe[m.id] = q.members.filter(o => o.id !== m.id).map(o => o.id);
  }

  // 겹친 마커는 화면 픽셀 기준으로 밀어 낸다. 진짜 자리는 그대로 두고 실을 남긴다.
  const spread = spreadOverlaps(clusters.map(q => ({ key: q.key, left: q.x / k, top: q.y / k })), 46);

  g += '<defs><clipPath id="fc"><circle cx="20" cy="20" r="20"/></clipPath></defs>';
  for (const q of clusters){
    const s0 = spread.get(q.key);
    const x = s0.left * k, y = s0.top * k;
    q.dx = x; q.dy = y;
    const alone = q.members.length === 1;
    const lead = q.members[0];
    // 진행 중 요청에 걸린 사람은 그 요청 색을 두른다 — 사건 목록·조율 현황과 같은 색.
    const c = q.members.map(m => colorOf[m.id]).find(Boolean) || null;
    const faces = q.members.slice(0, 3);
    const r = (alone ? 10 : 12) * k;
    const step = (faces.length === 2 ? 24 : 12) * k;
    const extra = q.members.length - faces.length;

    // 밀려난 마커는 진짜 자리로 실 한 가닥을 남긴다. 옮긴 것이 다른 장소로 읽히면 안 된다.
    if (s0.moved) g += '<line x1="'+q.x+'" y1="'+q.y+'" x2="'+x+'" y2="'+y+'" stroke="#596775" '
      + 'stroke-width="'+k+'" stroke-dasharray="'+(2*k)+' '+(2*k)+'"/>'
      + '<circle cx="'+q.x+'" cy="'+q.y+'" r="'+(1.8*k)+'" fill="#596775"/>';

    const riding = q.members.filter(m => m.car);

    g += '<g class="mk" data-c="'+q.key+'">';
    // 차는 사람 위에 얹은 표시가 아니라 옆에 놓인 물건이다. 점 하나가 실제로
    // 잡힌 자리 하나다 — 모르는 빈자리를 지어내지 않는다.
    if (riding.length) g += '<g transform="translate('+x+' '+(y + 28*k)+') scale('+k+')">' + carMark(riding.length) + '</g>';
    g += '<rect x="'+(x - (alone ? 13 : 28)*k)+'" y="'+(y - (alone ? 13 : 16)*k)+'" '
      + 'width="'+((alone ? 51 : 56)*k)+'" height="'+((alone ? 26 : 32)*k)+'" rx="'+((alone ? 13 : 16)*k)+'" '
      + 'fill="'+(c ? tint(c, .10) : '#ffffff')+'" stroke="'+(c || '#d6e1d3')+'" '
      + 'stroke-width="'+((c ? 1.8 : 1.2)*k)+'" style="filter:drop-shadow(0 1px 2px #304c3926)"/>';
    // 앞사람이 위로 오게 뒤에서부터 그린다.
    g += faces.map((m, i2) => faceMark(m.id, x + (i2 - (faces.length-1)/2) * step, y, r,
                                       i2 === faces.length - 1 ? c : null)).reverse().join('');
    if (extra > 0) g += '<circle cx="'+(x + (faces.length/2)*step + 3*k)+'" cy="'+(y - r*0.6)+'" '
      + 'r="'+(7.5*k)+'" fill="#1D2935"/><text class="xn" x="'+(x + (faces.length/2)*step + 3*k)+'" '
      + 'y="'+(y - r*0.6 + 3.6*k)+'" font-size="'+(9*k)+'">+'+extra+'</text>';
    // 하는 일 표시는 한 마커에 하나뿐이다. 열둘을 범례로 만들지 않는다.
    const kind = lead.moving ? 'travel' : (c ? 'task' : null);
    if (kind) g += '<g transform="translate('+(x + r*(alone ? 0.85 : 1.05))+' '
      + (y - (alone ? r + 2*k : r*0.9))+') scale('+k+')">'
      + '<circle r="7" fill="#fff" stroke="#DDE3E8"/>' + ACT[kind] + '</g>';
    // 혼자면 이름 대신 번호까지만. 여럿이면 아무 글자도 적지 않는다.
    if (alone) g += '<text class="pid" x="'+(x + 14*k)+'" y="'+(y + 3.5*k)+'" '
      + 'font-size="'+(10*k)+'">'+(PERSON[lead.id].job === '이장' ? '이장' : lead.id)+'</text>';
    g += '</g>';
  }
  const ov = document.getElementById('ov');
  ov.setAttribute('viewBox', '0 0 ' + V.map.width + ' ' + V.map.height);
  ov.innerHTML = g;

  const chips = [];
  for (const x of act) if (!chips.some(c => c.quest === x.quest)) chips.push(x);
  document.getElementById('corner').innerHTML =
    chips.map(x => '<span class="chip" style="border-color:'+x.color+';color:'+x.color+'">진행 중 · ' + esc(x.quest) + '</span>').join('');

  // 마을을 벗어나 있는 사람은 지도 위가 아니라 지도 밖에 적는다.
  document.getElementById('offmap').innerHTML = out.length
    ? '<span class="k">지금 마을 밖에 있는 사람</span>'
      + out.map(o => '<span class="who2">' + esc(label(o.id)) + '<span>' + esc(o.why) + '</span></span>').join('')
      + '<span class="note">마을 밖은 이 지도에 좌표가 없어 목록으로만 적습니다. 지도 여백에 임의로 놓지 않습니다.</span>'
    : '<span class="k">마을 밖에 나가 있는 사람 없음</span>';
}

/* ------------------------------------------------------------- 호버 */
const placeAt = (id, tt) => {
  const i = Math.max(0, Math.min(V.place[id].length - 1, Math.round((tt - V.clock.start) / V.clock.step)));
  return V.place[id][i];
};
const tip = document.getElementById('tip');
/** 그 사람이 지금 걸려 있는 요청. */
const nowTasks = (id) => node.tasks.filter(x => (x.actors.includes(id) || x.about === id)
  && t >= toMin(x.start) && t <= toMin(x.end));

function personCard(id){
  const p = PERSON[id];
  const mine = node.tasks.filter(x => x.actors.includes(id) || x.about === id);
  const now = nowTasks(id);
  return '<b>' + esc(label(id)) + '</b> <i>' + p.age + '세 · ' + esc(p.job || '') + '</i>'
    + '<div class="r1">지금 ' + esc(placeAt(id, t)) + '</div>'
    + '<div class="r2">' + esc(p.group) + '</div>'
    + (withMe[id] && withMe[id].length
        ? '<div class="r4">같이 있는 사람 · ' + withMe[id].map(o => esc(label(o))).join(', ') + '</div>'
        : '<div class="r2">지금 곁에 아무도 없다</div>')
    + (now.length
        ? now.map(x => '<div class="r3" style="color:'+x.color+'">' + esc(x.quest) + ' · ' + esc(x.title) + '</div>').join('')
        : (mine.length ? '<div class="r2">오늘 겪은 일 ' + mine.length + '건</div>' : '<div class="r2">오늘 이 서비스와 아무 일도 없었다</div>'));
}

/** 마커 하나에 여럿이면 누가 같이 있는지를 먼저 보여 준다. */
function groupCard(q){
  return '<b>여기 ' + q.members.length + '명</b> <i>' + esc(placeAt(q.members[0].id, t)) + '</i>'
    + q.members.map(m => {
        const now = nowTasks(m.id);
        return '<div class="r4">' + esc(label(m.id))
          + (now.length
              ? ' <span style="color:'+now[0].color+';filter:brightness(1.7);font-weight:800">' + esc(now[0].quest) + '</span>'
              : ' <span style="opacity:.6">' + PERSON[m.id].age + '세 · ' + esc(PERSON[m.id].job || '') + '</span>')
          + '</div>';
      }).join('');
}

function showTip(key, ev){
  const q = clusters.find(c => c.key === key);
  if (!q) { tip.classList.remove('on'); return; }
  tip.innerHTML = q.members.length === 1 ? personCard(q.members[0].id) : groupCard(q);
  tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 16, y = ev.clientY - 12;
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 16;
  if (y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
document.getElementById('ov').addEventListener('mousemove', e => {
  const g = e.target.closest('.mk');
  if (g) showTip(g.dataset.c, e); else tip.classList.remove('on');
});
document.getElementById('ov').addEventListener('mouseleave', () => tip.classList.remove('on'));

/* ------------------------------------------------------------- 대화록 재생 */
/** 그 장면의 대사는 task가 도는 시간에 고르게 흩어져 나온다. */
function linesShown(task){
  const tr = (V.scenes[node.key] || {transcripts:{}}).transcripts[task.id];
  const lines = (tr && tr.lines) || [];
  const a = toMin(task.start), b = toMin(task.end);
  if (t >= b) return lines.length;
  if (t < a) return 0;
  return Math.min(lines.length, Math.floor((t - a) / Math.max(1, b - a) * lines.length) + 1);
}

function eventHtml(task){
  const scene = V.scenes[node.key] || {transcripts:{}};
  const tr = scene.transcripts[task.id];
  const lines = (tr && tr.lines) || [];
  const shown = linesShown(task);
  const live = t >= toMin(task.start) && t <= toMin(task.end);
  return '<div class="ev'+(live?' now':'')+'" data-task="'+task.id+'">'
    + '<div class="h"><div class="dot" style="background:'+task.color+'"></div>'
    + '<div class="time">'+task.start+'</div>'
    + '<div class="grow"><div class="et">'+esc(task.title)+'</div>'
    + '<div class="em">'+esc(task.quest)+' · '+esc(task.channel)+'<br>'+task.actors.map(a=>esc(label(a))).join(', ')+'</div></div>'
    + '<span class="pill '+(live?'live':task.outcome)+'">'+(live?'진행 중':(WORD[task.outcome]||task.outcome))+'</span>'
    + '<span class="caret">▾</span></div>'
    + '<div class="b">'
    + '<div class="facts"><b>규칙이 정한 것</b><ul>'+task.facts.map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul></div>'
    + lines.slice(0, shown).map(l =>
        '<div class="line'+(l.speaker==='MED'?' med':'')+'"><div class="who">'+esc(label(l.speaker))+'</div><div class="say">'+esc(l.text)+'</div></div>').join('')
    + '</div></div>';
}

let evSig = '';
function renderEvents(){
  const started = node.tasks.filter(x => toMin(x.start) <= t);
  const sig = started.map(x => x.id + ':' + linesShown(x) + ':' + (t <= toMin(x.end) ? 'L' : 'E')).join('|') + '|' + openIds().join(',');
  if (sig === evSig) return;
  evSig = sig;
  const box = document.getElementById('body-ev');
  const keep = new Set(openIds());
  box.innerHTML = started.length
    ? started.map(eventHtml).join('')
    : '<div class="facts">아직 아무 일도 일어나지 않았습니다.</div>';
  box.querySelectorAll('.ev').forEach(el => {
    if (keep.has(el.dataset.task)) el.classList.add('open');
    el.querySelector('.h').onclick = () => el.classList.toggle('open');
  });
  const live = box.querySelector('.ev.now');
  if (live) live.scrollIntoView({ block: 'nearest' });
  document.getElementById('n-ev').textContent = started.length;
}
function openIds(){
  return [...document.querySelectorAll('#body-ev .ev.open')].map(el => el.dataset.task);
}

/* ------------------------------------------------------------- 조율 현황 */
let dbSig = '';
function renderDash(){
  const live = node.dashboard.filter(q => toMin(q.startAt) <= t);
  const sig = live.map(q => q.questId + (t <= toMin(q.endAt) ? 'L' : 'E')).join('|');
  if (sig === dbSig) return;
  dbSig = sig;
  const changed = node.choice.kind === 'change' ? node.choice.ruleType : null;
  document.getElementById('body-db').innerHTML = live.map(q => {
    const running = t <= toMin(q.endAt);
    return '<div class="q"><div class="qh"><div class="dot" style="background:'+q.color+'"></div>'
    + '<div class="ql">'+esc(q.label)+(q.about?' · '+esc(label(q.about)):'')+'</div><span class="grow"></span>'
    + '<span class="pill '+(running?'live':q.outcome)+'">'+(running?'진행 중':(WORD[q.outcome]||q.outcome))+'</span></div>'
    + [['관측',q.observed],['판단',q.judged],['조율',q.coordinated],['결과',running?[]:q.result]]
        .filter(([,v]) => v && v.length)
        .map(([k,v]) => '<div class="kv"><b>'+k+'</b><ul>'+v.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>').join('')
    + '</div>';
  }).join('')
  + '<details class="rules"><summary>지금 적용 중인 운영 규칙 9개'+(changed?' — 어제 하나를 고쳤다':'')+'</summary>'
  + node.policy.map(r => '<div class="rule'+(r.ruleType===changed?' chg':'')+'"><b>'+esc(r.label)+'</b><span>'+esc(r.sentence)+'</span></div>').join('')
  + '</details>';
  document.getElementById('n-db').textContent = live.length;
}

/* ------------------------------------------------------------- 타임라인 */
function drawBars(){
  const {start, end} = V.clock, span = end - start;
  const quests = [...new Set(node.tasks.map(x => x.questId))];
  let h = '';
  node.tasks.forEach(x => {
    const a = (toMin(x.start)-start)/span*100, b = (toMin(x.end)-start)/span*100;
    h += '<div class="row" style="left:'+a+'%;width:'+Math.max(0.6,b-a)+'%;top:'+(quests.indexOf(x.questId)*11)+'px;background:'+x.color+'"></div>';
  });
  h += '<div class="axis"></div>';
  for (let m = start; m <= end; m += 120) h += '<div class="tick" style="left:'+((m-start)/span*100)+'%">'+hhmm(m)+'</div>';
  h += '<div class="cursor" id="cursor" style="left:'+((t-start)/span*100)+'%"></div>';
  document.getElementById('bars').innerHTML = h;
}
const moveCursor = () => {
  const c = document.getElementById('cursor');
  if (c) c.style.left = ((t-V.clock.start)/(V.clock.end-V.clock.start)*100) + '%';
};

/* ------------------------------------------------------------- 재생 */
// 하루는 타임라인 끝(22:00)까지 간다. 마지막 사건이 끝났다고 시계를 멈추지 않는다.
const dayEnd = () => V.clock.end;

/**
 * task가 도는 동안은 **대사 한 줄이 읽힐 만큼** 천천히 흐르고, 아무 일도 없는 시간은 빨리 감는다.
 * 그래서 속도는 분/초가 아니라 '대사 한 줄에 몇 초'로 잡는다.
 */
const GAP_RATE = 240;
function rateAt(tt){
  const act = activeTasks(tt);
  if (!act.length) {
    const next = node.tasks.map(x => toMin(x.start)).filter(s => s > tt).sort((a,b)=>a-b)[0];
    return (next !== undefined && next - tt < 8) ? 6 : GAP_RATE;
  }
  let slowest = GAP_RATE;
  for (const x of act){
    const tr = (V.scenes[node.key] || {transcripts:{}}).transcripts[x.id];
    const n = Math.max(1, ((tr && tr.lines) || []).length);
    const span = Math.max(1, toMin(x.end) - toMin(x.start));
    slowest = Math.min(slowest, span / (n * secPerLine));
  }
  return Math.max(0.3, slowest);
}

function tick(ts){
  if (!playing) return;
  const dt = lastTs ? Math.min(0.1, (ts - lastTs)/1000) : 0;
  lastTs = ts;
  t += dt * rateAt(t);
  if (t >= dayEnd()){ t = dayEnd(); setPlaying(false); render(); showEndbar(); return; }
  render();
  raf = requestAnimationFrame(tick);
}
function setPlaying(on){
  playing = on; lastTs = 0;
  document.getElementById('play').textContent = on ? '❚❚' : '▶';
  if (on) raf = requestAnimationFrame(tick); else if (raf) cancelAnimationFrame(raf);
}
function render(){
  document.getElementById('clock').textContent = hhmm(t);
  document.getElementById('daychip').textContent = node.day + '일차';
  drawMap(); renderEvents(); renderDash(); moveCursor();
}

/* ------------------------------------------------------------- 하루 끝 */
function showEndbar(){
  const m = node.metrics;
  document.getElementById('endt').textContent = node.day + '일차가 끝났습니다';
  document.getElementById('ends').textContent =
    '오늘 요청 ' + node.dashboard.length + '건 · '
    + (m.resolveMinutes != null ? '확인까지 ' + m.resolveMinutes + '분 · ' : '')
    + '이장이 받은 부탁 ' + m.headAsks + '번 · 거절 ' + m.refusals + '번';
  document.getElementById('endbar').classList.add('on');
}
const hideEndbar = () => document.getElementById('endbar').classList.remove('on');

/* ------------------------------------------------------------- 전면 화면 */
const full = document.getElementById('full'), pad = document.getElementById('full-pad');
const openFull = html => { pad.innerHTML = html; full.classList.add('on'); full.scrollTop = 0; };
const closeFull = () => full.classList.remove('on');

function showPick0(){
  openFull('<div class="kick">전시 시작 · 첫 배포 설정</div><h1>MEDial을 어떤 규칙으로 처음 켤 것인가</h1>'
    + '<p class="sub">같은 마을, 같은 사건입니다. 다른 것은 MEDial이 따르는 운영 규칙뿐입니다. 사흘 동안 날마다 하나씩 고쳐 갑니다.</p>'
    + '<div class="cards">' + V.initial.map((p,i) =>
        '<button class="card" data-pick="'+i+'"><div class="cl">설정 '+(i+1)+'</div><div class="ct">'+esc(p.name)+'</div><div class="cw">'+esc(p.rationale)+'</div></button>').join('')
    + '</div>');
}

function showReview(){
  hideEndbar();
  const scene = V.scenes[node.key] || {reviews:[]};
  const said = Object.fromEntries((scene.reviews||[]).map(r => [r.speaker, r.text]));
  // 날이 끝날 때까지 마을에 돌아오지 못한 사람은 한마디를 남기지 못한다.
  // 실려 간 사람에게 그날 서비스가 어땠는지 묻는 화면은 만들지 않는다.
  const away = Object.fromEntries(node.absences.filter(a => a.to > V.clock.end).map(a => [a.who, a]));
  const rows = V.people.map(p => {
    const mine = node.tasks.filter(x => x.actors.includes(p.id) || x.about === p.id);
    const a = away[p.id] || null;
    return { id: p.id, mine, out: a ? a.label : null,
             gone: a && a.silent ? a.label : null,
             text: a && a.silent ? null : (said[p.id] || null) };
  });
  rows.sort((a,b) => (b.mine.length>0) - (a.mine.length>0));
  openFull('<div class="kick">'+node.day+'일차가 끝났습니다</div><h1>주민 평가</h1>'
    + '<p class="sub">각자 <b>자기가 겪은 일만</b> 근거로 말합니다. 겪지 않은 사람은 아래에 따로 두고, 불만족으로 세지 않습니다. 점수도 순위도 매기지 않습니다.</p>'
    + '<div class="rev">' + rows.map(r => r.mine.length
        ? '<div class="r"><div class="pid2">'+esc(label(r.id))+'</div><span class="tag'+(r.text?'':' q')+'">'+(r.text?'겪음 '+r.mine.length+'건':'평가 없음')+'</span><div class="grow"><div class="rv'+(r.text?'':' rx')+'">'+esc(r.text || (r.gone
              ? '이 사람은 이날 일의 당사자이지만 ' + r.gone + '으로 마을에 없어 한마디를 남기지 못했습니다. 비어 있는 것을 만족으로도 불만족으로도 세지 않습니다.'
              : '이 사람은 이날 일의 당사자이지만 한마디를 남기지 못했습니다. 비어 있는 것을 만족으로도 불만족으로도 세지 않습니다.'))+'</div>'
          + '<div class="rx">'+r.mine.map(x=>x.start+' '+esc(x.title)).join(' · ')
          + (r.out && !r.gone ? ' · 지금 마을 밖 (' + esc(r.out) + ')' : '')+'</div></div></div>'
        : '<div class="r none"><div class="pid2">'+esc(label(r.id))+'</div><span class="tag n">미경험</span><div class="grow"><div class="rx">오늘 이 서비스와 아무 일도 겪지 않았습니다.</div></div></div>').join('')
    + '</div>'
    + '<p class="sub" style="margin-top:14px;font-size:13px">합성 평가입니다. 실제 주민의 만족도나 동의가 아니며, 나중에 실제 주민이 확인·반박할 대상입니다.</p>'
    + '<div class="row"><button class="btn" id="to-choose">'+(node.options.length ? '이 평가를 보고 무엇을 고칠지 고른다' : '사흘을 마친다')+'</button></div>');
  document.getElementById('to-choose').onclick = () => node.options.length ? showChoose() : showEnd();
}

// 고른 규칙이 걸릴 자리가 있었는지 없었는지는 화면에서 말하지 않는다. 고르기 전에 말하려면
// 내일을 미리 알아야 하는데 그건 미리 계산해 둔 이 데모만 할 수 있는 일이고, 하루가 끝난 뒤에
// 말하는 것도 화면을 규칙 설명으로 만들 뿐이라 둘 다 뺐다 (2026-09-23, 연구자 판단).
function showChoose(){
  openFull('<div class="kick">'+node.day+'일차 → '+(node.day+1)+'일차 · 수정안 고르기</div><h1>무엇을 고칠 것인가</h1>'
    + '<p class="sub">오늘 주민들이 겪은 일에서 나온 세 가지입니다. 하나만 고를 수 있고, 고른 것이 내일의 규칙이 됩니다. 나머지 조건은 그대로 둡니다.</p>'
    + '<div class="cards">' + node.options.map((o,i) =>
        '<button class="card" data-pick="'+i+'"><div class="cl">'+esc(o.label)+'</div><div class="ct">'+esc(o.title)+'</div>'
        + '<div class="cw">'+esc(o.because)+'</div>'
        + '<div class="cd"><div class="b">'+esc(o.beforeSentence)+'</div><div class="a">'+esc(o.afterSentence)+'</div></div>'
        + '</button>').join('')
    + '</div>');
}

function showEnd(){
  const path = [byId[String(pick[0])], byId[pick.slice(0,2).join('-')], byId[pick.join('-')]];
  const idx = V.nodes.filter(n=>n.day===3).findIndex(n=>n.id===pick.join('-')) + 1;
  // 기관 인계는 그날 실제로 인계된 task에서 읽는다. 지표 하나만 보고 '없음'이라고
  // 적으면, 바로 옆 사건 목록에 구급대 인계가 적혀 있는 것과 어긋난다.
  const handoff = n => {
    const hs = n.tasks.filter(x => x.outcome === 'handed_off');
    if (!hs.length) return '없음';
    const who = new Set();
    for (const x of hs) for (const a of x.actors) if (V.roles[a] && V.roles[a] !== 'MEDial') who.add(V.roles[a]);
    return who.size ? [...who].join(' · ') : '있음';
  };
  const fmt = n => [n.metrics.resolveMinutes==null?'—':n.metrics.resolveMinutes+'분', n.metrics.headAsks+'번',
                    n.metrics.refusals+'번', handoff(n), n.metrics.rideRefused?'실패':'—'];
  openFull('<div class="kick">사흘이 끝났습니다</div><h1>고른 것과, 마을이 어떻게 됐는지</h1>'
    + '<p class="sub">27가지 경로 가운데 '+idx+'번째입니다. 이 결과는 미리 계산해 둔 것이고, 실시간 모델 호출은 없습니다.</p>'
    + '<table><tr><th>날</th><th>그날 고른 것</th><th>확인까지</th><th>이장이 받은 부탁</th><th>거절</th><th>기관 인계</th><th>동승 주선</th></tr>'
    + path.map((n,i) => '<tr><td><b>'+n.day+'일차</b><div class="rx">'+esc(n.title)+'</div></td><td>'+esc(i===0 ? V.initial[pick[0]].name : n.choice.title)+'</td>'
        + fmt(n).map(v=>'<td>'+esc(v)+'</td>').join('') + '</tr>').join('')
    + '</table>'
    + '<div class="row"><button class="btn" id="again">처음부터 다른 길로</button></div>');
  document.getElementById('again').onclick = () => { pick = []; showPick0(); };
}

/* ------------------------------------------------------------- 진행 */
function startDay(){
  node = byId[pick.join('-')];
  t = V.clock.start;
  evSig = ''; dbSig = '';
  closeFull(); hideEndbar();
  drawBars(); render();
  setPlaying(true);
}

document.addEventListener('click', e => {
  const p = e.target.closest('[data-pick]');
  if (p){ pick.push(+p.dataset.pick); startDay(); }
});
document.getElementById('toreview').onclick = showReview;
document.getElementById('play').onclick = () => setPlaying(!playing);
document.getElementById('bars').onclick = e => {
  const r = e.currentTarget.getBoundingClientRect();
  const u = Math.max(0, Math.min(1, (e.clientX - r.left)/r.width));
  t = V.clock.start + u*(V.clock.end - V.clock.start);
  evSig = ''; dbSig = '';
  if (t < dayEnd()) hideEndbar();
  render();
};
document.getElementById('speeds').innerHTML = [[1.8,'천천히'],[1.0,'보통'],[0.55,'빠르게']]
  .map(([s,l]) => '<button data-speed="'+s+'"'+(s===secPerLine?' class="on"':'')+'>'+l+'</button>').join('');
document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => {
  secPerLine = +b.dataset.speed;
  document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', x === b));
});

node = byId['0'];
drawBars(); render();
showPick0();
</script>
</body>
</html>
`;

const outPath = path.join(OUT, 'eunjeom-exhibition.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`${outPath} — ${(html.length / 1024 / 1024).toFixed(2)} MB`);
