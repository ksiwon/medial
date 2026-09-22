// MEDial 운영 규칙 — medial 저장소 `server/app/simulation/iteration/semantic_rules.py` 의
// 9개 RuleType·값 범위·한국어 문장을 그대로 옮긴 것이다.
//
// 그래서 이 데모에서 디자이너가 고르는 "개선안"은 medial의 Change Set과 **같은 말**이고,
// 나중에 실제 엔진에 그대로 넣을 수 있다. 여기서 새 규칙을 발명하지 않는다.

/** 규칙 하나 = { 라벨, 값 → 한 문장 }. 문장은 화면과 프롬프트가 같은 것을 쓴다. */
export const RULES = {
  retry_before_help: {
    label: '본인 재연락',
    desc: '다른 사람에게 부탁하기 전에 본인에게 다시 연락하는 횟수와 간격.',
    fmt: (v) => v.count === 0
      ? '응답이 없으면 본인에게 다시 연락하지 않고 바로 다음 단계로 간다.'
      : `응답이 없으면 본인에게 ${v.intervalMinutes}분 간격으로 ${v.count}회 다시 연락한 뒤 다음 단계로 간다.`,
  },
  quiet_period: {
    label: '연락 최소 간격',
    desc: '같은 사람에게 다시 연락하기까지 반드시 비워 두는 시간.',
    fmt: (v) => v.minutes === 0
      ? '같은 사람에게 다시 연락하기까지 비워 두는 시간이 없다.'
      : `같은 사람에게 다시 연락하려면 적어도 ${v.minutes}분을 비워 둔다.`,
  },
  helper_daily_cap: {
    label: '한 사람이 받는 부탁 상한',
    desc: '한 사람이 하루에 받을 수 있는 조율 부탁의 수.',
    fmt: (v) => v.perDay === 0
      ? '주민에게 조율 부탁을 하지 않는다.'
      : `한 사람이 하루에 받는 조율 부탁은 ${v.perDay}번까지다. 넘으면 그 사람에게는 묻지 않는다.`,
  },
  neighbour_ask_limit: {
    label: '한 건에 묻는 이웃 수',
    desc: '거절당했을 때 몇 명까지 차례로 물어볼지.',
    fmt: (v) => `한 건에 대해 이웃 ${v.people}명까지 차례로 물어본다.`,
  },
  disclosure_scope: {
    label: '제3자에게 알리는 범위',
    desc: '이웃·기관에 부탁할 때 함께 넘기는 정보의 범위.',
    fmt: (v) => v.level === 'minimal'
      ? '제3자에게는 응답이 없었다는 사실만 전달한다.'
      : '제3자에게 연락 시각과 공개 동의된 평소 일과까지 함께 전달한다.',
  },
  institution_deadline: {
    label: '기관 인계 기한',
    desc: '접수 후 이 시간이 지나면 순서와 무관하게 기관으로 넘긴다.',
    fmt: (v) => v.afterMinutes == null
      ? '미해결이어도 기관으로 넘기는 기한이 없다.'
      : `접수 후 ${v.afterMinutes}분 안에 풀리지 않으면 기관으로 넘긴다.`,
  },
  contact_order: {
    label: '본인에게 닿지 않을 때의 연락 순서',
    desc: '재연락이 끝난 뒤 누구에게 가는가, 그리고 이장에게 물어도 되는가.',
    fmt: (v) => `본인에게 닿지 않으면 ${STRATEGY_WORDS[v.strategy]}.${v.allowHeadContact ? '' : ' 이장에게는 묻지 않는다.'}`,
  },
  ride_candidate_order: {
    label: '동승 부탁 순서',
    desc: '동승을 누구에게 먼저 부탁하는가.',
    fmt: (v) => v.order === 'closest_first'
      ? '동승은 동선이 가장 가까운 사람에게 먼저 부탁한다.'
      : '동승은 기록된 친척에게 먼저 부탁한다.',
  },
  ride_detour_limit: {
    label: '동승 우회 한도',
    desc: '운전자에게 부탁할 수 있는 최대 우회 시간.',
    fmt: (v) => `운전자에게 최대 ${v.maxDetourMinutes}분까지의 우회를 부탁한다.`,
  },
};

export const STRATEGY_WORDS = {
  head_first: '이장에게 확인을 부탁한다',
  retry_then_clinic: '보건소 담당자에게 넘긴다',
  neighbour_first: '가까이 사는 이웃에게 먼저 부탁하고, 거절하면 다음 사람에게 간다',
  relation_first: '기록된 가까운 관계에게 먼저 부탁하고 이장은 마지막에 부탁한다',
};

/** 정책 하나를 사람이 읽는 문장 목록으로. 화면·프롬프트가 같은 문장을 쓴다. */
export const describePolicy = (policy) =>
  Object.entries(RULES).map(([k, r]) => ({ ruleType: k, label: r.label, sentence: r.fmt(policy[k]) }));

// ---------------------------------------------------------------------------
// 1일차의 갈림길 — 첫 배포 설정 세 안
// ---------------------------------------------------------------------------

const base = {
  retry_before_help: { count: 2, intervalMinutes: 15 },
  quiet_period: { minutes: 15 },
  helper_daily_cap: { perDay: 2 },
  neighbour_ask_limit: { people: 3 },
  disclosure_scope: { level: 'minimal' },
  institution_deadline: { afterMinutes: 120 },
  contact_order: { strategy: 'head_first', allowHeadContact: true },
  ride_candidate_order: { order: 'closest_first' },
  // 실측: 펜션을 들렀다 가면 원래 동선보다 도로로 1,055 m를 더 돈다 (차로 3.5분 + 승하차 4분 = 8분).
  // 기본 한도 5분은 그 우회를 거절한다. 한도를 늘리거나 부탁 순서를 바꾸면 결과가 갈린다.
  ride_detour_limit: { maxDetourMinutes: 5 },
};

const clone = (p) => JSON.parse(JSON.stringify(p));

export const INITIAL_POLICIES = [
  {
    id: 'v0-swift', name: '빠르게 확인한다',
    rationale: '무응답이 오래 방치되는 것이 가장 위험하다고 보고, 재연락을 짧게 끊고 곧바로 이장에게 간다.',
    policy: Object.assign(clone(base), {
      retry_before_help: { count: 1, intervalMinutes: 10 },
      quiet_period: { minutes: 0 },
      institution_deadline: { afterMinutes: 60 },
      disclosure_scope: { level: 'named' },
      contact_order: { strategy: 'head_first', allowHeadContact: true },
      helper_daily_cap: { perDay: 4 },
    }),
  },
  {
    id: 'v0-gentle', name: '주민을 덜 부른다',
    rationale: '헛걸음이 사람을 지치게 한다고 보고, 본인에게 충분히 다시 연락한 뒤에야 남을 부른다.',
    policy: Object.assign(clone(base), {
      retry_before_help: { count: 3, intervalMinutes: 20 },
      quiet_period: { minutes: 30 },
      institution_deadline: { afterMinutes: 180 },
      disclosure_scope: { level: 'minimal' },
      contact_order: { strategy: 'neighbour_first', allowHeadContact: true },
      helper_daily_cap: { perDay: 2 },
      neighbour_ask_limit: { people: 2 },
    }),
  },
  {
    id: 'v0-kin', name: '아는 사람부터 찾는다',
    rationale: '모르는 사람이 문을 두드리는 것보다 아는 사이가 낫다고 보고, 기록된 관계를 먼저 쓰고 이장은 아낀다.',
    policy: Object.assign(clone(base), {
      contact_order: { strategy: 'relation_first', allowHeadContact: false },
      ride_candidate_order: { order: 'kin_first' },
      ride_detour_limit: { maxDetourMinutes: 20 },
      disclosure_scope: { level: 'minimal' },
      institution_deadline: { afterMinutes: 120 },
    }),
  },
];

// ---------------------------------------------------------------------------
// 2·3일차의 갈림길 — 그날 일어난 일에서 나오는 개선안 세 개
// ---------------------------------------------------------------------------

/** 후보 하나 = 규칙 하나의 값 변경. before/after 는 화면이 그대로 문장으로 만든다. */
function change(policy, ruleType, after, { title, because }) {
  return { ruleType, label: RULES[ruleType].label, title, because,
    before: clone(policy[ruleType]), after,
    beforeSentence: RULES[ruleType].fmt(policy[ruleType]), afterSentence: RULES[ruleType].fmt(after) };
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 그날의 결과(metrics)에서 후보를 만들고 **점수 순으로 세 개**를 고른다.
 * 항상 셋이 나오도록 마지막에 채움 후보를 둔다 — 트리의 가지 수가 날마다 같아야 27경로가 된다.
 */
export function improvementOptions(policy, day, nextBinding = null) {
  const m = day.metrics;
  const cand = [];
  const push = (score, c) => cand.push({ score, ...c });

  if (m.resolveMinutes != null && m.resolveMinutes > 60) {
    push(m.resolveMinutes, change(policy, 'retry_before_help',
      { count: clampInt(policy.retry_before_help.count - 1, 0, 6), intervalMinutes: clampInt(policy.retry_before_help.intervalMinutes - 5, 5, 240) },
      { title: '본인 재연락을 줄여 더 일찍 사람을 부른다',
        because: `확인까지 ${m.resolveMinutes}분이 걸렸고, 그중 ${m.retryMinutes}분은 본인에게 다시 거는 데 썼다.` }));
  }
  if (m.waitedForPatrolMinutes >= 15) {
    push(m.waitedForPatrolMinutes + 40, change(policy, 'contact_order',
      { strategy: 'neighbour_first', allowHeadContact: policy.contact_order.allowHeadContact },
      { title: '이장 대신 가까운 이웃에게 먼저 부탁한다',
        because: `이장이 순찰을 마치기를 ${m.waitedForPatrolMinutes}분 기다렸다.` }));
  }
  if (m.headAsks >= 2) {
    push(m.headAsks * 25, change(policy, 'helper_daily_cap',
      { perDay: clampInt(policy.helper_daily_cap.perDay - 1, 0, 10) },
      { title: '한 사람이 하루에 받는 부탁 수를 낮춘다',
        because: `이장 한 사람에게 부탁이 ${m.headAsks}번 갔다.` }));
  }
  if (m.refusals >= 1) {
    push(m.refusals * 20 + 10, change(policy, 'neighbour_ask_limit',
      { people: clampInt(policy.neighbour_ask_limit.people + 1, 1, 8) },
      { title: '거절당해도 한 사람 더 물어본다',
        because: `거절이 ${m.refusals}번 있었고, 그때마다 다음 사람을 찾는 데 시간이 들었다.` }));
  }
  if (m.subjectUpset) {
    push(70, change(policy, 'disclosure_scope', { level: 'minimal' },
      { title: '제3자에게는 응답이 없었다는 사실만 알린다',
        because: '확인 대상이 자기 일과가 남에게 전해진 것을 불쾌해했다.' }));
  }
  if (m.escalated) {
    push(55, change(policy, 'institution_deadline',
      { afterMinutes: clampInt((policy.institution_deadline.afterMinutes ?? 120) + 60, 5, 600) },
      { title: '기관으로 넘기기 전에 마을 안에서 더 기다린다',
        because: '기관으로 넘어간 뒤에 마을 안에서 해결되었다.' }));
  }
  if (m.rideRefused) {
    push(65, change(policy, 'ride_detour_limit',
      { maxDetourMinutes: clampInt(policy.ride_detour_limit.maxDetourMinutes + 20, 0, 120) },
      { title: '동승 우회 한도를 늘린다',
        because: '우회 시간이 한도를 넘어 아무도 태우러 가지 않았다.' }));
    push(60, change(policy, 'ride_candidate_order',
      { order: policy.ride_candidate_order.order === 'closest_first' ? 'kin_first' : 'closest_first' },
      { title: '동승을 부탁하는 순서를 바꾼다',
        because: '동선만 보고 고르면 펜션 쪽으로 가는 사람이 없다.' }));
  }

  // 채움 후보 — 위에서 셋이 안 나왔을 때만 쓴다. 일부러 반대 방향도 섞어 둔다.
  const fillers = [
    change(policy, 'quiet_period', { minutes: clampInt(policy.quiet_period.minutes + 15, 0, 240) },
      { title: '같은 사람에게 다시 연락하기까지 더 비워 둔다', because: '오늘은 큰 문제가 없었으니 연락의 밀도를 낮춰 본다.' }),
    change(policy, 'disclosure_scope', { level: policy.disclosure_scope.level === 'minimal' ? 'named' : 'minimal' },
      { title: '제3자에게 알리는 범위를 바꿔 본다', because: '부탁받은 사람이 상황을 얼마나 알아야 하는지 아직 모른다.' }),
    change(policy, 'retry_before_help',
      { count: clampInt(policy.retry_before_help.count + 1, 0, 6), intervalMinutes: policy.retry_before_help.intervalMinutes },
      { title: '본인에게 한 번 더 연락해 본다', because: '남을 부르기 전에 본인이 받을 기회를 늘려 본다.' }),
    change(policy, 'institution_deadline',
      { afterMinutes: clampInt((policy.institution_deadline.afterMinutes ?? 120) - 30, 5, 600) },
      { title: '기관 인계 기한을 앞당긴다', because: '마을 안에서 오래 끄는 것이 늘 나은지 확인해 본다.' }),
  ];

  // 내일 걸릴 규칙을 앞에 둔다. 고른 것이 다음 날에 아무 자리도 없으면 관람객은 자기 선택이
  // 반영되지 않았다고 느낀다. 그래도 오늘의 가장 큰 문제라면 표시를 달고 남겨 둔다.
  const binds = (c) => (nextBinding ? nextBinding.has(c.ruleType) : true);
  for (const c of [...cand, ...fillers]) c.bindsTomorrow = binds(c);

  const chosen = [];
  const taken = new Set();
  for (const c of cand.sort((a, b) => (binds(b) - binds(a)) * 1000 + (b.score - a.score))) {
    if (taken.has(c.ruleType)) continue;
    taken.add(c.ruleType);
    chosen.push(c);
    if (chosen.length === 3) break;
  }
  for (const f of fillers.sort((a, b) => binds(b) - binds(a))) {
    if (chosen.length === 3) break;
    if (taken.has(f.ruleType)) continue;
    taken.add(f.ruleType);
    chosen.push(f);
  }
  return chosen.slice(0, 3).map(({ score, ...c }) => c);
}

/** 선택을 정책에 반영한 새 정책. 원본은 건드리지 않는다. */
export function applyChange(policy, option) {
  const next = clone(policy);
  next[option.ruleType] = clone(option.after);
  return next;
}
