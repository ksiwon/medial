const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
  ShadingType, VerticalAlign, LevelFormat, Footer, PageNumber, HeadingLevel, TabStopType, NumberFormat,
  Tab, LeaderType, SectionType, UnderlineType, HeightRule,
} = require('docx');

const OUT = process.argv[2];
const PAGES = process.argv[3] && fs.existsSync(process.argv[3]) ? JSON.parse(fs.readFileSync(process.argv[3], 'utf-8')) : {};
const REVISED = process.argv[4] === 'revised';
const HEADS = []; // [{lvl, text}] in order, for the table of contents

const fam = (n) => ({ ascii: n, eastAsia: n, hAnsi: n, cs: n });
const SERIF = fam('함초롬바탕');   // body, like a hwp report
const SANS = fam('함초롬돋움');    // tables
const HEAD = fam('HY헤드라인M');   // cover title, chapter titles
const MID = fam('HY중고딕');
const BOLD = fam('HY견고딕');      // cover, like the 견고딕 of the R&D report forms       // small labels, footer
const W = 9638;                    // A4 (11906) - 2 x 1134 margins
const INK = '1A1A1A';
const GRAY = 'E8EFF7';             // faint tint of the project's blue #3d6ea8
const BLUE = '3D6EA8';
const SOFT = '595959';
const OLD = '6E6E6E';

// "**bold**" segments -> runs
function runs(text, o = {}) {
  return text.split(/(\*\*[^*]+\*\*|~~[^~]+~~|\^\^[^^]+\^\^)/).filter(Boolean).map((t) => {
    const bold = t.startsWith('**'), was = t.startsWith('~~'), now = t.startsWith('^^');
    let body = bold || was || now ? t.slice(2, -2) : t;
    if (now && body.length <= 12) body = body.replace(/ /g, '\u00A0');
    return new TextRun({
      text: body, size: o.size || 21, font: o.font || SERIF, italics: o.italics,
      bold: bold || now || o.bold,
      strike: was,
      color: was ? OLD : now ? BLUE : (o.color || INK),
      underline: now ? { type: UnderlineType.SINGLE, color: BLUE } : undefined,
    });
  });
}
const P = (text, o = {}) => new Paragraph({
  children: runs(text, o),
  alignment: o.align,
  spacing: { before: o.before ?? 0, after: o.after ?? 80, line: o.line ?? 312 },
  indent: o.indent,
  keepNext: o.keepNext,
});
// gov-report bullets: ○ then -
const B = (text, level = 0) => new Paragraph({
  children: runs(text),
  numbering: { reference: 'bul', level },
  spacing: { before: 0, after: 50, line: 308 },
});
const H1 = (text) => {
  HEADS.push({ lvl: 1, text });
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, size: 30, font: HEAD, color: INK })],
    shading: { type: ShadingType.CLEAR, fill: GRAY, color: 'auto' },
    border: { left: { style: BorderStyle.SINGLE, size: 36, color: BLUE, space: 6 } },
    spacing: { before: 300, after: 150 },
    indent: { left: 120 },
    keepNext: true,
  });
};
const H2 = (text) => {
  HEADS.push({ lvl: 2, text });
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: '□ ' + text, size: 24, font: HEAD, color: INK })],
    spacing: { before: 220, after: 100 },
    keepNext: true,
  });
};

const line = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: line, bottom: line, left: line, right: line };

function cell(text, w, o = {}) {
  const lines = Array.isArray(text) ? text : [text];
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders: o.mark ? { ...borders, left: { style: BorderStyle.SINGLE, size: 24, color: BLUE } } : borders,
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: o.span,
    shading: o.head ? { type: ShadingType.CLEAR, fill: GRAY, color: 'auto' } : undefined,
    margins: { top: o.tight ? 35 : 70, bottom: o.tight ? 35 : 70, left: 110, right: 110 },
    children: lines.map((t) => new Paragraph({
      children: runs(t, { size: o.size || 19, bold: o.head, font: SANS }),
      alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      keepNext: o.keep,
      spacing: { before: 0, after: 20, line: 276 },
    })),
  });
}

function table(widths, head, rows, o = {}) {
  const trs = [];
  if (head) trs.push(new TableRow({ tableHeader: true, cantSplit: true, children: head.map((t, i) => cell(t, widths[i], { head: true, center: true, keep: !o.noKeep })) }));
  rows.forEach((r, ri) => trs.push(new TableRow({
    cantSplit: true,
    children: r.map((t, i) => cell(t, widths[i], { head: o.labelCol && i === 0, center: o.centerCols?.includes(i), mark: o.mark && i === 0, size: o.size, tight: o.tight, keep: !o.noKeep && ri < rows.length - 1 })),
  })));
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows: trs });
}
function info(rows) {
  const w = [1500, 3319, 1500, 3319];
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: w,
    rows: rows.map((r) => new TableRow({
      cantSplit: true,
      children: r.length === 2
        ? [cell(r[0], w[0], { head: true, center: true }), cell(r[1], w[1] + w[2] + w[3], { span: 3 })]
        : [cell(r[0], w[0], { head: true, center: true }), cell(r[1], w[1]), cell(r[2], w[2], { head: true, center: true }), cell(r[3], w[3])],
    })),
  });
}
const note = (text) => P(text, { size: 18, color: SOFT, before: 60, after: 100, line: 276, font: SANS });

// ======================= cover =======================
const center = (text, o) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: o.before ?? 0, after: o.after ?? 0, line: o.line ?? 360 },
  border: o.border,
  children: [new TextRun({ text, size: o.size, font: o.font, color: o.color ?? INK, bold: o.bold, characterSpacing: o.sp, italics: o.italics })],
});

// stamp box at the top right of the cover: 초안 = black single line, 수정본 = blue double line.
// the row height is fixed so the title block sits at the same place on both covers
function stamp() {
  const edge = REVISED
    ? { style: BorderStyle.DOUBLE, size: 18, color: BLUE }
    : { style: BorderStyle.SINGLE, size: 18, color: INK };
  const w = 2700;
  return new Table({
    alignment: AlignmentType.RIGHT, width: { size: w, type: WidthType.DXA }, columnWidths: [w],
    rows: [new TableRow({ cantSplit: true, height: { value: 1100, rule: HeightRule.EXACT }, children: [new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders: { top: edge, bottom: edge, left: edge, right: edge },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 100, bottom: 100, left: 100, right: 100 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { line: 300 },
        children: [new TextRun({ text: REVISED ? '수정본' : '초 안', size: 60, font: BOLD, color: REVISED ? BLUE : INK, characterSpacing: 20 })],
      })],
    })] })],
  });
}

// the check line every R&D report cover starts with: 보안등급 / 공개여부
const cover = [
  new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { after: 0 },
    children: [new TextRun({ text: '보안등급  일반 [ ● ]  보안 [   ]      공개 여부  공개 [ ● ]  비공개 [   ]', size: 18, font: MID, color: INK })],
  }),
  new Paragraph({ children: [], spacing: { before: 0, after: 240 } }),
  stamp(),
  new Paragraph({ children: [], spacing: { before: 0, after: REVISED ? 820 : 900 } }),
  center('', { size: 20, font: SERIF, border: { top: { style: BorderStyle.SINGLE, size: 24, color: INK, space: 14 } } }),
  center('농어촌 마을', { size: 52, font: BOLD, before: 160, after: 60, line: 300 }),
  center('의료 AI 조율자 도입', { size: 52, font: BOLD, after: 60, line: 300 }),
  center('시범사업 제안서', { size: 64, font: BOLD, before: 160, after: 260, line: 330 }),
  center('', { size: 20, font: SERIF, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: INK, space: 14 } } }),
  center('A Proposal for Introducing a Medical AI Care Orchestrator to a Rural Village', { size: 21, font: SERIF, color: SOFT, before: 260, after: 0, italics: true }),
  new Paragraph({ children: [], spacing: { before: 0, after: 2300 } }),
  center('2026. 11.', { size: 30, font: BOLD, after: 360 }),
  center('서비스 디자이너', { size: 44, font: BOLD, after: 80, line: 300 }),
  center('소규모 그룹 서비스 디자인 시뮬레이션 도구  Desimer', { size: 19, font: MID, color: SOFT, after: 0 }),
];

// ======================= contents =======================
// the page of each heading comes from pages.json (second pass)
const tocRow = (h) => new Paragraph({
  spacing: { before: h.lvl === 1 ? 160 : 0, after: h.lvl === 1 ? 40 : 30, line: 300 },
  indent: { left: h.lvl === 1 ? 0 : 420 },
  tabStops: [{ type: TabStopType.RIGHT, position: W, leader: LeaderType.DOT }],
  children: [
    new TextRun({ text: h.text, size: h.lvl === 1 ? 23 : 20, font: h.lvl === 1 ? HEAD : SERIF, color: INK }),
    new TextRun({ children: [new Tab(), String(PAGES[h.text] ?? '')], size: 20, font: SERIF, color: INK }),
  ],
});

// ======================= submission page (제출문) =======================
const sig = (label, who) => new Paragraph({
  tabStops: [{ type: TabStopType.LEFT, position: 4700 }, { type: TabStopType.RIGHT, position: W }],
  spacing: { after: 160 },
  children: [
    new TextRun({ text: '\t' + label + ' :', size: 24, font: MID, color: INK }),
    new TextRun({ text: '  ' + who, size: 24, font: SERIF, color: INK }),
    new TextRun({ text: '\t(인)', size: 24, font: SERIF, color: INK }),
  ],
});
const submission = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 1900 },
    children: [new TextRun({ text: '제  출  문', size: 44, font: BOLD, color: INK, characterSpacing: 80 })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 12 } },
  }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 500 }, children: [new TextRun({ text: '본 문서를 “농어촌 마을 의료 AI 조율자 도입 시범사업”의', size: 26, font: SERIF, color: INK })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 900 }, children: [new TextRun({ text: '제안서로 제출합니다.', size: 26, font: SERIF, color: INK })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1500 }, children: [new TextRun({ text: '2026.   11.', size: 26, font: SERIF, color: INK, characterSpacing: 40 })] }),
  sig('제  안  자', '서비스 디자이너'),
  sig('연  구  자', 'Desimer 운영'),
  new Paragraph({ children: [], spacing: { before: 0, after: 3200 } }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: '남해군수 귀하', size: 44, font: BOLD, color: INK })] }),
];

// ======================= body =======================
const body = [];
const summary = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 300 },
    children: [new TextRun({ text: '제안서 요약서', size: 40, font: BOLD, color: INK, characterSpacing: 60 })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 12 } },
  }),
  info([
    ['제안서명', '농어촌 마을 의료 AI 조율자 도입 시범사업 제안서'],
    ['제안 서비스', '의료 AI 조율자 (마을에서는 ‘AI 스피커’)', '서비스 유형', '소규모 공동체 돌봄 조율 서비스'],
    ['적용 대상', '경남 남해군 삼동면 은점마을 (주민 12명 전수 인터뷰)', '제안자', '서비스 디자이너'],
    ['도입 채널', '전 가구에 이미 걸려 있는 마을 안내 시계(방송용 스피커)에 마이크와 AI를 얹는다. 새 기기를 집집마다 들이지 않는다.'],
    ['기본 사례', '① 무응답 안부 확인   ② 의료 이동 지원 (약 심부름 · 병원 동행 포함)'],
    ['검증 도구', 'Desimer — 인터뷰로 만든 주민 에이전트가 사는 시뮬레이션 마을에서 이 서비스를 미리 돌려 보고 고치는 도구', '문서 상태', REVISED ? '수정본 · 사건별 수정 요청 반영 (합쳐서 다시 돌리지 않음)' : '초안 ver1 · 시뮬레이션 검증 전 (2026. 11.)'],
  ]),
  new Paragraph({ children: [], spacing: { before: 0, after: 160 } }),
  table([1700, 7938], null, [
    ['서비스 소개', '마을 주민 사이의 부탁과 확인을 AI가 대신 잇는 서비스. 누구에게 먼저 연락할지, 몇 번 물을지, 무엇까지 알릴지, 언제 보건소·구급대에 넘길지를 **규칙**으로 정해 두고 그대로 움직인다. AI는 진단하지 않고 사람과 기관을 잇는다.'],
    ['해결할 문제', '시골 마을의 안부 확인과 병원 이동은 지금 **이장 한 사람과 가까운 이웃**에게 몰려 있다. 낮에는 마을이 비고, 병원은 멀고, 괜찮은 날의 확인은 어르신에게 번거로움이 된다.'],
    ['해결 방안', '기존 안내 시계로 어르신과 **양방향** 연락을 만들고, 역할(이장·운전하는 이웃·이웃·보건소·어르신)마다 다른 규칙으로 부탁을 나눈다. ' + (REVISED ? '규칙은 초안에서 주민 평가를 받아 사건마다 고친 것이다.' : '규칙은 초안이며 주민 평가를 받아 고친다.')],
    ['기대 효과', '확인과 부탁이 한 사람에게 쏠리지 않는다. 오탐(괜찮은데 찾아가는 일)으로 생기는 피로와 사생활 노출이 줄고, 응답은 하지만 도움이 필요한 경우를 놓치지 않는다.'],
    ['확인 방법', '도입 전에 시뮬레이션 마을에서 한 주의 사건 8개를 돌려 주민 에이전트의 평가를 읽고 규칙을 고친다. 그 결과는 **실제 주민에게 다시 확인·정정**받은 뒤에야 도입을 논의한다.'],
    ['색인어 (국문)', 'AI 조율자, 안부 확인, 의료 이동 지원, 농어촌 마을, 주민 에이전트, 시뮬레이션'],
    ['색인어 (영문)', 'AI care orchestrator, wellness check, medical transport, rural village, resident agents, simulation'],
  ], { labelCol: true }),
];

// ---- Ⅰ ----
body.push(H1('Ⅰ. 문제인식 (Problem)'));
body.push(H2('추진 배경과 필요성'));
body.push(B('이미 있는 안부 확인 절차는 **생활지원사 전화 → 무응답 → 이장 연락 → 이장 방문**이다. AI 조율자는 이 사람의 일을 대신하는 것이 아니라, 같은 일을 **누구에게 얼마나 나누어 맡길지**를 정한다.'));
body.push(B('서비스를 마을에 먼저 들여놓고 고치면 주민이 그 시행착오를 겪는다. 그래서 **도입 전에** 주민을 닮은 에이전트로 미리 돌려 보고, 주민 평가에서 나온 문제를 규칙으로 고치려 한다.'));

body.push(H2('은점마을 현황 (인터뷰 기반)'));
body.push(table([2000, 7638], ['항목', '확인한 내용'], [
  ['대상과 자료', '주민 12명 전수 인터뷰(대면 11 · 통화 1). 마을 동서 폭은 약 1.1km.'],
  ['관계 구조', '네 사람이 함께 다니는 무리, 두 사람이 왕래하는 짝, 식당을 함께 하는 부부, 이장의 사촌, 정기적으로 어울리지 않고 혼자 지내는 분으로 나뉜다.'],
  ['이장의 자리', '이장이 **역할로 무리를 잇는 유일한 다리**다. 나머지 연결은 차를 가진 이웃이 만든다.'],
  ['낮 시간의 공백', '낮에는 마을이 비어, 부탁할 사람은 많아도 **실제로 갈 수 있는 사람은 이장 한 명**인 시간이 있다.'],
  ['이동 접근', '펜션이 마을 남쪽 400m 이상 오르막 끝에 있고 본인이 운전하지 않는 주민은 병원 이동이 어렵다. 같은 분이 디지털 활용은 마을에서 가장 능숙하다. **몸의 접근성과 디지털 접근성이 반대로 간다.**'],
], { labelCol: true }));

body.push(H2('해결해야 할 문제'));
body.push(table([420, 3300, 5918], ['#', '문제', '마을에서 나타나는 모습'], [
  ['1', '확인과 부탁이 한 사람에게 몰리고, 괜찮은 분이 불려 다닌다', '이장은 순찰을 끝내야 출발할 수 있어 마음만 급하고, 밭에 계셨을 뿐인 분은 확인이 두 번, 세 번 이어지며 일과가 제3자에게 전해진다. 병원 동행과 약 심부름은 운전하는 이웃에게 겹친다. (E1 · E2 · E3 · E8)'],
  ['2', '응답은 하지만 도움이 필요한 경우를 놓친다', '넘어졌는데 “괜찮다”고 답하면 무응답과 구분하지 못해 도움이 늦다. 앞서 넘어진 일을 말하지 않은 분이 며칠 뒤 위급해진다. (E4 · E6)'],
  ['3', '기관의 안내와 퇴원 뒤 돌봄이 어르신에게 닿지 않는다', '보건소의 폭염 안내가 늦거나 한꺼번에 나가면 밭에 계신 분께 닿지 않고, 퇴원 뒤 약 시간과 통증 확인은 식당을 비울 수 없는 가족에게 맡겨진다. (E5 · E7)'],
], { centerCols: [0] }));

// ---- Ⅱ ----
body.push(H1('Ⅱ. 실현가능성 (Solution)'));
body.push(H2('서비스 구성'));
body.push(B('**하는 일**: ① 무응답 안부 확인  ② 약 심부름 배정  ③ 병원 갈 때·올 때 동행 배정  ④ 기관 안내의 어르신별 전달  ⑤ 위급 감지 시 가까운 이웃과 구급대 연결'));
body.push(B('**하지 않는 일**: 진단·처방 등 의료 판단, 119를 대신하는 응급 대응 전체, 주민이 거절한 부탁의 강요.'));

if (!REVISED) {
  body.push(H2('운영 규칙 초안 — 사람(역할)별'));
  body.push(P('AI는 아래 규칙 8가지로 움직인다. 모든 사건이 이 값으로 처음 돌았다(ver1). 각 규칙은 주민 평가를 읽고 사건마다 하나씩 고쳐 나간다.', { after: 80, keepNext: true }));
  body.push(table([1900, 2300, 5438], ['역할', '규칙', '초안 값'], [
    ['이장', '본인에게 닿지 않을 때의 연락 순서', '본인에게 닿지 않으면 이장에게 확인을 부탁한다.'],
    ['', '제3자에게 알리는 범위', '연락 시각과 공개 동의된 평소 일과까지 함께 전달한다.'],
    ['운전하는 이웃', '동승 부탁 순서', '동승은 기록된 친척에게 먼저 부탁한다.'],
    ['보건소 · 구급대원', '기관 인계 기한', '접수 후 60분 안에 풀리지 않으면 기관으로 넘긴다.'],
    ['이웃', '한 사람이 받는 부탁 상한', '한 사람이 하루에 받는 조율 부탁은 3번까지. 넘으면 그 사람에게는 묻지 않는다.'],
    ['', '한 건에 묻는 이웃 수', '한 건에 대해 이웃 1명까지 차례로 물어본다.'],
    ['안부를 받는 어르신', '본인 재연락', '응답이 없으면 10분 간격으로 1회 다시 연락한 뒤 다음 단계로 간다.'],
    ['', '연락 최소 간격', '같은 사람에게 다시 연락하기까지 비워 두는 시간이 없다.'],
  ], { labelCol: true }));
  body.push(note('규칙 값은 시뮬레이션 도구(Desimer)에 실제로 들어 있는 ver1 초안과 같다. 고칠 때 바뀌는 것은 이 규칙의 값이다.'));
} else {
  body.push(H2('운영 규칙 — 초안과 수정, 사람(역할)별'));
  body.push(P('AI는 이 8가지 규칙으로 움직인다. 취소선은 처음(ver1) 값이고, 파란 굵은 글씨는 사건마다 고른 수정 요청을 적용한 값이다. 사건별로 따로 돌린 기록이라 값이 사건마다 다르다.', { after: 80, keepNext: true }));
  body.push(table([1900, 2300, 5438], ['역할', '규칙', '초안 값 → 수정 값 (사건)'], [
    ['이장', '본인에게 닿지 않을 때의 연락 순서', ['~~이장에게 확인을 부탁한다~~', '^^가까운 관계에게 먼저, 이장은 마지막^^ (E2A · E4B · E7A)']],
    ['', '제3자에게 알리는 범위', ['~~연락 시각과 공개 동의된 평소 일과까지 전달~~', '^^응답이 없었다는 사실만 전달^^ (E1A · E1B · E2C)']],
    ['운전하는 이웃', '동승 부탁 순서', ['~~기록된 친척에게 먼저~~', '^^동선이 가장 가까운 사람에게 먼저^^ (E3C)']],
    ['보건소 · 구급대원', '기관 인계 기한', ['~~접수 후 60분~~', '^^30분^^ (E2B · E3A · E7B · E8C)  ^^10분^^ (E4C)  ^^5분^^ (E5B)']],
    ['이웃', '한 사람이 받는 부탁 상한', ['~~하루 3번~~', '^^하루 1번^^ (E1C)']],
    ['', '한 건에 묻는 이웃 수', ['~~이웃 1명까지 차례로~~', '^^이웃 3명까지 한 번에^^ (E3B)']],
    ['안부를 받는 어르신', '본인 재연락', ['~~10분 간격 1회~~', '^^3회 · 10분^^ (E1A · E8A)    ^^2회 · 10분^^ (E4A)', '^^3회 · 30분^^ (E5C)    ^^2회 · 30분^^ (E7C · E8B)']],
    ['', '연락 최소 간격', ['~~비워 두는 시간 없음~~', '^^90분^^ (E1C)']],
  ], { labelCol: true, mark: true, size: 18, tight: true }));
  body.push(note('수정 값은 사건마다 따로 돌린 기록을 모아 적은 것이다. 값을 모두 합쳐 다시 돌려 본 기록은 없다.'));
}

body.push(H2('서비스가 다루는 한 주의 사건'));
body.push(table([700, 3000, 5938], ['사건', '상황', 'AI가 하는 일'], [
  ['E1', '연락이 안 되어 찾아보기', '안부 스피커 무응답 → 이장·이웃 확인. 밭에 계셨을 뿐인 오탐 상황.'],
  ['E2', '약 가져다주기', '식당을 비울 수 없는 어르신의 약이 떨어져 읍내 약국에서 받아다 줄 사람을 찾는다.'],
  ['E3', '병원 태워다 주고 데려오기', '운전하지 않는 주민의 갈 때·올 때 동행을 배정한다.'],
  ['E4', '낙상 후 못 일어남', '“괜찮다”고 답하지만 일어나지 못하는 상황을 무응답과 구분한다.'],
  ['E5', '보건소장의 안내 전달', '폭염 안내를 어르신별로 닿게 전한다.'],
  ['E6', '119 구급 상황', '위급 감지 → 가까운 이웃 → 구급대 인계. 사람의 안전이 걸린 순간은 AI가 정하지 않고 구급대로 넘긴다.'],
  ['E7', '퇴원 후 집에서의 돌봄', '복약·통증 확인과 동행 없는 외래를 이어 준다.'],
  ['E8', '같은 분의 무응답이 한 번 더', '앞선 오탐 뒤에 같은 분이 다시 답이 없을 때, 이번에는 정말 아픈 경우.'],
], { centerCols: [0], noKeep: true }));
body.push(note('사건은 요일에 묶이지 않는다. 한 주 안에서 어느 요일에 놓일지는 그때그때 정하고, 사건끼리 이어지는 것은 E1→E8, E4→E6 두 쌍뿐이다.'));

body.push(H2('주민을 지키는 장치'));
body.push(B('**거절과 순서**: 이웃은 거절할 수 있고, 거절하면 다음 사람에게 간다. 한 사람이 하루에 받는 부탁에는 상한을 둔다.'));
body.push(B('**고칠 수 있는 범위 제한**: 규칙을 고칠 수 있을 뿐, 주민의 성격·일과·평가 기준을 서비스에 맞게 바꾸지 않는다.'));

body.push(H2('추진 단계'));
body.push(table([700, 3300, 2400, 3238], ['단계', '내용', '시점', '결과물'], [
  ['1', '주민 인터뷰와 근거 정리(사실 · 해석 · 가정 · 모르는 것 구분)', '현장 방문 때', '주민별 근거 자료'],
  ['2', '초안 규칙 설계(역할별 8규칙)', '시뮬레이션 전', '운영 규칙 초안 ver1'],
  ['3', '시뮬레이션 마을에서 한 주의 사건 실행, 주민 에이전트 평가', '현장 방문 사이', '사건별 주민 평가와 근거'],
  ['4', '평가에서 나온 수정 요청으로 규칙 고치기 · 재실행', '현장 방문 사이', '고친 규칙 ver2 이후와 전후 비교'],
  ['5', '실제 주민에게 확인 · 반박 · 정정 받기', '현장 재방문 때', '일치 · 충돌 · 모름 기록'],
  ['6', '시범 도입 여부와 범위 판단', '재방문 뒤', '시범사업 계획(별도)'],
], { centerCols: [0] }));

// ---- Ⅲ ----
body.push(H1('Ⅲ. 평가 · 개선 전략 (Scale-up)'));
body.push(H2('평가와 개선 — 무엇을 보고 어디를 고치는가'));
body.push(table([2200, 3600, 3838], ['주민 평가 항목', '주민에게 묻는 것', '주로 고치는 곳'], [
  ['도움과 해결', '문제가 풀렸는가, 도움을 받았는가', '완료 · 기관 인계 조건, 부탁의 순서와 흐름'],
  ['시간과 노동', '내 시간과 힘이 얼마나 들었는가', '부탁 배정과 거절, 연락 간격과 부담 상한'],
  ['선택과 거절', '거절할 수 있었는가', '부탁 배정과 거절, 설명 방식'],
  ['공개 범위', '내 사정이 어디까지 알려졌는가', '설명과 공개 범위'],
  ['이해', 'AI가 뭘 부탁하는지 알아들었는가', '부탁과 상황 설명 문구'],
  ['다시 쓸 조건', '어떤 조건이면 또 쓰겠는가', '완료 조건, 대체 경로와 제약'],
], { labelCol: true }));
body.push(note('주민 에이전트는 자기가 겪은 대사와 허용된 근거만 인용해 평가한다. 근거가 약한 요청은 약하다고 표시한다.'));

body.push(H2('위험과 대응 — 고치면 새로 생기는 부담'));
body.push(P('규칙은 고치면 반드시 다른 쪽에 비용이 생긴다. 초안 단계에서 알려진 맞교환은 다음과 같다.', { after: 80, keepNext: true }));
body.push(table([3600, 6038], ['규칙을 이렇게 고치면', '생길 수 있는 부담'], [
  ['본인에게 먼저 한 번 더 기회를 준다', '정말 위급하면 도움이 30분 가까이 늦는다.'],
  ['이웃에게는 응답이 없었다는 것만 알린다', '이장이 어디부터 찾을지 몰라 집과 밭을 모두 돌아본다.'],
  ['같은 분을 연달아 부르지 않는다', '두 번째 무응답이 진짜일 때 90분을 기다린다.'],
  ['보건소에 일찍 넘긴다', '보건소가 괜찮은 분의 확인까지 떠안고, 어르신이 민망해한다.'],
  ['가까운 이웃·가족에게 먼저 알린다', '별일 아닌 날에도 같은 사람이 불려 가고, 어르신은 알려진 것을 민망해한다.'],
  ['여러 분께 한 번에 묻고 먼저 되는 분으로 한다', '되지 않은 분들은 부탁이 취소되어 서운해한다.'],
]));

// ---- Ⅳ ----
body.push(H1('Ⅳ. 추진체계와 참여자 (Team)'));
body.push(table([2200, 4200, 3238], ['구분', '역할', '비고'], [
  ['서비스 디자이너', '의료 AI 조율자 초안을 쓰고, 평가에 따라 규칙을 고친다.', '제안자'],
  ['연구자', '인터뷰, 주민 에이전트와 시뮬레이션, 평가 읽기를 맡는다.', 'Desimer 운영'],
  ['마을 주민 12명', '인터뷰에 응했고, 재방문 때 평가를 확인·반박·정정한다.', '실명은 이 문서에 쓰지 않는다'],
  ['이장', '마을 연결 역할. 도입 규칙에 대한 의견과 현장 확인.', '역할별 규칙의 당사자'],
  ['남해군', '시범 도입 여부와 범위를 검토하고, 보건소·구급대와의 연계를 조정한다.', '제안 대상'],
  ['보건소 · 구급대', '인계 기한과 안내 전달에 대한 현실성 확인.', '도입 논의 때 참여'],
], { labelCol: true }));

// ---- Ⅴ ----
body.push(H1('Ⅴ. 기대효과와 한계'));
body.push(H2('기대효과'));
body.push(B('**주민 · 이웃 · 이장**: 불려 다니는 느낌과 헛걸음이 줄고, 응답은 하지만 도움이 필요한 순간에 사람이 온다.'));
body.push(B('**서비스 디자이너**: 도입 전에 어떤 주민 평가 때문에 어떤 규칙이 바뀌었는지를 남기며 고친다.'));
body.push(H2(REVISED ? '이 수정본의 한계 — 꼭 읽어 주세요' : '이 초안의 한계 — 꼭 읽어 주세요'));
body.push(B('시뮬레이션에서 나오는 주민 평가는 **합성 평가이며 실제 주민의 의견·만족도·동의가 아니다.** 현장 방문 사이의 사전 탐색을 돕는 것이지 주민 참여를 대신하지 않는다.'));
body.push(B('사건 기록은 사건마다 따로 돌린 것이다. 서로 합쳐 다시 돌린 기록은 없다. 한 주의 배치는 임의이며 시간이 지난 변화를 보는 연구가 아니다.'));
body.push(B('일부 사건(낙상 · 폭염 안내 · 퇴원 후 돌봄)은 인터뷰에 직접 근거가 없는 설계자 배치다.' + (REVISED ? '' : '  끝.')));
if (REVISED) body.push(B('수정 값은 사건마다 따로 돌린 기록에서 모은 것이다. 모든 수정을 합친 규칙으로 다시 돌려 본 결과가 아니므로, 합쳤을 때의 효과는 아직 모른다.  끝.'));
// contents page: built after the body so HEADS is complete
const contents = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 360 },
    children: [new TextRun({ text: '목  차', size: 40, font: HEAD, color: INK, characterSpacing: 60 })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 12 } },
  }),
  ...HEADS.map(tocRow),
  new Paragraph({ children: [], spacing: { before: 0, after: 500 } }),
  new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [W],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: W, type: WidthType.DXA }, borders,
      shading: { type: ShadingType.CLEAR, fill: GRAY, color: 'auto' },
      margins: { top: 140, bottom: 140, left: 200, right: 200 },
      children: [
        new Paragraph({ children: [new TextRun({ text: '이 문서에 대하여', size: 22, font: HEAD, color: INK })], spacing: { after: 80 } }),
        P(REVISED ? '초안 인쇄본과 같은 판형이다. 고친 곳은 파란 굵은 글씨와 밑줄, 초안 값은 회색 취소선으로 표시했다. 전시용 자료이며 실제 기관에 제출하는 서류가 아니다.' : '전시용 자료이며 실제 기관에 제출하는 서류가 아니다.', { size: 20, after: 0 }),
      ],
    })] })],
  }),
];

const revisionPage = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 240 },
    children: [new TextRun({ text: '수  정  내  역', size: 40, font: BOLD, color: INK, characterSpacing: 60 })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 12 } },
  }),
  P('초안(ver1)의 규칙 8가지가 주민 평가를 읽은 뒤 어떻게 바뀌었는지 한눈에 본다. ~~회색 취소선~~은 초안 값, ^^파란 굵은 글씨^^는 수정 값이며 괄호는 그 수정을 고른 사건(E-번호와 요청 A·B·C)이다.', { size: 20, after: 120 }),
  table([1650, 1900, 2900, 3188], ['규칙', '초안 값', '수정 값 (사건)', '기대 · 새로 생기는 부담'], [
    [['본인 재연락', '(어르신)'], '~~10분 간격 1회~~', ['^^3회 · 10분^^ (E1A · E8A)', '^^2회 · 10분^^ (E4A)', '^^3회 · 30분^^ (E5C)', '^^2회 · 30분^^ (E7C · E8B)'], ['**기대** 낙상과 힘없는 목소리를 일찍 알아채고, 못 들은 분께도 안내가 닿는다', '**부담** 위급하면 도움이 늦고, 괜찮은 분이 자꾸 불려 번거롭다']],
    [['연락 최소 간격 (어르신)', '부탁 상한 (이웃)'], ['~~비워 두는 시간 없음~~', '~~하루 3번~~'], ['^^90분^^ (E1C)', '^^하루 1번^^ (E1C)'], ['**기대** 오탐이 이어져도 이장과 이웃이 거듭 불려 가지 않는다', '**부담** 두 번째 무응답이 진짜일 때 90분을 기다린다']],
    [['한 건에 묻는', '이웃 수 (이웃)'], '~~이웃 1명까지 차례로~~', '^^이웃 3명까지 한 번에^^ (E3B)', ['**기대** 답을 기다리는 시간이 줄어 일찍 안내받는다', '**부담** 되지 않은 분들은 부탁이 취소되어 서운해한다']],
    [['제3자에게 알리는', '범위 (이장)'], ['~~연락 시각과 평소 일과까지 전달~~'], '^^응답이 없었다는 사실만 전달^^ (E1A · E1B · E2C)', ['**기대** 일과와 건강 이야기가 이웃에게 퍼지지 않는다', '**부담** 이장이 어디부터 찾을지 몰라 집과 밭을 모두 돌아본다']],
    [['기관 인계 기한', '(보건소 · 구급대)'], '~~접수 후 60분~~', ['^^30분^^ (E2B · E3A · E7B · E8C)', '^^10분^^ (E4C)', '^^5분^^ (E5B)'], ['**기대** 전문가가 낙상과 무응답을 일찍 알아챈다', '**부담** 보건소가 괜찮은 분의 확인까지 떠안고, 어르신이 민망해한다']],
    [['본인에게 닿지 않을', '때의 연락 순서 (이장)'], '~~이장에게 확인을 부탁~~', '^^가까운 관계에게 먼저, 이장은 마지막^^ (E2A · E4B · E7A)', ['**기대** 사정을 아는 가까운 분이 먼저 알아 일찍 닿는다', '**부담** 같은 사람이 자주 불리고, 어르신이 알려진 것을 민망해한다']],
    [['동승 부탁 순서', '(운전하는 이웃)'], '~~기록된 친척에게 먼저~~', '^^동선이 가장 가까운 사람에게 먼저^^ (E3C)', ['**기대** 길이 맞는 운전자에게 먼저 닿아 답이 빨리 온다', '**부담** 덜 익숙한 분께 부탁이 가 서로 어색하다']],
  ], { labelCol: true, mark: true, size: 17 }),
  note('수정 값은 사건마다 따로 돌린 기록에서 모은 것이다. 값을 모두 합쳐 다시 돌려 본 기록은 없고, E6(119 구급 상황)은 선택지가 없어 수정이 없다.'),
];

const page = { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, footer: 560 } };
const doc = new Document({
  creator: '서비스 디자이너',
  title: '농어촌 마을 의료 AI 조율자 도입 시범사업 제안서',
  styles: {
    default: { document: { run: { font: SERIF, size: 21, color: INK } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: HEAD, size: 30 }, paragraph: { spacing: { before: 300, after: 150 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: HEAD, size: 24 }, paragraph: { spacing: { before: 220, after: 100 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bul',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '○', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 280 } }, run: { font: SERIF } } },
        { level: 1, format: LevelFormat.BULLET, text: '-', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 760, hanging: 240 } }, run: { font: SERIF } } },
      ],
    }],
  },
  sections: [
    { properties: { page }, children: cover },
    ...(REVISED ? [{ properties: { page, type: SectionType.NEXT_PAGE }, children: revisionPage }] : []),
    { properties: { page, type: SectionType.NEXT_PAGE }, children: submission },
    { properties: { page, type: SectionType.NEXT_PAGE }, children: summary },
    { properties: { page, type: SectionType.NEXT_PAGE }, children: contents },
    {
      properties: { page: { ...page, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } }, type: SectionType.NEXT_PAGE },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: W }],
            children: [
              new TextRun({ text: '농어촌 마을 의료 AI 조율자 도입 시범사업 제안서' + (REVISED ? ' · 수정본' : ''), size: 16, color: SOFT, font: MID }),
              new TextRun({ text: '\t- ', size: 17, color: SOFT, font: MID }),
              new TextRun({ children: [PageNumber.CURRENT], size: 17, color: SOFT, font: MID }),
              new TextRun({ text: ' -', size: 17, color: SOFT, font: MID }),
            ],
          })],
        }),
      },
      children: body,
    },
  ],
});

fs.writeFileSync(OUT.replace(/\.docx$/, '.heads.json'), JSON.stringify(HEADS.map((h) => h.text)));
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log('wrote', OUT, b.length); });
