// 보고용 대화록 뷰어를 만든다.  node exhibition/build-reader.mjs
//
// 전시 화면(build-html.mjs)과 **같은 bundle.json** 을 읽는다. 둘이 다른 데이터를 들고 있으면
// 교수님께 보여 드리는 대화록과 벽 화면이 어긋난다 — 예전에 실제로 그랬다.
// 여기서는 지도가 필요 없으므로 래스터·위치표는 빼고 싣는다.
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './gemini.mjs';

const SHELL = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>은점마을 사흘 · 27경로</title>
<style>
  :root{
    --paper:#ffffff; --ink:#111111; --muted:#6b6b6b; --rule:#e2e2e2; --fill:#f6f6f6;
    --med:#1d4ed8; --medbg:#eef2ff; --warn:#b45309; --bad:#b91c1c; --good:#15803d;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    background:#ededed;color:var(--ink);word-break:keep-all;line-height:1.6;
    font-family:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:1180px;margin:0 auto;padding:0 20px 80px}
  header{background:var(--paper);border-bottom:1px solid var(--rule);padding:22px 0 18px;margin-bottom:22px}
  header .wrap{padding-bottom:0}
  h1{font-size:26px;font-weight:800;letter-spacing:-.02em}
  .sub{color:var(--muted);font-size:14px;margin-top:6px}
  .badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .badge{font-size:12px;font-weight:700;padding:4px 10px;border:1px solid var(--rule);border-radius:999px;background:var(--fill);color:var(--muted)}
  .badge.alert{background:#fff7ed;border-color:#fed7aa;color:var(--warn)}

  .card{background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:20px 22px;margin-bottom:16px}
  .card h2{font-size:19px;font-weight:800;letter-spacing:-.01em}
  .card h3{font-size:14px;font-weight:800;color:var(--muted);letter-spacing:.02em;margin-bottom:10px}

  /* 경로 표시 */
  .path{display:flex;align-items:stretch;gap:0;flex-wrap:wrap;margin-bottom:18px}
  .step{flex:1 1 0;min-width:190px;background:var(--paper);border:1px solid var(--rule);padding:12px 14px;cursor:pointer}
  .step:first-child{border-radius:12px 0 0 12px}
  .step:last-child{border-radius:0 12px 12px 0}
  .step+.step{border-left:none}
  .step .n{font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.08em}
  .step .t{font-size:14px;font-weight:700;margin-top:3px}
  .step.done{background:var(--fill)}
  .step.now{border-color:var(--ink);box-shadow:inset 0 -3px 0 var(--ink);background:var(--paper)}
  .step.todo{color:#b4b4b4}
  .step.todo .t{font-weight:500}

  /* 지표 */
  .metrics{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 4px}
  .metric{border:1px solid var(--rule);border-radius:10px;padding:9px 13px;min-width:112px;background:var(--fill)}
  .metric .k{font-size:11px;color:var(--muted);font-weight:700}
  .metric .v{font-size:19px;font-weight:800;letter-spacing:-.02em;margin-top:2px}
  .metric.bad .v{color:var(--bad)} .metric.good .v{color:var(--good)} .metric.warn .v{color:var(--warn)}

  /* 규칙 */
  details.rules{margin-top:12px;border-top:1px solid var(--rule);padding-top:10px}
  details.rules summary{cursor:pointer;font-size:13px;font-weight:700;color:var(--muted)}
  .rule{display:flex;gap:10px;font-size:13.5px;padding:5px 0;border-bottom:1px dotted var(--rule)}
  .rule b{flex:0 0 150px;color:var(--muted);font-weight:700}
  .rule.changed{background:#fffbeb}
  .rule.changed b{color:var(--warn)}

  /* task */
  .task{border:1px solid var(--rule);border-radius:12px;margin-bottom:12px;overflow:hidden;background:var(--paper)}
  .task>.head{display:flex;gap:12px;align-items:baseline;padding:14px 16px;cursor:pointer}
  .task>.head:hover{background:var(--fill)}
  .time{font-variant-numeric:tabular-nums;font-weight:800;font-size:13px;color:var(--muted);flex:0 0 96px}
  .ttitle{font-size:16px;font-weight:800;letter-spacing:-.01em}
  .tmeta{font-size:12.5px;color:var(--muted);margin-top:3px}
  .pill{font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;border:1px solid var(--rule);color:var(--muted);white-space:nowrap}
  .pill.done{background:#f0fdf4;border-color:#bbf7d0;color:var(--good)}
  .pill.refused,.pill.unresolved{background:#fef2f2;border-color:#fecaca;color:var(--bad)}
  .pill.no_answer{background:#fff7ed;border-color:#fed7aa;color:var(--warn)}
  .pill.handed_off{background:#eff6ff;border-color:#bfdbfe;color:var(--med)}
  .grow{flex:1 1 auto;min-width:0}
  .task .body{display:none;padding:0 16px 16px 16px;border-top:1px dashed var(--rule)}
  .task.open .body{display:block}
  .facts{font-size:12.5px;color:var(--muted);background:var(--fill);border-radius:8px;padding:10px 12px;margin:12px 0}
  .facts li{margin-left:16px}
  .line{display:flex;gap:10px;padding:5px 0;font-size:15px}
  .who{flex:0 0 78px;text-align:right;font-weight:800;color:var(--muted);font-size:13.5px;padding-top:2px}
  .line.medial .who{color:var(--med)}
  .line.medial .say{background:var(--medbg);border-radius:8px;padding:3px 10px}
  .say{padding:2px 0}

  /* 주민 한마디 */
  .review{display:flex;gap:10px;padding:8px 0;border-bottom:1px dotted var(--rule);font-size:14.5px}
  .review .who{flex:0 0 78px}

  /* 개선안 */
  .options{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px}
  .opt{border:1px solid var(--rule);border-radius:12px;padding:16px;cursor:pointer;background:var(--paper);text-align:left;font:inherit}
  .opt:hover{border-color:var(--ink);background:var(--fill)}
  .opt .lab{font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.04em}
  .opt .t{font-size:15.5px;font-weight:800;margin:6px 0 8px;letter-spacing:-.01em}
  .opt .why{font-size:13px;color:var(--muted)}
  .opt .delta{font-size:12.5px;margin-top:10px;border-top:1px solid var(--rule);padding-top:8px}
  .opt .delta .b{color:#9a9a9a;text-decoration:line-through}
  .opt .delta .a{font-weight:700}
  .opt.picked{border-color:var(--ink);background:var(--fill)}

  .end{text-align:center;padding:26px}
  .btn{font:inherit;font-weight:700;font-size:14px;padding:9px 18px;border:1px solid var(--ink);background:var(--paper);border-radius:999px;cursor:pointer}
  .btn:hover{background:var(--ink);color:var(--paper)}
  .btn.ghost{border-color:var(--rule);color:var(--muted)}
  .row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}

  /* 전체 트리 */
  .tree{font-size:12.5px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  .tree ul{list-style:none} .tree li{padding:2px 0}
  .tree .lv1{font-weight:800} .tree .lv2{margin-left:12px} .tree .lv3{margin-left:24px;color:var(--muted)}
  .tree a{color:inherit;cursor:pointer;text-decoration:none;border-bottom:1px solid transparent}
  .tree a:hover{border-bottom-color:var(--ink)}
  .tree a.here{background:#fef08a}
  @media (max-width:880px){.options,.tree{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><div class="wrap">
  <h1>은점마을 사흘 — 운영 규칙을 고르면 하루가 달라진다</h1>
  <div class="sub">인터뷰 전수 채록에서 뽑은 열두 사람의 마을에, AI 돌봄 조율자(MEDial)를 넣고 사흘을 돌린다.
    날마다 연구자가 운영 규칙 하나를 고르고, 그 선택이 다음 날을 바꾼다. 갈림길 3 × 3 × 3 = <b>27경로</b>.</div>
  <div class="badges">
    <span class="badge alert">합성 대화 — 실제 주민의 발언·만족도가 아니다</span>
    <span class="badge" id="b-model"></span>
    <span class="badge">사람의 이름은 가명</span>
    <span class="badge">이동·일과·수락/거절은 규칙이 정하고, 모델은 말만 쓴다</span>
    <span class="badge">이건 일어날 수 있는 일 중 일부입니다</span>
  </div>
</div></header>

<div class="wrap">
  <div class="path" id="path"></div>
  <div id="main"></div>
  <div class="card">
    <h3>27경로 전체</h3>
    <div class="tree" id="tree"></div>
  </div>
</div>

<script id="data" type="application/json">__DATA__</script>
<script>
const B = JSON.parse(document.getElementById('data').textContent);
const NAME = Object.assign({}, B.roles);
B.people.forEach(p => NAME[p.id] = p.name);
document.getElementById('b-model').textContent = '모델 ' + B.model;

const byId = Object.fromEntries(B.nodes.map(n => [n.id, n]));
let pick = [];                         // [초기안, 개선안1, 개선안2]
const nodeId = (p) => p.join('-');
const esc = (s) => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

function outcomeWord(o){
  return {done:'해결', accepted:'수락', refused:'거절', no_answer:'응답 없음', unresolved:'미해결', handed_off:'기관 인계'}[o] || o;
}
function typeWord(t){
  return {contact:'연락', request_help:'도움 요청', arrange_transport:'이동 주선', escalate_handoff:'기관 인계', notify_close:'결과 통보'}[t] || t;
}

/* ------------------------------------------------------------------ 경로 막대 */
function renderPath(){
  const steps = [
    {n:'1일차', t: pick.length>0 ? B.initial[pick[0]].name : '첫 배포 설정을 고른다'},
    {n:'2일차', t: pick.length>1 ? byId[nodeId(pick.slice(0,2))].choice.title : '1일차를 보고 규칙을 고친다'},
    {n:'3일차', t: pick.length>2 ? byId[nodeId(pick)].choice.title : '2일차를 보고 규칙을 고친다'},
  ];
  document.getElementById('path').innerHTML = steps.map((s,i) => {
    const cls = pick.length === i ? 'now' : pick.length > i ? 'done' : 'todo';
    return '<div class="step '+cls+'" data-back="'+i+'"><div class="n">'+s.n+'</div><div class="t">'+esc(s.t)+'</div></div>';
  }).join('');
  document.querySelectorAll('.step[data-back]').forEach(el => el.onclick = () => {
    const i = +el.dataset.back;
    if (i < pick.length) { pick = pick.slice(0, i); render(); }
  });
}

/* ------------------------------------------------------------------ 지표 */
function handoffWord(node){
  const hs = node.tasks.filter(x => x.outcome === 'handed_off');
  if (!hs.length) return null;
  const who = new Set();
  for (const x of hs) for (const a of x.actors) if (B.roles[a] && B.roles[a] !== 'MEDial') who.add(B.roles[a]);
  return who.size ? [...who].join(' · ') : '있음';
}
function metricsHtml(node){
  const m = node.metrics;
  const items = [];
  if (m.resolveMinutes != null) items.push(['확인까지', m.resolveMinutes + '분', m.resolveMinutes > 90 ? 'bad' : m.resolveMinutes > 50 ? 'warn' : 'good']);
  items.push(['이장이 받은 부탁', m.headAsks + '번', m.headAsks >= 2 ? 'warn' : '']);
  items.push(['거절', m.refusals + '번', m.refusals >= 2 ? 'warn' : '']);
  const ho = handoffWord(node);
  items.push(['기관 인계', ho || '없음', ho ? 'warn' : '']);
  if (m.pastDeadline) items.push(['인계 기한', '넘김', 'warn']);
  if (m.rideRefused !== undefined && m.rideRefused) items.push(['동승 주선', '실패', 'bad']);
  if (m.subjectUpset) items.push(['대상자 반응', '불쾌', 'bad']);
  const load = Object.entries(m.helperLoad || {}).sort((a,b)=>b[1]-a[1]);
  if (load.length) items.push(['부탁이 간 사람', load.map(([id,c]) => (NAME[id]||id)+' '+c).join(' · '), '']);
  return '<div class="metrics">' + items.map(([k,v,c]) =>
    '<div class="metric '+(c||'')+'"><div class="k">'+k+'</div><div class="v" style="'+(String(v).length>10?'font-size:13px;line-height:1.5':'')+'">'+esc(v)+'</div></div>').join('') + '</div>';
}

/* ------------------------------------------------------------------ 규칙 */
function rulesHtml(node, prev){
  const changed = node.choice.kind === 'change' ? node.choice.ruleType : null;
  return '<details class="rules"'+(changed?' open':'')+'><summary>이날 MEDial이 따르는 운영 규칙 9개'+(changed?' — 어제 하나를 고쳤다':'')+'</summary>'
    + node.policy.map(r => '<div class="rule'+(r.ruleType===changed?' changed':'')+'"><b>'+esc(r.label)+'</b><span>'+esc(r.sentence)+'</span></div>').join('')
    + '</details>';
}

/* ------------------------------------------------------------------ task */
function taskHtml(t, tr){
  const lines = (tr && tr.lines || []).map(l => {
    const who = NAME[l.speaker] || l.speaker;
    return '<div class="line'+(l.speaker==='MED'?' medial':'')+'"><div class="who">'+esc(who)+'</div><div class="say">'+esc(l.text)+'</div></div>';
  }).join('');
  return '<div class="task"><div class="head">'
    + '<div class="time">'+t.start+'–'+t.end+'</div>'
    + '<div class="grow"><div class="ttitle">'+esc(t.title)+'</div>'
    + '<div class="tmeta">'+typeWord(t.type)+' · '+esc(t.channel)+' · '+t.actors.map(a=>esc(NAME[a]||a)).join(', ')+'</div></div>'
    + '<span class="pill '+t.outcome+'">'+outcomeWord(t.outcome)+'</span></div>'
    + '<div class="body">'
    + '<div class="facts"><b>규칙이 정한 것</b><ul>'+t.facts.filter(f=>!/^※/.test(f)).map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul></div>'
    + (t.facts.some(f=>/^※/.test(f))
        ? '<details class="rules"><summary>※ 모델에게만 준 연기 지시 — 세계의 사실이 아니다</summary><div class="facts"><ul>'
          + t.facts.filter(f=>/^※/.test(f)).map(f=>'<li>'+esc(f.replace(/^※\s*/,''))+'</li>').join('') + '</ul></div></details>'
        : '')
    + (lines || '<div class="facts">대화록이 아직 생성되지 않았다.</div>')
    + '</div></div>';
}

/* ------------------------------------------------------------------ 본문 */
function render(){
  renderPath();
  renderTree();
  const main = document.getElementById('main');

  if (pick.length === 0){
    main.innerHTML = '<div class="card"><h2>첫 배포 설정을 고른다</h2>'
      + '<p class="sub" style="margin-bottom:4px">같은 마을, 같은 사건이다. 다른 것은 MEDial이 따르는 규칙뿐이다.</p>'
      + '<div class="options">' + B.initial.map((p,i) =>
          '<button class="opt" data-pick="'+i+'"><div class="lab">설정 '+(i+1)+'</div><div class="t">'+esc(p.name)+'</div>'
          + '<div class="why">'+esc(p.rationale)+'</div></button>').join('')
      + '</div></div>';
  } else {
    const node = byId[nodeId(pick)];
    const scene = B.scenes[node.key] || {transcripts:{}, reviews:[]};
    let h = '<div class="card"><h2>'+node.day+'일차 · '+esc(node.title)+'</h2>'
      + '<p class="sub">'+esc(node.summary)+'</p>'
      + metricsHtml(node) + rulesHtml(node) + '</div>';

    h += '<div class="card"><h3>그날의 TASK '+node.tasks.length+'건 — 눌러서 대화록을 펼친다</h3>'
      + node.tasks.map(t => taskHtml(t, scene.transcripts[t.id])).join('') + '</div>';

    if (scene.reviews && scene.reviews.length){
      h += '<div class="card"><h3>하루가 끝나고 — 각자 자기가 겪은 것만 두고 한마디</h3>'
        + scene.reviews.map(r => '<div class="review"><div class="who">'+esc(NAME[r.speaker]||r.speaker)+'</div><div>'+esc(r.text)+'</div></div>').join('')
        + '<p class="sub" style="margin-top:10px">합성 평가다. 실제 주민의 만족도가 아니며, 나중에 실제 주민이 확인·반박할 대상이다.</p></div>';
    }

    if (node.options.length){
      h += '<div class="card"><h2>무엇을 고칠 것인가</h2>'
        + '<p class="sub">오늘 일어난 일에서 나온 세 가지다. 하나만 고를 수 있고, 고른 것이 내일의 규칙이 된다.</p>'
        + '<div class="options">' + node.options.map((o,i) =>
            '<button class="opt" data-pick="'+i+'"><div class="lab">'+esc(o.label)+'</div><div class="t">'+esc(o.title)+'</div>'
            + '<div class="why">'+esc(o.because)+'</div>'
            + '<div class="delta"><div class="b">'+esc(o.beforeSentence)+'</div><div class="a">'+esc(o.afterSentence)+'</div></div></button>').join('')
        + '</div></div>';
    } else {
      const idx = B.nodes.filter(n=>n.day===3).findIndex(n=>n.id===node.id) + 1;
      h += '<div class="card end"><h2>이 경로의 끝 — 27경로 중 '+idx+'번째</h2>'
        + '<p class="sub">'+esc(B.initial[pick[0]].name)+' → '+esc(byId[nodeId(pick.slice(0,2))].choice.title)+' → '+esc(node.choice.title)+'</p>'
        + '<div class="row"><button class="btn" id="again">처음부터 다른 길로</button>'
        + '<button class="btn ghost" id="back2">2일차 선택으로 돌아가기</button></div></div>';
    }
    main.innerHTML = h;
  }

  main.querySelectorAll('.opt[data-pick]').forEach(el => el.onclick = () => { pick.push(+el.dataset.pick); render(); window.scrollTo({top:0,behavior:'smooth'}); });
  main.querySelectorAll('.task .head').forEach(el => el.onclick = () => el.parentElement.classList.toggle('open'));
  const again = document.getElementById('again'); if (again) again.onclick = () => { pick = []; render(); window.scrollTo({top:0}); };
  const back2 = document.getElementById('back2'); if (back2) back2.onclick = () => { pick = pick.slice(0,2); render(); window.scrollTo({top:0}); };
}

/* ------------------------------------------------------------------ 전체 트리 */
function renderTree(){
  const here = pick.length ? nodeId(pick) : null;
  const cols = B.initial.map((p,i) => {
    const n1 = byId[String(i)];
    let h = '<ul><li class="lv1">'+esc(p.name)+'</li>';
    n1.options.forEach((o1,c1) => {
      const n2 = byId[i+'-'+c1];
      h += '<li class="lv2">└ '+esc(o1.title)+'</li>';
      n2.options.forEach((o2,c2) => {
        const id = i+'-'+c1+'-'+c2;
        h += '<li class="lv3">　└ <a data-go="'+id+'" class="'+(id===here?'here':'')+'">'+esc(o2.title)+'</a></li>';
      });
    });
    return h + '</ul>';
  });
  const tree = document.getElementById('tree');
  tree.innerHTML = cols.join('');
  tree.querySelectorAll('a[data-go]').forEach(a => a.onclick = () => {
    pick = a.dataset.go.split('-').map(Number); render(); window.scrollTo({top:0,behavior:'smooth'});
  });
}

render();
</script>
</body>
</html>
`;

const b = JSON.parse(fs.readFileSync(path.join(OUT, 'bundle.json'), 'utf8'));
const { map, track, place, clock, ...data } = b;   // 뷰어가 쓰지 않는 무거운 것들

const outPath = path.join(OUT, 'eunjeom-3days.html');
fs.writeFileSync(outPath, SHELL.replace('__DATA__', JSON.stringify(data)), 'utf8');
console.log(`${outPath} — ${(fs.statSync(outPath).size / 1048576).toFixed(2)} MB`
  + ` · 노드 ${data.nodes.length} · 장면 ${Object.keys(data.scenes).length}`);

