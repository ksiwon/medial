const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
  ShadingType, VerticalAlign, LevelFormat, Footer, PageNumber, HeadingLevel, PageBreak, TabStopType,
} = require('docx');

const OUT = process.argv[2];
const FONT = { ascii: '맑은 고딕', eastAsia: '맑은 고딕', hAnsi: '맑은 고딕', cs: '맑은 고딕' };
const W = 9638; // A4 (11906) - 2 x 1134 margins
const INK = '1A1A1A';
const GRAY = 'E8EFF7'; // faint tint of the project's blue #3d6ea8
const ACCENT = '3D6EA8';
const MID = '595959';

// "**bold**" segments -> runs
function runs(text, o = {}) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((s) => {
    const bold = s.startsWith('**');
    return new TextRun({ text: bold ? s.slice(2, -2) : s, bold: bold || o.bold, size: o.size || 20, color: o.color || INK, font: FONT, italics: o.italics });
  });
}
const P = (text, o = {}) => new Paragraph({
  children: runs(text, o),
  alignment: o.align,
  spacing: { before: o.before ?? 0, after: o.after ?? 80, line: o.line ?? 300 },
  indent: o.indent,
  keepNext: o.keepNext,
});
const B = (text, level = 0) => new Paragraph({
  children: runs(text),
  numbering: { reference: 'bul', level },
  spacing: { before: 0, after: 50, line: 296 },
});
const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text, bold: true, size: 26, font: FONT, color: INK })],
  shading: { type: ShadingType.CLEAR, fill: GRAY, color: 'auto' },
  border: { left: { style: BorderStyle.SINGLE, size: 36, color: ACCENT, space: 6 } },
  spacing: { before: 280, after: 140 },
  indent: { left: 120 },
  keepNext: true,
});
const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text, bold: true, size: 22, font: FONT, color: INK })],
  spacing: { before: 200, after: 90 },
  keepNext: true,
});

const line = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: line, bottom: line, left: line, right: line };

function cell(text, w, o = {}) {
  const lines = Array.isArray(text) ? text : [text];
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders,
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: o.span,
    shading: o.head ? { type: ShadingType.CLEAR, fill: GRAY, color: 'auto' } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: lines.map((t) => new Paragraph({
      children: runs(t, { size: 18, bold: o.head }),
      alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: 0, after: 20, line: 276 },
    })),
  });
}

// header row + body rows; `widths` sum to W
function table(widths, head, rows, o = {}) {
  const trs = [];
  if (head) trs.push(new TableRow({ tableHeader: true, cantSplit: true, children: head.map((t, i) => cell(t, widths[i], { head: true, center: true })) }));
  rows.forEach((r) => trs.push(new TableRow({
    cantSplit: true,
    children: r.map((t, i) => cell(t, widths[i], { head: o.labelCol && i === 0, center: o.centerCols?.includes(i) })),
  })));
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows: trs });
}
// 4-column "label | value | label | value" block, like the 일반현황 of the forms
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
const gap = (n = 120) => new Paragraph({ children: [], spacing: { before: 0, after: n } });
const note = (text) => P(text, { size: 17, color: MID, before: 60, after: 100, line: 264 });

const children = [];

// ---- title block ----
children.push(new Paragraph({
  children: [new TextRun({ text: '전시 자료  ·  서비스 제안서', size: 18, color: MID, font: FONT })],
  spacing: { after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: INK, space: 6 } },
}));
children.push(new Paragraph({
  children: [new TextRun({ text: '농어촌 마을 의료 AI 조율자', bold: true, size: 44, font: FONT, color: INK })],
  spacing: { before: 200, after: 40 },
}));
children.push(new Paragraph({
  children: [new TextRun({ text: '도입 시범사업 제안서', bold: true, size: 36, font: FONT, color: INK })],
  spacing: { after: 120 },
}));
children.push(P('이 문서는 서비스 디자이너가 마을에 도입하려고 처음 써 온 초안이다. 아직 시뮬레이션으로 돌려 보기 전이며, 주민 평가를 읽고 고치기 전의 모습이다.', { color: MID, size: 19, after: 200 }));

// ---- 일반현황 ----
children.push(H1('일반현황'));
children.push(info([
  ['제안 서비스', '의료 AI 조율자 (마을에서는 ‘AI 스피커’)', '서비스 유형', '소규모 공동체 돌봄 조율 서비스'],
  ['적용 대상', '경남 남해군 삼동면 은점마을 (주민 12명 전수 인터뷰)', '제안자', '서비스 디자이너'],
  ['도입 채널', '전 가구에 이미 걸려 있는 마을 안내 시계(방송용 스피커)에 마이크와 AI를 얹는다. 새 기기를 집집마다 들이지 않는다.'],
  ['기본 사례', '① 무응답 안부 확인   ② 의료 이동 지원 (약 심부름 · 병원 동행 포함)'],
  ['검증 도구', 'Desimer — 인터뷰로 만든 주민 에이전트가 사는 시뮬레이션 마을에서 이 서비스를 미리 돌려 보고 고치는 도구', '문서 상태', '초안 ver1 · 시뮬레이션 검증 전 (2026. 11.)'],
]));

// ---- 개요 ----
children.push(H1('개요 (요약)'));
children.push(table([1700, 7938], null, [
  ['서비스 소개', '마을 주민 사이의 부탁과 확인을 AI가 대신 잇는 서비스. 누구에게 먼저 연락할지, 몇 번 물을지, 무엇까지 알릴지, 언제 보건소·구급대에 넘길지를 **규칙**으로 정해 두고 그대로 움직인다. AI는 진단하지 않고 사람과 기관을 잇는다.'],
  ['해결할 문제', '시골 마을의 안부 확인과 병원 이동은 지금 **이장 한 사람과 가까운 이웃**에게 몰려 있다. 낮에는 마을이 비고, 병원은 멀고, 괜찮은 날의 확인은 어르신에게 번거로움이 된다.'],
  ['해결 방안', '기존 안내 시계로 어르신과 **양방향** 연락을 만들고, 역할(이장·운전하는 이웃·이웃·보건소·어르신)마다 다른 규칙으로 부탁을 나눈다. 규칙은 초안이며 주민 평가를 받아 고친다.'],
  ['기대 효과', '확인과 부탁이 한 사람에게 쏠리지 않는다. 오탐(괜찮은데 찾아가는 일)으로 생기는 피로와 사생활 노출이 줄고, 응답은 하지만 도움이 필요한 경우를 놓치지 않는다.'],
  ['확인 방법', '도입 전에 시뮬레이션 마을에서 한 주의 사건 8개를 돌려 주민 에이전트의 평가를 읽고 규칙을 고친다. 그 결과는 **실제 주민에게 다시 확인·정정**받은 뒤에야 도입을 논의한다.'],
], { labelCol: true }));

// ---- 1. 문제인식 ----
children.push(H1('1. 문제인식 (Problem)'));
children.push(H2('1-1. 추진 배경과 필요성'));
children.push(B('고령 주민이 사는 작은 마을에서는 **안부 확인, 약 전달, 병원 동행**이 대부분 이웃의 호의로 이어진다. 호의는 고마운 일이지만, 부탁이 늘 같은 사람에게 가면 그 사람의 하루가 무너진다.'));
children.push(B('이미 있는 안부 확인 절차는 **생활지원사 전화 → 무응답 → 이장 연락 → 이장 방문**이다. AI 조율자는 이 사람의 일을 대신하는 것이 아니라, 같은 일을 **누구에게 얼마나 나누어 맡길지**를 정한다.'));
children.push(B('서비스를 마을에 먼저 들여놓고 고치면 주민이 그 시행착오를 겪는다. 그래서 **도입 전에** 주민을 닮은 에이전트로 미리 돌려 보고, 주민 평가에서 나온 문제를 규칙으로 고치려 한다.'));

children.push(H2('1-2. 은점마을 현황 (인터뷰 기반)'));
children.push(table([2000, 7638], ['항목', '확인한 내용'], [
  ['대상과 자료', '주민 12명 전수 인터뷰(대면 11 · 통화 1). 마을 동서 폭은 약 1.1km.'],
  ['관계 구조', '네 사람이 함께 다니는 무리, 두 사람이 왕래하는 짝, 식당을 함께 하는 부부, 이장의 사촌, 정기적으로 어울리지 않고 혼자 지내는 분으로 나뉜다.'],
  ['이장의 자리', '이장이 **역할로 무리를 잇는 유일한 다리**다. 나머지 연결은 차를 가진 이웃이 만든다.'],
  ['낮 시간의 공백', '낮에는 마을이 비어, 부탁할 사람은 많아도 **실제로 갈 수 있는 사람은 이장 한 명**인 시간이 있다.'],
  ['이동 접근', '펜션이 마을 남쪽 400m 이상 오르막 끝에 있고 본인이 운전하지 않는 주민은 병원 이동이 어렵다. 같은 분이 디지털 활용은 마을에서 가장 능숙하다. **몸의 접근성과 디지털 접근성이 반대로 간다.**'],
  ['기존 채널', '모든 가구에 마을 방송용 안내 시계가 있다. 지금은 한쪽으로만 들리는 스피커다.'],
], { labelCol: true }));

children.push(H2('1-3. 해결해야 할 문제'));
children.push(table([420, 3300, 5918], ['#', '문제', '마을에서 나타나는 모습'], [
  ['1', '확인 부담이 한 사람에게 몰린다', '아침 안부에 답이 없으면 이장이 순찰을 끝내야 출발할 수 있어 마음만 급하다. 밭에 계셨을 뿐인데 확인이 두 번, 세 번 이어진다.'],
  ['2', '괜찮은 분이 불려 다니고 일과가 알려진다', '“내가 밭에 있는 걸 마을 사람들이 다 알았나” 하는 불편. 확인 과정에서 연락 시각과 평소 일과가 제3자에게 전해진다.'],
  ['3', '응답은 하지만 도움이 필요한 경우를 놓친다', '넘어졌는데 “괜찮다”고 답하면 무응답과 구분하지 못해 도움이 늦는다. 앞서 넘어진 일을 말하지 않은 분이 며칠 뒤 위급해진다.'],
  ['4', '이동·약·동행 부탁이 같은 이웃에게 간다', '운전하는 이웃에게 병원 동행과 약 심부름이 겹친다. 우회가 길면 부탁 자체를 못 한다.'],
  ['5', '기관의 안내가 어르신에게 닿지 않는다', '보건소의 폭염 안내가 늦거나 한꺼번에 나가면 밭에 계신 분께 닿지 않는다.'],
  ['6', '퇴원 뒤 집에서의 돌봄이 비어 있다', '약 시간과 통증 확인, 외래 동행이 필요한데 곁의 가족은 식당을 비울 수 없다.'],
], { centerCols: [0] }));

// ---- 2. 실현가능성 ----
children.push(H1('2. 실현가능성 (Solution)'));
children.push(H2('2-1. 서비스 구성'));
children.push(B('**채널**: 기존 안내 시계에 마이크와 AI를 더해 어르신과 말로 주고받는다. 이장·이웃·보건소에는 전화 등 그분이 받는 방식으로 부탁한다.'));
children.push(B('**하는 일**: ① 무응답 안부 확인  ② 약 심부름 배정  ③ 병원 갈 때·올 때 동행 배정  ④ 기관 안내의 어르신별 전달  ⑤ 위급 감지 시 가까운 이웃과 구급대 연결'));
children.push(B('**하지 않는 일**: 진단·처방 등 의료 판단, 119를 대신하는 응급 대응 전체, 주민이 거절한 부탁의 강요.'));

children.push(H2('2-2. 운영 규칙 초안 — 사람(역할)별'));
children.push(P('AI는 아래 규칙 8가지로 움직인다. 모든 사건이 이 값으로 처음 돌았다(ver1). 각 규칙은 주민 평가를 읽고 사건마다 하나씩 고쳐 나간다.', { after: 80 }));
children.push(table([1900, 2300, 5438], ['역할', '규칙', '초안 값'], [
  ['이장', '본인에게 닿지 않을 때의 연락 순서', '본인에게 닿지 않으면 이장에게 확인을 부탁한다.'],
  ['', '제3자에게 알리는 범위', '연락 시각과 공개 동의된 평소 일과까지 함께 전달한다.'],
  ['운전하는 이웃', '동승 부탁 순서', '동승은 기록된 친척에게 먼저 부탁한다.'],
  ['보건소 · 구급대원', '기관 인계 기한', '접수 후 60분 안에 풀리지 않으면 기관으로 넘긴다.'],
  ['이웃', '한 사람이 받는 부탁 상한', '한 사람이 하루에 받는 조율 부탁은 3번까지. 넘으면 그 사람에게는 묻지 않는다.'],
  ['', '한 건에 묻는 이웃 수', '한 건에 대해 이웃 1명까지 차례로 물어본다.'],
  ['안부를 받는 어르신', '본인 재연락', '응답이 없으면 10분 간격으로 1회 다시 연락한 뒤 다음 단계로 간다.'],
  ['', '연락 최소 간격', '같은 사람에게 다시 연락하기까지 비워 두는 시간이 없다.'],
], { labelCol: true }));
children.push(note('규칙 값은 시뮬레이션 도구(Desimer)에 실제로 들어 있는 ver1 초안과 같다. 고칠 때 바뀌는 것은 이 규칙의 값이다.'));

children.push(H2('2-3. 서비스가 다루는 한 주의 사건'));
children.push(table([700, 3000, 5938], ['사건', '상황', 'AI가 하는 일'], [
  ['E1', '연락이 안 되어 찾아보기', '안부 스피커 무응답 → 이장·이웃 확인. 밭에 계셨을 뿐인 오탐 상황.'],
  ['E2', '약 가져다주기', '식당을 비울 수 없는 어르신의 약이 떨어져 읍내 약국에서 받아다 줄 사람을 찾는다.'],
  ['E3', '병원 태워다 주고 데려오기', '운전하지 않는 주민의 갈 때·올 때 동행을 배정한다.'],
  ['E4', '낙상 후 못 일어남', '“괜찮다”고 답하지만 일어나지 못하는 상황을 무응답과 구분한다.'],
  ['E5', '보건소장의 안내 전달', '폭염 안내를 어르신별로 닿게 전한다.'],
  ['E6', '119 구급 상황', '위급 감지 → 가까운 이웃 → 구급대 인계. 사람의 안전이 걸린 순간은 AI가 정하지 않고 구급대로 넘긴다.'],
  ['E7', '퇴원 후 집에서의 돌봄', '복약·통증 확인과 동행 없는 외래를 이어 준다.'],
  ['E8', '같은 분의 무응답이 한 번 더', '앞선 오탐 뒤에 같은 분이 다시 답이 없을 때, 이번에는 정말 아픈 경우.'],
], { centerCols: [0] }));
children.push(note('사건은 요일에 묶이지 않는다. 한 주 안에서 어느 요일에 놓일지는 그때그때 정하고, 사건끼리 이어지는 것은 E1→E8, E4→E6 두 쌍뿐이다.'));

children.push(H2('2-4. 주민을 지키는 장치'));
children.push(B('**공개 범위**: 제3자에게는 본인이 공개에 동의한 만큼만 전한다. 줄이면 이장이 어디부터 찾을지 모른다는 비용도 함께 본다.'));
children.push(B('**거절과 순서**: 이웃은 거절할 수 있고, 거절하면 다음 사람에게 간다. 한 사람이 하루에 받는 부탁에는 상한을 둔다.'));
children.push(B('**기관 인계 기한**: 풀리지 않는 일은 정해진 시간 뒤 사람이 있는 기관(보건소·구급대)으로 넘긴다.'));
children.push(B('**고칠 수 있는 범위 제한**: 규칙을 고칠 수 있을 뿐, 주민의 성격·일과·평가 기준을 서비스에 맞게 바꾸지 않는다.'));

children.push(H2('2-5. 추진 단계'));
children.push(table([700, 3300, 2400, 3238], ['단계', '내용', '시점', '결과물'], [
  ['1', '주민 인터뷰와 근거 정리(사실 · 해석 · 가정 · 모르는 것 구분)', '현장 방문 때', '주민별 근거 자료'],
  ['2', '초안 규칙 설계(역할별 8규칙)', '시뮬레이션 전', '운영 규칙 초안 ver1'],
  ['3', '시뮬레이션 마을에서 한 주의 사건 실행, 주민 에이전트 평가', '현장 방문 사이', '사건별 주민 평가와 근거'],
  ['4', '평가에서 나온 수정 요청으로 규칙 고치기 · 재실행', '현장 방문 사이', '고친 규칙 ver2 이후와 전후 비교'],
  ['5', '실제 주민에게 확인 · 반박 · 정정 받기', '현장 재방문 때', '일치 · 충돌 · 모름 기록'],
  ['6', '시범 도입 여부와 범위 판단', '재방문 뒤', '시범사업 계획(별도)'],
], { centerCols: [0] }));

children.push(H2('2-6. 소요 자원'));
children.push(table([2600, 7038], ['항목', '내용'], [
  ['마이크 · AI 연결', '기존 안내 시계에 마이크와 AI를 더한다. 새 단말을 집집마다 들이지 않는다.'],
  ['통신 · 운영', '마을 안 통신, 이장·이웃에게 부탁을 전하는 수단, 운영 기록 보관.'],
  ['기관 연계', '보건소(보건소장) · 구급대와의 접점과 인계 방식 합의.'],
  ['주민 설명', '서비스가 하는 일과 하지 않는 일, 동의 범위를 주민에게 설명하는 자리.'],
], { labelCol: true }));
children.push(note('시범 범위가 정해지기 전이라 금액은 적지 않았다. 규모가 확정되면 항목별로 산정한다.'));

// ---- 3. 확산 및 운영 ----
children.push(H1('3. 운영 · 평가 · 확산 전략 (Scale-up)'));
children.push(H2('3-1. 운영 체계 — 누가 무엇을 맡는가'));
children.push(table([2200, 7438], ['주체', '맡는 일'], [
  ['AI 조율자', '무응답을 알아채고, 규칙대로 누구에게 무엇을 부탁할지 정하고, 그 이유를 화면에 남긴다.'],
  ['이장', '규칙상 확인 방문과 이웃 연결을 맡는다. 부탁이 이장에게만 쏠리지 않았는지 본다.'],
  ['이웃 · 운전하는 이웃', '부탁을 받고 수락·거절한다. 하루 부탁 상한과 우회 한도 안에서 움직인다.'],
  ['보건소(보건소장) · 구급대', '정해진 기한 안에 풀리지 않은 일을 넘겨받고, 안내를 전달해 달라고 AI에 맡긴다.'],
  ['서비스 디자이너', '규칙을 고치고 그 이유(어떤 주민 평가 때문인지)를 남긴다.'],
], { labelCol: true }));

children.push(H2('3-2. 평가와 개선 — 무엇을 보고 어디를 고치는가'));
children.push(table([2200, 3600, 3838], ['주민 평가 항목', '주민에게 묻는 것', '주로 고치는 곳'], [
  ['도움과 해결', '문제가 풀렸는가, 도움을 받았는가', '완료 · 기관 인계 조건, 부탁의 순서와 흐름'],
  ['시간과 노동', '내 시간과 힘이 얼마나 들었는가', '부탁 배정과 거절, 연락 간격과 부담 상한'],
  ['선택과 거절', '거절할 수 있었는가', '부탁 배정과 거절, 설명 방식'],
  ['공개 범위', '내 사정이 어디까지 알려졌는가', '설명과 공개 범위'],
  ['이해', 'AI가 뭘 부탁하는지 알아들었는가', '부탁과 상황 설명 문구'],
  ['다시 쓸 조건', '어떤 조건이면 또 쓰겠는가', '완료 조건, 대체 경로와 제약'],
], { labelCol: true }));
children.push(note('주민 에이전트는 자기가 겪은 대사와 허용된 근거만 인용해 평가한다. 근거가 약한 요청은 약하다고 표시한다.'));

children.push(H2('3-3. 위험과 대응 — 고치면 새로 생기는 부담'));
children.push(P('규칙은 고치면 반드시 다른 쪽에 비용이 생긴다. 초안 단계에서 알려진 맞교환은 다음과 같다.', { after: 80 }));
children.push(table([3600, 6038], ['규칙을 이렇게 고치면', '생길 수 있는 부담'], [
  ['본인에게 먼저 한 번 더 기회를 준다', '정말 위급하면 도움이 30분 가까이 늦는다.'],
  ['이웃에게는 응답이 없었다는 것만 알린다', '이장이 어디부터 찾을지 몰라 집과 밭을 모두 돌아본다.'],
  ['같은 분을 연달아 부르지 않는다', '두 번째 무응답이 진짜일 때 90분을 기다린다.'],
  ['보건소에 일찍 넘긴다', '보건소가 괜찮은 분의 확인까지 떠안고, 어르신이 민망해한다.'],
  ['가까운 이웃·가족에게 먼저 알린다', '별일 아닌 날에도 같은 사람이 불려 가고, 어르신은 알려진 것을 민망해한다.'],
  ['여러 분께 한 번에 묻고 먼저 되는 분으로 한다', '되지 않은 분들은 부탁이 취소되어 서운해한다.'],
]));

children.push(H2('3-4. 확산'));
children.push(B('이 구조는 은점마을만이 아니라 **10~20명 안팎의 소규모 공동체**에 도입할 서비스를 미리 돌려 보는 방식이다. 마을이 바뀌면 인터뷰와 주민 에이전트, 규칙의 값을 새로 맞춘다.'));
children.push(B('규칙의 틀(연락 순서 · 공개 범위 · 기관 인계 기한 등)은 그대로 두고, 마을의 관계와 이동 조건에 맞게 **값**을 고친다.'));

// ---- 4. 추진체계 ----
children.push(H1('4. 추진체계와 참여자 (Team)'));
children.push(table([2200, 4200, 3238], ['구분', '역할', '비고'], [
  ['서비스 디자이너', '의료 AI 조율자 초안을 쓰고, 평가에 따라 규칙을 고친다.', '제안자'],
  ['연구자', '인터뷰, 주민 에이전트와 시뮬레이션, 평가 읽기를 맡는다.', 'Desimer 운영'],
  ['마을 주민 12명', '인터뷰에 응했고, 재방문 때 평가를 확인·반박·정정한다.', '실명은 이 문서에 쓰지 않는다'],
  ['이장', '마을 연결 역할. 도입 규칙에 대한 의견과 현장 확인.', '역할별 규칙의 당사자'],
  ['보건소 · 구급대', '인계 기한과 안내 전달에 대한 현실성 확인.', '도입 논의 때 참여'],
], { labelCol: true }));

// ---- 5. 기대효과 ----
children.push(H1('5. 기대효과와 한계'));
children.push(H2('5-1. 기대효과'));
children.push(B('**주민**: 불려 다니는 느낌과 일과 노출이 줄고, 응답은 하지만 도움이 필요한 순간에 사람이 온다.'));
children.push(B('**이웃·이장**: 부탁과 확인이 한 사람에게 쏠리지 않고, 헛걸음과 반복 호출이 줄어든다.'));
children.push(B('**서비스 디자이너**: 도입 전에 어떤 주민 평가 때문에 어떤 규칙이 바뀌었는지를 남기며 고친다.'));
children.push(H2('5-2. 이 초안의 한계 — 꼭 읽어 주세요'));
children.push(B('시뮬레이션에서 나오는 주민 평가는 **합성 평가이며 실제 주민의 의견·만족도·동의가 아니다.** 현장 방문 사이의 사전 탐색을 돕는 것이지 주민 참여를 대신하지 않는다.'));
children.push(B('사건 기록은 사건마다 따로 돌린 것이다. 서로 합쳐 다시 돌린 기록은 없다. 한 주의 배치는 임의이며 시간이 지난 변화를 보는 연구가 아니다.'));
children.push(B('일부 사건(낙상 · 폭염 안내 · 퇴원 후 돌봄)은 인터뷰에 직접 근거가 없는 설계자 배치다.'));
children.push(B('실제 주민이 확인하기 전에는 이 서비스가 효과가 있다고 말하지 않는다.'));

children.push(gap(200));
children.push(new Paragraph({
  children: runs('본 문서는 전시용 초안이며 실제 기관에 제출하는 서류가 아니다.', { size: 17, color: MID }),
  alignment: AlignmentType.CENTER,
  border: { top: { style: BorderStyle.SINGLE, size: 4, color: '808080', space: 8 } },
  spacing: { before: 120 },
}));

const doc = new Document({
  creator: '서비스 디자이너',
  title: '농어촌 마을 의료 AI 조율자 도입 제안서',
  styles: {
    default: { document: { run: { font: FONT, size: 20, color: INK } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 26, bold: true }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 22, bold: true }, paragraph: { spacing: { before: 200, after: 90 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bul',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 240 } } } },
      ],
    }],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, footer: 560 } } },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: W }],
          children: [
            new TextRun({ text: '의료 AI 조율자 도입 제안서', size: 16, color: MID, font: FONT }),
            new TextRun({ text: '\t- ', size: 16, color: MID, font: FONT }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MID, font: FONT }),
            new TextRun({ text: ' -', size: 16, color: MID, font: FONT }),
          ],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log('wrote', OUT, b.length); });
