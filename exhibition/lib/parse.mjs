// 모델 출력 → { speaker(화자 id), text } 줄 배열.
//
// mas-parity 저장소 `runner/lib/parse.mjs` 를 그대로 옮긴 것이다. 조건 A(전지·일괄)로 받은
// 대화록을 같은 규칙으로 파싱해야 해서 고치지 않고 가져왔다.
//
// 화자 이름 매칭은 느슨하게 본다 — 대소문자 · 구두점 · 볼드 · 괄호 지문을 무시하고, 접두 일치와
// 첫 단어 일치까지 시도한다. 모델이 "Finance Lead"라고 줄여 쓰는 것을 파싱 실패로 버리면 아까운
// 생성물을 통째로 날리게 되기 때문이다.
// 다만 **끝내 명단에서 못 찾은 이름은 조용히 고치지 않는다.** 원문을 그대로 남기고 unknownSpeaker로
// 표시해 QC가 떨어뜨리게 한다 (SPEC §7.5).

/** 비교용 정규화: 소문자 · 장식 문자 제거 · 공백 축약. */
export function normName(s) {
  return String(s).toLowerCase().replace(/[*_`"“”‘’'()\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

/** 원문 이름 → 화자 id. 못 찾으면 null. */
export function matchSpeaker(sc, rawName) {
  const n = normName(rawName).replace(/\s*\(.*$/, ''); // "Manager (thoughtfully)" → "manager"
  for (const c of sc.characters) if (normName(c.name) === n) return c.id;

  // 접두 일치. 긴 이름부터 봐야 "Finance Lead"가 "Finance & Procurement Lead"로 간다.
  const byLength = [...sc.characters].sort((a, b) => b.name.length - a.name.length);
  for (const c of byLength) {
    const cn = normName(c.name);
    if (cn.startsWith(n) || n.startsWith(cn)) return c.id;
  }
  // 첫 단어 일치 (이름이 한 단어인 인물)
  for (const c of byLength) {
    const first = normName(c.name).split(' ')[0];
    if (first.length >= 3 && n.split(' ')[0] === first) return c.id;
  }
  return null;
}

// "- **Role**: text" · "1) Role: text" · "Role: text" 를 모두 받는다.
const LINE = /^\s*(?:[-*•]\s*)?(?:\d+[.)]\s*)?[*_]{0,2}\s*([^:：\n]{1,80}?)\s*[*_]{0,2}\s*[:：]\s*(.+?)\s*$/;
const NOISE = /^\[?end\]?$/i;
const FENCE = /^(---+|```.*)$/;

/**
 * 여러 줄 → 발화 배열.
 * 화자 표기가 없는 줄은 직전 발화에 이어 붙인다(모델이 한 발화를 두 줄로 흘리는 경우).
 * 버린 줄은 stray로 돌려준다 — 그 수 자체가 QC 신호다.
 */
export function parseDialogue(sc, text) {
  const lines = [];
  const stray = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (NOISE.test(line) || FENCE.test(line)) { stray.push(line); continue; }

    const m = LINE.exec(line);
    if (m) {
      const id = matchSpeaker(sc, m[1]);
      if (id) { lines.push({ speaker: id, text: m[2] }); continue; }
      // 화자처럼 보이는데 명단에 없다 — 고치지 않고 그대로 남겨 QC가 본다.
      if (m[1].split(' ').length <= 5) { lines.push({ speaker: m[1].trim(), text: m[2], unknownSpeaker: true }); continue; }
    }
    if (lines.length) lines[lines.length - 1].text += ' ' + line;
    else stray.push(line);
  }
  return { lines, stray };
}

/**
 * 한 발화만 기대할 때(첫 줄 · 마무리 · 턴별 생성). 첫 유효 줄을 취하고 나머지는 플래그로 남긴다.
 * expectId를 주면(B 에이전트) 화자를 그 인물로 강제한다 — 헤드가 정한 차례가 곧 조건의 정의이므로,
 * 에이전트가 남의 이름을 붙여 오면 텍스트만 쓰고 화자는 바로잡되 그 사실을 기록한다.
 */
export function parseOne(sc, text, expectId) {
  const { lines, stray } = parseDialogue(sc, text);
  const flags = [];

  if (lines.length === 0) {
    const fallback = String(text).trim().split(/\r?\n/)[0] || '';
    if (!fallback) return { line: null, flags: ['empty'] };
    if (expectId) return { line: { speaker: expectId, text: fallback }, flags: ['no-speaker-prefix'] };
    return { line: null, flags: ['unparseable'] };
  }

  if (lines.length > 1) flags.push(`multi-line:${lines.length}`);
  if (stray.length) flags.push('stray');

  let line = lines[0];
  if (expectId && line.speaker !== expectId) {
    flags.push(`speaker-mismatch:${line.speaker}`);
    line = { speaker: expectId, text: line.text };
  }
  if (line.unknownSpeaker) flags.push(`unknown-speaker:${line.speaker}`);
  return { line: { speaker: line.speaker, text: line.text }, flags };
}
