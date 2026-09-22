// 하루 계획 — 사건(need) × 운영 규칙(policy) → Task 목록과 결과.
//
// **여기서 LLM은 한 번도 불리지 않는다.** 누가 그 시각 어디 있는지, 부탁을 받을 수 있는지,
// 언제 출발해 언제 닿는지는 전부 일과표와 거리에서 나온다 (medial 설계 원칙: 수락·거절은
// 관측 가능한 제약으로 먼저 판정하고, 모델은 표현과 태도만 맡는다).
// 대화록 생성기는 이 파일이 만든 `facts` 를 읽어 그 장면을 말로 옮길 뿐이다.
import { at, hhmm, min, readyAt, travelMinutes, routeMeters } from './village.mjs';

export const MED = 'MED';           // MEDial — 마을 안내 시계의 목소리
export const CLINIC = 'CLINIC';     // 보건소 담당자
export const MEDIC = 'MEDIC';       // 119 구급대원

/** 그 시각 그 사람이 부탁을 받을 수 없는 이유 한 줄. 화면과 프롬프트가 같은 문장을 쓴다. */
function whyNot(person, t, world) {
  const s = at(person, t, world);
  if (s.reach === 0) return `${s.place}에 있어 연락이 닿지 않는다`;
  if (s.assign === 0) return `${s.place}에 묶여 있어 자리를 뜰 수 없다`;
  return null;
}

/** 연락 순서. 정책의 contact_order 가 정한다. */
function askOrder(policy, subjectId, world) {
  const others = world.people.filter((p) => p.id !== subjectId).map((p) => p.id);
  const byDistance = [...others].sort((a, b) =>
    routeMeters(world, 'HOME', 'HOME', { fromPerson: subjectId, toPerson: a })
    - routeMeters(world, 'HOME', 'HOME', { fromPerson: subjectId, toPerson: b }));
  const head = 'P6';
  const { strategy, allowHeadContact } = policy.contact_order;

  if (strategy === 'retry_then_clinic') return [];
  if (strategy === 'head_first') return allowHeadContact ? [head, ...byDistance.filter((i) => i !== head)] : byDistance.filter((i) => i !== head);
  if (strategy === 'neighbour_first') {
    const rest = byDistance.filter((i) => i !== head);
    return allowHeadContact ? [...rest, head] : rest;
  }
  // relation_first — 기록된 가까운 관계가 먼저, 이장은 마지막. 관계가 없는 사람에게는 줄이 짧다.
  const close = world.by[subjectId].close.filter((i) => world.by[i]);
  const rest = byDistance.filter((i) => !close.includes(i) && i !== head);
  return allowHeadContact ? [...close, ...rest, head] : [...close, ...rest];
}

/**
 * 차례로 물어본다. 한 건에 묻는 이웃 수(neighbour_ask_limit)와 한 사람의 하루 상한(helper_daily_cap)이 멈춘다.
 * 부탁 하나에 2분씩 든다 — 거절이 쌓이면 그대로 지연이 된다.
 */
function ask(order, t0, world, policy, load, { needCar = false } = {}) {
  const asked = [];
  let t = t0;
  for (const id of order) {
    if (asked.length >= policy.neighbour_ask_limit.people) break;
    const person = world.by[id];
    if ((load[id] || 0) >= policy.helper_daily_cap.perDay) {
      asked.push({ id, at: t, ok: false, skipped: true, reason: `오늘 이미 부탁을 ${load[id]}번 받아 상한에 걸린다` });
      continue;
    }
    const blocked = whyNot(person, t, world) || (needCar && !person.drives ? '차를 쓰지 않는다' : null);
    load[id] = (load[id] || 0) + 1;
    if (blocked) { asked.push({ id, at: t, ok: false, reason: blocked, place: at(person, t, world).place }); t += 2; continue; }
    const s = at(person, t, world);
    // 순찰처럼 "지금 하던 것을 끝내고" 움직이는 구간은 수락 시각과 출발 시각이 다르다.
    const departAt = Math.max(readyAt(person, t, world), t + 2);
    asked.push({ id, at: t, ok: true, departAt, place: s.place, target: s.target, waited: departAt - t });
    return { asked, accepted: asked[asked.length - 1], endedAt: t + 2 };
  }
  return { asked, accepted: null, endedAt: t };
}

/** 발화 예산은 14를 넘기지 않는다 — 한 장면이 길어지면 사람이 읽지 않는다. */
const task = (o) => ({ facts: [], budget: 8, ...o, budget: Math.min(14, o.budget ?? 8) });
const 사람 = (world, id) => (id === MED ? 'MEDial' : id === CLINIC ? '보건소 담당' : id === MEDIC ? '구급대원' : world.by[id].name);

// ---------------------------------------------------------------------------
// 사건 1 — 응답 없는 안부 확인 (대상 P1. 두 번 다 밭에 있었고 아무 일도 없었다: 오탐)
// ---------------------------------------------------------------------------

function questWelfare(world, policy, load, { subjectId = 'P1', triggerAt = '09:30', seq = 'w' } = {}) {
  const t0 = min(triggerAt);
  const subject = world.by[subjectId];
  const tasks = [];
  // escalated 는 **실제로 인계 task가 생겼을 때만** 참이다. 기한을 넘겼지만 마을 안에서
  // 확인된 경우는 pastDeadline 으로 따로 센다 — 둘을 합치면 화면이 없는 일을 있다고 말한다.
  const m = { retryMinutes: 0, waitedForPatrolMinutes: 0, headAsks: 0, refusals: 0,
    subjectUpset: false, escalated: false, pastDeadline: false, resolveMinutes: null };

  // ── Task 1. 본인에게 연락한다 (안내 시계). 밭에 있어 듣지 못한다.
  const gap = Math.max(policy.retry_before_help.intervalMinutes, policy.quiet_period.minutes);
  const tries = [t0];
  for (let i = 0; i < policy.retry_before_help.count; i++) tries.push(t0 + gap * (i + 1));
  const afterRetry = tries[tries.length - 1];
  m.retryMinutes = afterRetry - t0;
  tasks.push(task({
    id: `${seq}1`, type: 'contact', questId: 'quest:no-response-welfare-check',
    title: '본인에게 연락', startAt: t0, endAt: afterRetry, outcome: 'no_answer',
    channel: '집에 걸린 마을 안내 시계 (스피커로 말이 나오고, 마이크로 대답한다)',
    actors: [MED], about: subjectId, budget: 2 + tries.length,
    scene: `${사람(world, subjectId)} 집의 안내 시계로 안부를 묻는다. 대답이 없어 정해진 횟수만큼 다시 부른다.`,
    facts: [
      `${hhmm(t0)} 첫 문진에 응답이 없었다.`,
      ...tries.slice(1).map((t) => `${hhmm(t)} 다시 불렀으나 응답이 없었다.`),
      `${사람(world, subjectId)}은(는) 그 시각 밭에 있어 안내 시계 소리를 듣지 못했다. 몸에는 아무 일도 없었다.`,
      'MEDial은 집 안이 비었는지 아픈지 알 수 없다. 응답이 없다는 사실만 안다.',
    ],
  }));

  // ── Task 2. 남에게 부탁한다
  const order = askOrder(policy, subjectId, world);
  const r = ask(order, afterRetry, world, policy, load);
  m.refusals = r.asked.filter((a) => !a.ok).length;
  m.headAsks += r.asked.filter((a) => a.id === 'P6').length;
  const disclosure = policy.disclosure_scope.level;

  tasks.push(task({
    id: `${seq}2`, type: 'request_help', questId: 'quest:no-response-welfare-check',
    title: order.length === 0 ? '기관에 바로 넘김'
      : r.accepted?.id === 'P6' ? '이장에게 확인을 부탁' : '이웃에게 확인을 부탁',
    startAt: afterRetry, endAt: r.endedAt, outcome: r.accepted ? 'accepted' : 'unresolved',
    channel: '전화', actors: [MED, ...r.asked.map((a) => a.id)], about: subjectId,
    budget: 5 + r.asked.length * 3,
    scene: r.asked.length === 0
      ? '마을 안에 부탁할 사람이 남지 않았다.'
      : `MEDial이 ${r.asked.map((a) => 사람(world, a.id)).join(' → ')} 순서로 전화를 건다.`,
    facts: [
      order.length === 0 ? '연락 순서 규칙이 주민에게 묻지 않고 본인 재연락이 끝나면 보건소로 넘기게 되어 있다.' : null,
      ...r.asked.map((a) => a.ok
        ? `${hhmm(a.at)} ${사람(world, a.id)}이(가) 수락했다. 지금 ${a.place}에 있고, ${a.waited > 3 ? `하던 일을 마치는 ${hhmm(a.departAt)}에 출발한다` : '곧 출발한다'}.`
        : `${hhmm(a.at)} ${사람(world, a.id)}은(는) 못 간다고 했다 — ${a.reason}.`),
      `MEDial이 ${사람(world, subjectId)}을(를) 부른 횟수는 ${tries.length}번이고, 시각은 ${tries.map((t) => hhmm(t)).join(', ')}이다.`,
      '※ 그 밖의 시각을 말하지 않는다.',
      disclosure === 'named'
        ? '공개 범위 규칙에 따라 MEDial은 연락이 닿지 않은 시각과 등록된 평소 일과까지 말해 준다.'
        : '공개 범위 규칙에 따라 MEDial은 "응답이 없다"는 사실만 말하고 그 사람의 일과나 사정은 말하지 않는다.',
      disclosure === 'named' ? `※ 등록된 일과는 이것뿐이다: "${subject.day}"` : null,
    ].filter(Boolean),
  }));

  // ── Task 3. 가서 확인한다 / 또는 기관으로 넘어간다
  const deadline = policy.institution_deadline.afterMinutes;
  if (r.accepted) {
    const helperId = r.accepted.id;
    m.waitedForPatrolMinutes = r.accepted.waited > 3 ? r.accepted.waited : 0;
    // 지금 있는 곳 → 대상자 자택 → (비어 있으니) 밭. 전부 실제 도로 거리로 계산한다.
    const toHome = travelMinutes(world, r.accepted.target, 'HOME', { fromPerson: helperId, toPerson: subjectId });
    const toFarm = travelMinutes(world, 'HOME', 'FARM', { fromPerson: subjectId });
    const walkMetres = Math.round(routeMeters(world, r.accepted.target, 'HOME', { fromPerson: helperId, toPerson: subjectId })
      + routeMeters(world, 'HOME', 'FARM', { fromPerson: subjectId }));
    const arriveHome = r.accepted.departAt + toHome;
    const confirmAt = arriveHome + toFarm + 3; // 집을 확인하고 밭까지 가서 찾는다
    m.resolveMinutes = confirmAt - t0;
    m.pastDeadline = deadline != null && confirmAt - t0 > deadline;
    m.subjectUpset = disclosure === 'named';

    tasks.push(task({
      id: `${seq}3`, type: 'contact', questId: 'quest:no-response-welfare-check',
      title: '집에 가서 확인', startAt: r.accepted.departAt, endAt: confirmAt, outcome: 'done',
      channel: '대면', actors: [helperId, subjectId], about: subjectId, budget: 10,
      scene: `${사람(world, helperId)}이(가) ${사람(world, subjectId)}의 집에 갔다가 비어 있어 밭으로 가서 만난다.`,
      move: { who: helperId, legs: [
        { from: r.accepted.target, fromPerson: helperId, to: 'HOME', toPerson: subjectId, at: arriveHome },
        { from: 'HOME', fromPerson: subjectId, to: 'FARM', toPerson: subjectId, at: confirmAt },
      ] },
      facts: [
        `${hhmm(r.accepted.departAt)} 출발, ${hhmm(arriveHome)} 자택 도착 — 아무도 없다.`,
        `${hhmm(confirmAt)} 밭에서 ${사람(world, subjectId)}을(를) 만났다. 멀쩡하다. 아무 일도 없었다.`,
        `${사람(world, helperId)}이(가) 실제로 걸은 길은 도로로 약 ${walkMetres} m다.`,
        `요청이 뜬 ${hhmm(t0)}부터 확인까지 ${m.resolveMinutes}분이 걸렸다.`,
        disclosure === 'named'
          ? `※ ${사람(world, helperId)}은(는) MEDial에게 들은 대로 "아침 ${hhmm(t0)}하고 아까 두 번 연락이 안 됐다더라, 평소 이맘때 밭에 계신다고 들었다"고 말한다.`
          : `※ ${사람(world, helperId)}은(는) "연락이 안 된다길래 와 봤다"는 말만 하고 시각이나 일과는 꺼내지 않는다.`,
        `※ ${사람(world, subjectId)}은(는) 자기가 확인 대상이 되었다는 사실 자체를 달가워하지 않는다.`
          + (disclosure === 'named' ? ' 자기 일과가 남에게 전해진 것을 특히 불쾌해한다.' : ''),
      ],
    }));
  } else {
    const handoffAt = deadline == null ? afterRetry + 60 : Math.min(afterRetry + 30, t0 + deadline);
    m.escalated = true;
    m.resolveMinutes = handoffAt - t0;
    tasks.push(task({
      id: `${seq}3`, type: 'escalate_handoff', questId: 'quest:no-response-welfare-check',
      title: '보건소로 넘김', startAt: r.endedAt, endAt: handoffAt, outcome: 'handed_off',
      channel: '기관 회선', actors: [MED, CLINIC], about: subjectId, budget: 8,
      scene: 'MEDial이 마을 안에서 확인할 사람을 찾지 못해 보건소 담당자에게 넘긴다.',
      facts: [
        `${hhmm(handoffAt)} 보건소로 넘겼다. MEDial은 해결했다고 말하지 않고, 확인되지 않았다고 말한다.`,
        // 물어본 사람은 **전화를 받았고, 갈 수 없다고 답했다.** 이름만 나열하면 모델이
        // "연락이 닿지 않았다"로 잘못 옮긴다 — 무엇을 답했는지까지 적는다.
        r.asked.length === 0
          ? '마을 안에서는 아무에게도 묻지 않았다 — 규칙이 주민에게 묻지 않게 되어 있다.'
          : `마을 사람들에게는 전화가 닿았고, 다들 지금은 갈 수 없다고 답했다: ${r.asked.map((a) => `${사람(world, a.id)} — ${a.reason}`).join(', ')}.`,
        '닿지 않은 것은 확인 대상 본인뿐이다. 부탁을 받은 사람들과는 통화가 되었다.',
        disclosure === 'named'
          ? '공개 범위 규칙에 따라 연락 시각과 평소 일과까지 함께 넘긴다.'
          : '공개 범위 규칙에 따라 응답이 없었다는 사실만 넘긴다.',
      ],
    }));
  }
  return { tasks, metrics: m };
}

// ---------------------------------------------------------------------------
// 사건 2 — 병원 동행 (대상 P9. 펜션이 마을에서 400 m 남쪽, 본인은 운전하지 않는다)
// ---------------------------------------------------------------------------

function questTransport(world, policy, load) {
  const subjectId = 'P9';
  const tasks = [];
  const m = { rideRefused: false, headAsks: 0, refusals: 0, detourMinutes: 0, rideBackLate: 0 };
  const t0 = min('07:20');

  tasks.push(task({
    id: 't1', type: 'contact', questId: 'quest:medical-transport',
    title: '진료 일정 확인', startAt: t0, endAt: t0 + 6, outcome: 'accepted',
    channel: '집에 걸린 마을 안내 시계', actors: [MED, subjectId], about: subjectId, budget: 7,
    scene: '오늘 읍내 진료가 있는 것을 확인하고, 태워 줄 사람을 찾아보겠다고 말한다.',
    facts: [
      '08:00 읍내 의원 진료. 본인은 운전을 하지 않는다.',
      '펜션은 마을 남쪽 끝이다. 마을 한가운데에서 도로로 552 m를 내려갔다 올라와야 한다.',
      `※ ${사람(world, subjectId)}은(는) 이 마을에서 디지털을 가장 잘 쓰는 사람이고 AI에 호의적이다.`,
    ],
  }));

  // ── 갈 때. 동승 순서 규칙이 결과를 가른다.
  // 우회는 운전자의 원래 동선과의 차이다: 집→읍내진출로 직행과, 펜션을 들렀다 가는 길의 차.
  const driverId = 'P12';
  const direct = routeMeters(world, 'HOME', 'TOWNEXIT', { fromPerson: driverId });
  const via = routeMeters(world, 'HOME', 'HOME', { fromPerson: driverId, toPerson: subjectId })
    + routeMeters(world, 'HOME', 'TOWNEXIT', { fromPerson: subjectId });
  const detourMetres = Math.round(via - direct);
  const detour = Math.round(detourMetres / world.travel.driveMPerMin) + 4; // 도로 시간 + 승하차
  m.detourMinutes = detour;
  m.detourMetres = detourMetres;
  const kinFirst = policy.ride_candidate_order.order === 'kin_first';
  const withinLimit = detour <= policy.ride_detour_limit.maxDetourMinutes;
  const rideOk = kinFirst || withinLimit;
  m.rideRefused = !rideOk;
  if (kinFirst) { load.P6 = (load.P6 || 0) + 1; m.headAsks += 1; }
  load.P12 = (load.P12 || 0) + 1;

  tasks.push(task({
    id: 't2', type: 'arrange_transport', questId: 'quest:medical-transport',
    title: rideOk ? '갈 때 태워 줄 사람' : '갈 때 태워 줄 사람을 찾지 못함',
    startAt: t0 + 8, endAt: t0 + 20, outcome: rideOk ? 'accepted' : 'refused',
    channel: '전화', actors: kinFirst ? [MED, 'P6', 'P12'] : [MED, 'P12'], about: subjectId,
    budget: kinFirst ? 11 : 8,
    scene: kinFirst
      ? `MEDial이 이장에게 묻고, 이장이 사촌 ${사람(world, driverId)}에게 부탁한다.`
      : `MEDial이 그 시각 읍내로 나가는 ${사람(world, driverId)}에게 직접 부탁한다.`,
    absence: { who: subjectId, from: min(rideOk ? '07:52' : '08:40'), to: min('13:27'), label: '읍내 진료' },
    move: rideOk ? { who: driverId, car: true, startAt: min('07:45'), legs: [
      { from: 'HOME', fromPerson: driverId, to: 'HOME', toPerson: subjectId, at: min('07:52') },
      { from: 'HOME', fromPerson: subjectId, to: 'TOWNEXIT', at: min('08:00'), rider: subjectId },
    ] } : null,
    facts: [
      `${사람(world, driverId)}은 아침에 차로 읍내에 나간다. 읍내는 북쪽인데 펜션은 남쪽이라, 원래 가던 길보다 도로로 ${detourMetres} m를 더 돌아야 하고 승하차까지 ${detour}분이 더 든다.`,
      `동승 우회 한도는 ${policy.ride_detour_limit.maxDetourMinutes}분이다. ${detour}분은 ${withinLimit ? '한도 안이다' : '한도를 넘는다'}.`,
      kinFirst
        ? `동승 부탁 순서 규칙이 "기록된 친척 먼저"라, MEDial은 관계를 따라 이장을 거쳐 사촌에게 간다. ${사람(world, driverId)}은 우회가 길어도 사촌형이 부탁하면 간다.`
        : (withinLimit
          ? '동승 부탁 순서 규칙이 "동선이 가까운 사람 먼저"이고, 우회가 한도 안이라 직접 부탁한다.'
          : '동승 부탁 순서 규칙이 "동선이 가까운 사람 먼저"라 우회가 한도를 넘는 사람에게는 부탁하지 않는다. 결국 아무도 태우러 가지 않는다.'),
      rideOk ? '07:45에 출발해 펜션을 들렀다가 08:00 전에 의원에 닿는다.' : '본인이 버스를 알아봐야 한다. 버스는 한 시간에 한 대다.',
    ],
  }));

  // ── 올 때. P3 가 원래 그 길로 돌아온다 — 추가 이동 0 m. 다만 상한에 걸릴 수 있다.
  const p3Capped = (load.P3 || 0) >= policy.helper_daily_cap.perDay;
  load.P3 = (load.P3 || 0) + 1;
  m.rideBackLate = p3Capped ? 60 : 0;
  if (p3Capped) m.refusals += 1;

  tasks.push(task({
    id: 't3', type: 'arrange_transport', questId: 'quest:medical-transport',
    title: '올 때 태워 줄 사람', startAt: min('12:55'), endAt: min(p3Capped ? '14:00' : '13:27'),
    outcome: p3Capped ? 'unresolved' : 'done',
    channel: p3Capped ? '전화' : '전화 · 대면', actors: [MED, 'P3', ...(p3Capped ? [] : [subjectId])], about: subjectId,
    budget: p3Capped ? 7 : 10,
    scene: p3Capped
      ? `${사람(world, 'P3')}은 오늘 이미 상한만큼 부탁을 받아 MEDial이 묻지 않는다. 다른 사람이 없다.`
      : `${사람(world, 'P3')}이 읍내에서 돌아오는 길에 들러 태우고 온다. 원래 다니던 길이라 추가로 움직인 거리는 0 m다.`,
    move: p3Capped ? null : { who: 'P3', car: true, startAt: min('13:10'), legs: [
      { from: 'TOWNEXIT', to: 'HOME', toPerson: subjectId, at: min('13:27'), rider: subjectId },
      { from: 'HOME', fromPerson: subjectId, to: 'HOME', toPerson: 'P3', at: min('13:33') },
    ] },
    facts: [
      rideOk
        ? `아침에는 ${사람(world, driverId)} 차로 나갔다.`
        : '아침에 태워 줄 사람을 찾지 못해 버스로 나갔고, 버스가 한 시간에 한 대라 진료를 한 시간 늦게 봤다.',
      `${사람(world, 'P3')}은 09:00에 읍내로 나가 13:00에 돌아온다. 오는 길에 식당과 펜션을 지난다.`,
      p3Capped
        ? `한 사람이 하루에 받는 부탁 상한이 ${policy.helper_daily_cap.perDay}번이라 ${사람(world, 'P3')}에게는 더 묻지 않는다. 마을 안에 낮에 움직일 수 있는 사람이 없다.`
        : '12:55에 부탁해 13:27에 펜션에 내려 준다. 추가 이동 0 m.',
      `${사람(world, 'P3')}은 29살에 다친 뒤로 지금까지 병원에 다닌다. 이 마을에서 의료 경험이 가장 깊다.`,
    ],
  }));
  return { tasks, metrics: m };
}

// ---------------------------------------------------------------------------
// 사건 3 — 의약품 전달 (대상 P11. 부부가 식당을 보느라 둘 다 자리를 뜰 수 없다)
// ---------------------------------------------------------------------------

function questMedicine(world, policy, load) {
  const subjectId = 'P11';
  const t0 = min('10:40');
  const tasks = [];
  const m = { refusals: 0, headAsks: 0 };

  tasks.push(task({
    id: 'm1', type: 'contact', questId: 'quest:medicine-errand',
    title: '약이 떨어진 것을 확인', startAt: t0, endAt: t0 + 6, outcome: 'accepted',
    channel: '가게에 걸린 마을 안내 시계', actors: [MED, subjectId], about: subjectId, budget: 7,
    scene: '허리 통증이 심해졌는데 먹던 약이 떨어졌다.',
    facts: [
      '정형외과 주치의가 먼 도시에 있어 다녀오려면 하루를 잡아야 한다.',
      '부부 둘이서 가게를 봐서 둘 다 자리를 뜰 수 없다.',
      `※ ${사람(world, subjectId)}은(는) 이 마을에서 가장 나이가 많고 디지털을 가장 안 쓴다. 말이 짧고 참는 편이다.`,
    ],
  }));

  const order = askOrder(policy, subjectId, world).filter((id) => id !== 'P10');
  const inVillage = order.filter((id) => !at(world.by[id], t0).errand);
  const errandable = order.filter((id) => at(world.by[id], t0).errand);
  const r = ask(inVillage, t0 + 8, world, policy, load);
  m.refusals = r.asked.filter((a) => !a.ok).length;
  m.headAsks = r.asked.filter((a) => a.id === 'P6').length;

  // 마을 안에 사람이 없으면 읍내에 나가 있는 사람에게 심부름을 얹는다.
  const errandId = r.accepted ? null : errandable.find((id) => (load[id] || 0) < policy.helper_daily_cap.perDay) ?? null;
  if (errandId) load[errandId] = (load[errandId] || 0) + 1;
  const doerId = r.accepted?.id ?? errandId;

  tasks.push(task({
    id: 'm2', type: 'request_help', questId: 'quest:medicine-errand',
    title: doerId ? '약을 받아다 줄 사람' : '약을 받아다 줄 사람을 찾지 못함',
    startAt: t0 + 8, endAt: min('13:10'), outcome: doerId ? 'done' : 'unresolved',
    channel: '전화 · 대면', actors: [MED, ...r.asked.map((a) => a.id), ...(errandId ? [errandId] : []), subjectId],
    about: subjectId, budget: 6 + r.asked.length * 3 + (errandId ? 4 : 0),
    scene: doerId
      ? `마을 안에서는 나설 사람이 없어, 읍내에 나가 있는 ${사람(world, doerId)}이(가) 오는 길에 약을 받아 온다.`
      : '마을 안에도 읍내에도 부탁할 사람이 없다.',
    move: doerId && errandId ? { who: errandId, car: true, startAt: min('12:58'), legs: [
      { from: 'TOWNEXIT', to: 'HOME', toPerson: subjectId, at: min('13:10') },
    ] } : null,
    facts: [
      ...r.asked.map((a) => a.ok
        ? `${hhmm(a.at)} ${사람(world, a.id)}이(가) 하겠다고 했다.`
        : `${hhmm(a.at)} ${사람(world, a.id)}은(는) 못 간다 — ${a.reason}.`),
      ...(errandId ? [`${사람(world, errandId)}은(는) 읍내에 나가 있어 오는 길에 약국을 들를 수 있다. 추가 이동은 거의 없다.`] : []),
      doerId ? '13:10에 진통제와 파스가 가게로 들어온다.' : '오늘 안에 약을 받지 못한다.',
      '낮에 마을이 빈다. 계기판의 "배정 가능" 숫자와 실제로 갈 수 있는 사람은 다르다.',
    ],
  }));
  return { tasks, metrics: m };
}

// ---------------------------------------------------------------------------
// 사건 4 — 저녁 위급 (대상 P8. 혼자 살고, 스텐트 시술 이력과 당뇨·고혈압이 있다)
// ---------------------------------------------------------------------------

function questEmergency(world, policy, load) {
  const subjectId = 'P8';
  const t0 = min('20:30');
  const tasks = [];
  const m = { headAsks: 0, refusals: 0 };
  const disclosure = policy.disclosure_scope.level;

  const nearest = 'P7'; // 형. 집이 20 m 거리이고 그 시각 집에 있다.
  const arriveAt = t0 + 2;
  const handoffAt = t0 + 26;
  load[nearest] = (load[nearest] || 0) + 1;

  tasks.push(task({
    id: 'e1', type: 'request_help', questId: 'quest:emergency',
    title: '가장 가까운 사람을 부른다', startAt: t0, endAt: arriveAt, outcome: 'accepted',
    channel: '전화', actors: [MED, nearest], about: subjectId, budget: 7,
    scene: '안내 시계가 이상을 감지했으나 본인 응답이 없다. MEDial이 가장 가까운 등록자에게 전화한다.',
    aboutNote: '집에서 쓰러져 있고, 이 통화에는 나오지 않는다',
    move: { who: nearest, legs: [
      { from: 'HOME', fromPerson: nearest, to: 'HOME', toPerson: subjectId, at: arriveAt },
    ] },
    facts: [
      `쓰러진 사람은 ${사람(world, subjectId)}(동생)이고, 일이 난 곳은 ${사람(world, subjectId)}의 집이다. ${사람(world, nearest)}은(는) 그 형이고, 부탁을 받고 달려온 사람이다.`,
      `※ 두 사람을 바꿔 부르지 않는다. ${사람(world, nearest)}은(는) 환자가 아니고, 구급차에 실려 가는 사람은 ${사람(world, subjectId)}이다.`,
      `${hhmm(t0)} 감지, 본인 응답 없음. ${사람(world, nearest)}은(는) 30초 만에 수락하고 2분 만에 도착한다.`,
      `${사람(world, nearest)}은(는) ${사람(world, subjectId)}의 형이고 집이 20 m 거리다. 응급처치를 배운 적은 없다.`,
      '이 경우 MEDial은 공개 범위 규칙과 무관하게 상태를 말한다 — 생명이 걸린 상황이기 때문이다.',
    ],
  }));

  tasks.push(task({
    id: 'e2', type: 'contact', questId: 'quest:emergency',
    title: '구급대가 올 때까지', startAt: arriveAt, endAt: handoffAt, outcome: 'accepted',
    channel: '대면 · 안내 음성', actors: [nearest, MED], about: subjectId, budget: 12,
    scene: '구급대가 오는 22분 동안, 안내 음성이 시키는 대로 형이 의식과 호흡을 확인하고 흉부압박을 한다.',
    aboutNote: '바닥에 쓰러져 있고, 의식이 없어 한마디도 하지 않는다',
    facts: [
      `쓰러진 사람은 ${사람(world, subjectId)}(동생)이고, 일이 난 곳은 ${사람(world, subjectId)}의 집이다. ${사람(world, nearest)}은(는) 그 형이고, 부탁을 받고 달려온 사람이다.`,
      `※ 두 사람을 바꿔 부르지 않는다. ${사람(world, nearest)}은(는) 환자가 아니고, 구급차에 실려 가는 사람은 ${사람(world, subjectId)}이다.`,
      `${사람(world, nearest)}은(는) 응급처치를 배운 적이 없다. 무엇을 해야 하는지 MEDial이 한 번에 하나씩 말해 준다.`,
      '※ MEDial은 짧고 분명하게 말한다. 설명을 길게 하지 않는다.',
      `※ ${사람(world, nearest)}은(는) 이 마을에서 디지털을 가장 안 쓰는 축이고, 말수가 적다. 지금은 겁이 나 있다.`,
      '구급대는 22분 뒤에 닿는다.',
    ],
  }));

  load.P6 = (load.P6 || 0) + 1;
  m.headAsks += 1;
  tasks.push(task({
    id: 'e3', type: 'escalate_handoff', questId: 'quest:emergency',
    title: '인계하고, 이장에게 알린다', startAt: handoffAt, endAt: handoffAt + 18, outcome: 'handed_off',
    channel: '현장 · 전화', actors: [MEDIC, nearest, MED, 'P6'], about: subjectId, budget: 13,
    // 실려 가는 사람과, 구급차에 같이 타는 형. 대화록에서 구급대원이 "보호자분
    // 타세요"라고 하는데 지도에서는 형이 집으로 걸어가고 있으면 안 된다.
    // `silent` 는 의식이 없어 그날 한마디를 남길 수 없는 사람이다.
    absence: [
      { who: subjectId, from: handoffAt + 9, to: 24 * 60, label: '병원 이송', silent: true },
      { who: nearest, from: handoffAt + 9, to: 24 * 60, label: '병원 동행' },
    ],
    aboutNote: '그 자리에 실려 나가는 사람이고, 의식이 없어 한마디도 하지 않는다',
    // 위급은 기관 인계 기한과 무관하다 — 구급대가 이미 와 있다. 공개 범위만 걸린다.
    rules: ['disclosure_scope'],
    scene: `${hhmm(handoffAt)} 구급대가 도착해 인계받고 ${hhmm(handoffAt + 9)}에 읍으로 떠난다. 그 뒤 MEDial이 이장에게 전화한다.`,
    facts: [
      `쓰러진 사람은 ${사람(world, subjectId)}(동생)이고, 일이 난 곳은 ${사람(world, subjectId)}의 집이다. ${사람(world, nearest)}은(는) 그 형이고, 부탁을 받고 달려온 사람이다.`,
      `※ 두 사람을 바꿔 부르지 않는다. ${사람(world, nearest)}은(는) 환자가 아니고, 구급차에 실려 가는 사람은 ${사람(world, subjectId)}이다.`,
      `스텐트 시술 이력, 당뇨, 고혈압은 ${사람(world, subjectId)}의 것이다. MEDial이 아는 것은 기기가 들은 것과 등록된 병력뿐이다.`,
      'MEDial은 진단을 말하지 않는다. 관측한 것과 시각만 전한다.',
      disclosure === 'named'
        ? '공개 범위 규칙이 "연락 시각과 동의된 일과까지"라, MEDial은 감지 시각·이송 시각·이송처까지 이장에게 말한다.'
        : '공개 범위 규칙이 "응답 없음 사실만"이라, MEDial은 이송되었다는 사실과 시각만 말하고 상태는 말하지 않는다.',
      '※ 이 사람에게 등록된 평소 일과는 없다. MEDial은 일과를 말하지 않는다 — 없는 일정을 지어내지 않는다.',
      '※ 이장은 이 마을에서 사람과 사람을 잇는 유일한 역할이다. 먼저 나서서 뭘 할지부터 묻는다. 가족은 다 객지에 있다.',
      '※ 구급대원은 현장에서 형에게 말하고, 이장과의 전화는 그 뒤에 이어진다. 같은 자리에서 이어지는 한 장면이다.',
    ],
  }));
  return { tasks, metrics: m };
}

// ---------------------------------------------------------------------------
// 사흘
// ---------------------------------------------------------------------------

// 사흘 다 **무응답 안부 확인**이 들어간다. 그 사람은 날마다 같은 시각에 밭에 있고 날마다
// 응답하지 않는다 — 인터뷰에 나온 그대로다. 그래야 어제 고친 규칙이 오늘 걸리는 자리가 생기고,
// 관람객이 고른 것이 다음 날에 실제로 반영된다 (전시 기획서 PDF 07쪽).
export const DAYS = [
  { day: 1, title: '응답 없는 안부 확인', summary: '아침 문진에 응답이 없다. 실제로는 밭에 있었고 아무 일도 없었다.' },
  { day: 2, title: '또 무응답, 그리고 병원 동행', summary: '어제 그 사람이 오후에 또 응답하지 않는다. 같은 날 읍내 진료 동행이 겹친다.' },
  { day: 3, title: '세 번째 무응답, 약 심부름, 저녁의 위급', summary: '같은 일이 또 일어나고, 약이 떨어진 집이 생기고, 저녁에는 혼자 사는 사람의 집에서 위급이 감지된다.' },
];

/** 하루를 계획한다. 같은 (날, 정책)이면 항상 같은 결과다 — 난수가 없다. */
export function planDay(dayNo, world, policy) {
  const load = {};
  const parts = [];
  if (dayNo === 1) parts.push(questWelfare(world, policy, load, { triggerAt: '09:30', seq: 'w' }));
  if (dayNo === 2) {
    parts.push(questWelfare(world, policy, load, { triggerAt: '13:30', seq: 'w' }));
    parts.push(questTransport(world, policy, load));
  }
  if (dayNo === 3) {
    parts.push(questWelfare(world, policy, load, { triggerAt: '09:30', seq: 'w' }));
    parts.push(questMedicine(world, policy, load));
    parts.push(questEmergency(world, policy, load));
  }
  const tasks = parts.flatMap((p) => p.tasks).sort((a, b) => a.startAt - b.startAt);
  const metrics = Object.assign(
    { resolveMinutes: null, retryMinutes: 0, waitedForPatrolMinutes: 0, headAsks: 0, refusals: 0,
      subjectUpset: false, escalated: false, pastDeadline: false, rideRefused: false,
      rideBackLate: 0, detourMinutes: 0, detourMetres: 0 },
    ...parts.map((p) => p.metrics));
  metrics.headAsks = parts.reduce((s, p) => s + (p.metrics.headAsks || 0), 0);
  metrics.refusals = parts.reduce((s, p) => s + (p.metrics.refusals || 0), 0);
  metrics.helperLoad = load;
  return { day: dayNo, ...DAYS[dayNo - 1], tasks, metrics };
}

/** 그날의 task 유형에 실제로 걸리는 운영 규칙. 개선안을 고를 때와 화면이 함께 쓴다. */
export const RULES_FOR_TYPE = {
  contact: ['retry_before_help', 'quiet_period', 'disclosure_scope'],
  request_help: ['contact_order', 'neighbour_ask_limit', 'helper_daily_cap', 'disclosure_scope'],
  arrange_transport: ['ride_candidate_order', 'ride_detour_limit', 'helper_daily_cap'],
  escalate_handoff: ['institution_deadline', 'disclosure_scope'],
  notify_close: ['disclosure_scope'],
};

/** 그 하루에 걸리는 규칙의 집합. */
export const bindingRules = (day) =>
  new Set(day.tasks.flatMap((t) => t.rules ?? RULES_FOR_TYPE[t.type] ?? []));

export { 사람 as displayName };
