// 프롬프트 — mas-parity 조건 A(전지·일괄)를 한국어 장면으로 옮긴 것.
//
// 구조는 runner/prompts/{common,index}.mjs 와 같다:
//   · 서식 규칙은 상수 하나에서만 나온다 (호출마다 다른 값이 갈 길이 없다)
//   · 전지 시스템 프롬프트 = 상황 + 등장인물 전원 + 서식 규칙
//   · 사용자 메시지는 "총 N개의 발화"를 알려 주고 한 번에 전부 쓰게 한다
//
// 다른 점은 둘이다. (1) 한국어다. (2) 인물 소개를 우리가 쓰지 않고 익명 페르소나의
// system_prompt 를 그대로 붙인다 — 그 파일이 인터뷰에서 나온 단일 원본이기 때문이다.

import { hhmm } from './village.mjs';
import { MED, CLINIC, MEDIC, displayName } from './plan.mjs';
import { describePolicy } from './policy.mjs';

/** 서식 규칙. 모든 대화록 호출이 이 한 문자열을 받는다. */
export const FORMAT_RULES = `출력 형식(정확히 지킬 것):
- 발화 하나를 한 줄에 쓴다: <이름>: <하는 말>
- 아래 등장인물 명단의 이름만 쓴다. 해설자·사회자·그 밖의 사람을 넣지 않는다.
- 입으로 하는 말만 쓴다. 지문, 괄호 안의 어투·행동 설명, 별표, 마크다운, 이모지를 쓰지 않는다.
- 한 발화는 한두 문장, 대략 10~40자다. 길게 늘어놓지 않는다.
- 번호를 매기지 않고, 제목·빈 줄·요약을 붙이지 않는다.
- 발화 수나 분량에 대한 언급을 대사 안에 넣지 않는다.
- 경남 지역 사투리를 쓴다. 충청도·전라도 말투(~유, ~잉, ~겨)를 쓰지 않는다.
- **명단에 없는 사람의 이름을 지어내지 않는다.** 누군가를 가리켜야 하면 아래 '이 장면에 나오는 사람'에 적힌 이름만 쓴다.
- 사람을 이름으로 부를 때는 **명단에 적힌 이름 전체**를 쓴다. 줄임말·애칭(상덕이, 기웅이, 성재)을 쓰지 않는다. '형님'·'아재'·'어르신' 같은 관계 호칭은 그대로 써도 된다.
- **'일어난 일'에 없는 장소·일정·사건·병명을 지어내지 않는다.** 모르는 것은 말하지 않거나 모른다고 말한다.
- **시각은 '일어난 일'에 적힌 것만 말한다.** 거기 없는 시각을 지어내지 않는다. 특히 MEDial은 자기가 관측한 시각만 말하고, 그 시각을 바꿔 말하지 않는다.`;

/** MEDial의 인물 소개. 사람이 아니므로 페르소나 파일에 없다. 여기가 단일 원본이다. */
const MEDIAL_CARD = `MEDial
집에 걸린 마을 안내 시계에서 나오는 목소리다. 사람이 아니고, 마을 전체의 돌봄 요청을 조율한다.
말이 짧고 공손하다. 어르신이 알아듣는 쉬운 말을 쓰고, 한 번에 한 가지만 묻는다.
아는 것은 기기가 들은 것, 응답이 있었는지, 시각, 마지막 접촉뿐이다. 진단하지 않고 단정하지 않는다.
해결되지 않은 것을 해결되었다고 말하지 않는다. 사투리를 쓰지 않고 표준어로 말한다.`;

const CLINIC_CARD = `보건소 담당
면 보건소의 담당자다. 사무적이고 절차대로 말한다. 마을 사정을 자세히는 모른다.`;

const MEDIC_CARD = `구급대원
119 구급대원이다. 현장에서 짧고 분명하게 묻고 지시한다. 군더더기가 없다.`;

/** 등장인물 카드. 사람은 익명 페르소나의 system_prompt 를 그대로 쓴다. */
function characterCard(world, id) {
  if (id === MED) return MEDIAL_CARD;
  if (id === CLINIC) return CLINIC_CARD;
  if (id === MEDIC) return MEDIC_CARD;
  const p = world.by[id];
  const lines = [`${p.name} (${p.age}세)`, p.systemPrompt];
  if (p.dos.length) lines.push(`이 사람으로 말할 때 해야 할 것: ${p.dos.join(' ')}`);
  if (p.donts.length) lines.push(`하지 말 것: ${p.donts.join(' ')}`);
  return lines.join('\n');
}

const roleNames = (world, ids) => ids.map((id) => displayName(world, id));
const roleList = (world, ids) => roleNames(world, ids).map((n) => `- ${n}`).join('\n');

/** 마을 공통 배경. 모든 호출이 같은 텍스트를 본다. */
function settingBlock(world) {
  const c = world.common;
  const lines = ['남부 해안의 작은 어촌 마을이다. 열두 집이 산다.'];
  if (c['생활 조건']) lines.push(...c['생활 조건'].map((s) => `- ${s}`));
  return lines.join('\n');
}

/**
 * 조건 A — 전지 · 일괄. 한 번의 호출로 장면의 대화록 전체를 받는다.
 * 첫 줄을 따로 뽑지 않는다(mas-parity는 조건 A·B가 첫 줄을 공유해야 해서 나눴다. 여기는 A뿐이다).
 */
export function promptScene(world, { day, policy, task }) {
  const ids = [...new Set(task.actors)];
  const relevant = task.rules ?? RELEVANT_RULES[task.type] ?? [];
  const policySentences = describePolicy(policy)
    .filter((r) => relevant.includes(r.ruleType))
    .map((r) => `- ${r.sentence}`).join('\n');

  const system = [
    '너는 실제로 오갔을 법한 대화를 그대로 받아 적는 사람이다. 각색하지 않는다.',
    '',
    `상황:\n${settingBlock(world)}`,
    '',
    `등장인물:\n${roleList(world, ids)}`,
    '',
    ids.map((id) => characterCard(world, id)).join('\n\n'),
    '',
    FORMAT_RULES,
  ].join('\n');

  // 장면에 말은 안 하지만 화제가 되는 사람(확인 대상)의 이름을 못 박는다.
  const subject = task.about && world.by[task.about] ? world.by[task.about].name : null;
  const mentionable = [...new Set([...roleNames(world, ids), ...(subject ? [subject] : [])])];

  const user = [
    `${day}일차 ${hhmm(task.startAt)}. ${task.scene}`,
    '',
    `채널: ${task.channel}`,
    `이 장면에 나오는 사람: ${mentionable.join(', ')}` +
      (subject && !ids.includes(task.about)
        ? ` (${subject}은(는) ${task.aboutNote ?? '이 자리에 없고, 이야기의 대상이다'})`
        : ''),
    '',
    // ※ 로 표시된 줄은 모델에게만 주는 연기 지시다. 표시를 떼고 보낸다 —
    // 화면은 표시가 붙은 줄을 걸러 내므로, 관객은 "이렇게 말하라"는 지시를 보지 않는다.
    `일어난 일(이미 정해진 사실이다. 바꾸지 말고 이대로 말이 오가게 쓴다):\n${task.facts.map((f) => `- ${f.replace(/^※\s*/, '')}`).join('\n')}`,
    policySentences ? `\n이 장면에서 MEDial이 따르는 운영 규칙:\n${policySentences}` : '',
    '',
    `이 장면의 대화를 전부 써라. 발화는 정확히 ${task.budget}개다. 누가 몇 번 말하는지는 네가 정한다 — 고르게 나눌 필요는 없다.`,
    '한 줄에 발화 하나씩, 위 형식 그대로 출력한다.',
  ].filter((s) => s !== '').join('\n');

  return { system, user };
}

/** 규칙이 그 장면에 실제로 걸리는 것만 보여 준다 — 안 걸리는 규칙까지 넣으면 모델이 엉뚱한 말을 지어낸다. */
const RELEVANT_RULES = {
  contact: ['retry_before_help', 'quiet_period', 'disclosure_scope'],
  request_help: ['contact_order', 'neighbour_ask_limit', 'helper_daily_cap', 'disclosure_scope'],
  arrange_transport: ['ride_candidate_order', 'ride_detour_limit', 'helper_daily_cap'],
  escalate_handoff: ['institution_deadline', 'disclosure_scope'],
  notify_close: ['disclosure_scope'],
};

// ---------------------------------------------------------------------------
// 하루가 끝난 뒤 — 주민이 자기가 겪은 것만 근거로 말한다
// ---------------------------------------------------------------------------

/**
 * 합성 평가다. 실제 주민의 만족도가 아니다 (medial 경계 규칙).
 * 그래서 프롬프트가 **자기가 그날 겪은 사건만** 인용하게 하고, 겪지 않은 것은 '모르겠다'로 두게 한다.
 */
export function promptReviews(world, { day, tasks }) {
  const ids = [...new Set(tasks.flatMap((t) => t.actors))].filter((id) => world.by[id]);
  const experienced = ids.map((id) => {
    const mine = tasks.filter((t) => t.actors.includes(id));
    const head = `${world.by[id].name}이(가) 오늘 직접 한 일 (이것뿐이다):`;
    const body = mine.length
      ? mine.map((t) => `  - ${hhmm(t.startAt)} ${t.title}. ${t.scene} 여기에 ${world.by[id].name}이(가) 직접 있었다.`).join('\n')
      : '  - 없다. 오늘 이 시스템과 아무 일도 겪지 않았다.';
    return `${head}\n${body}`;
  }).join('\n\n');

  const system = [
    '너는 하루가 끝난 뒤 사람들에게 한마디씩 받아 적는 사람이다.',
    '',
    `등장인물:\n${roleList(world, ids)}`,
    '',
    ids.map((id) => characterCard(world, id)).join('\n\n'),
    '',
    `출력 형식(정확히 지킬 것):
- 한 사람에 한 줄. <이름>: <한 말>
- 명단의 이름만, 명단 순서대로 한 번씩만 쓴다.
- 그 사람이 **자기가 직접 겪은 일**만 근거로 말한다. 아래 목록에 없는 일은 말하지 않는다.
- **남이 겪은 일을 자기 일처럼 말하지 않는다.** 자기가 그 자리에 없었으면 꺼내지 않는다.
- 자기 자신을 3인칭으로 부르지 않고, 다른 사람의 이름을 자기 이름 자리에 쓰지 않는다.
- 겪은 것이 없거나 판단할 근거가 없으면 모른다고 말한다.
- 한두 문장, 입으로 하는 말만. 지문·괄호·별표·이모지를 쓰지 않는다.
- 경남 지역 사투리를 쓴다.`,
  ].join('\n');

  const user = [
    `${day}일차가 끝났다. 오늘 이 시스템이 한 일에 대해 각자 한마디씩 한다.`,
    '',
    experienced,
    '',
    `${ids.length}명이 한 줄씩, 정확히 ${ids.length}줄을 출력한다.`,
  ].join('\n');

  return { system, user };
}
