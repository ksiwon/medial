import styled from 'styled-components';
import { colour, font } from '../ui/theme';
import { VERDICT_WORD, nameOf, type Judgment } from './judgment';

// MEDial has no icon on screen. This panel is where it is: what it knows, the
// rules it went through, who it asked and what it heard, and what it said -
// lit in that order the first time a request comes up. When the scene happens
// where MEDial is not, the panel dims and says only what it is waiting for.

const Box = styled.aside<{ $absent: boolean }>`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--panel-w);
  /* The frames stop at --panel-w; without this the padding made the panel
     32 px wider than that and it lay over the pictures' right edge. */
  box-sizing: border-box;
  padding: 16px 18px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #eceae6;
  overflow: hidden;
  /* Dim, not gone: on a projector 0.35 read as an empty panel (2026-09-29). */
  > ol { opacity: ${(p) => (p.$absent ? 0.6 : 1)}; transition: opacity 0.45s ease; }
`;

const Kicker = styled.div`
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.09em;
  color: #f08a5d;
`;

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.3;
  > i { width: 9px; height: 9px; border-radius: 50%; flex: none; }
`;

const Steps = styled.ol`
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
`;

const Step = styled.li<{ $on: boolean }>`
  border-left: 3px solid ${(p) => (p.$on ? '#e2542c' : '#3b3c38')};
  padding: 2px 0 2px 11px;
  opacity: ${(p) => (p.$on ? 1 : 0.35)};
  transition: opacity 0.45s ease, border-color 0.45s ease;
  > h4 { margin: 0 0 3px; font-size: 11px; font-weight: 800; letter-spacing: 0.05em; color: #a9a59d; }
  li { font-size: 13px; line-height: 1.45; margin: 2px 0 2px 14px; }
  ul { margin: 0; padding: 0; }
`;

const None = styled.div`
  font-size: 12.5px;
  color: #8d8980;
`;

const Row = styled.div`
  display: flex;
  gap: 7px;
  align-items: baseline;
  font-size: 13px;
  line-height: 1.4;
  margin: 3px 0;
  > b { flex: none; }
  > span { color: #bdb9b1; font-size: 12px; }
`;

const VERDICT_BG: Record<string, string> = {
  accepted: '#1d4ed8', answered: '#1d4ed8', told: '#1d4ed8', declined: '#b91c1c', deferred: '#b45309',
  no_answer: '#b45309', asking: '#ffffff',
};

const Pill = styled.em<{ $v: string }>`
  flex: none;
  font-style: normal;
  font-size: 10.5px;
  font-weight: 800;
  border-radius: 999px;
  padding: 1px 7px;
  background: ${(p) => VERDICT_BG[p.$v] ?? '#3b3c38'};
  color: ${(p) => (p.$v === 'asking' ? colour.text : '#ffffff')};
`;

const Away = styled.div`
  margin-top: 10px;
  border: 1px dashed #6b675f;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: ${font.small};
  line-height: 1.5;
  color: #cfcbc3;
  > strong { display: block; font-size: 15px; color: #ffffff; margin-top: 3px; }
`;

export default function JudgmentPanel({ title, tint, judgment, lit, absent, waiting }: {
  title: string;
  tint: string;
  judgment: Judgment;
  /** How many of the four steps are lit (0-4). */
  lit: number;
  absent: boolean;
  waiting: string | null;
}) {
  const j = judgment;
  return (
    <Box $absent={absent} aria-label="MEDial의 판단">
      <Kicker>MEDial의 판단</Kicker>
      <Title><i style={{ background: tint }} />{title}</Title>
      <Steps>
        <Step $on={lit > 0}>
          <h4>지금 아는 것</h4>
          {j.knows.length ? <ul>{j.knows.map((k) => <li key={k}>{k}</li>)}</ul>
            : <None>아직 판단 기록이 없다</None>}
        </Step>
        <Step $on={lit > 1}>
          <h4>걸린 규칙</h4>
          {j.rules.length
            ? <ul>{j.rules.map((r) => <li key={r.label}><b>{r.label}</b><br />{r.sentence}</li>)}</ul>
            : <None>아직 이 요청에 걸린 운영 규칙이 없다</None>}
        </Step>
        <Step $on={lit > 2}>
          <h4>후보 판정{j.question ? ` — ${j.question}` : ''}</h4>
          {j.asked.map((a, i) => (
            <Row key={`${a.actorId}-${i}`}>
              <b>{nameOf(a.actorId)}</b>
              <Pill $v={a.verdict}>{VERDICT_WORD[a.verdict]}</Pill>
              {a.heard && <span>{a.heard}</span>}
            </Row>
          ))}
          {j.ruledOut.slice(0, 3).map((c) => (
            <Row key={`out-${c.actorId}`}><b>{nameOf(c.actorId)}</b><Pill $v="out">제외</Pill><span>{c.reason}</span></Row>
          ))}
          {j.ruledOut.length > 3 && <None>제외 {j.ruledOut.length - 3}명 더</None>}
          {!j.asked.length && !j.ruledOut.length && <None>아직 물은 사람이 없다</None>}
        </Step>
        <Step $on={lit > 3}>
          <h4>그래서 이렇게 말한다</h4>
          <ul>
            {j.told && <li>{j.told.length ? `전한 것: ${j.told.join(' · ')}` : '다른 사람에게 전한 정보 없음'}</li>}
            {j.rationale && <li>{j.rationale}</li>}
            {j.result && <li><b>{j.result}</b></li>}
          </ul>
          {!j.told && !j.rationale && !j.result && <None>—</None>}
        </Step>
      </Steps>
      {absent && (
        <Away>MEDial은 이 장면을 보지 못합니다<strong>{waiting ?? '결과 대기 중'}</strong></Away>
      )}
    </Box>
  );
}
