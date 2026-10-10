import styled from 'styled-components';
import { colour, font, night, radius } from '../ui/theme';
import { VERDICT_WORD, nameOf, type Judgment } from './judgment';
import { pill } from '../ui/primitives';

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
  padding: 16px 20px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #eceae6;
  overflow: hidden;
  /* Dim, not gone: on a projector 0.35 read as an empty panel (2026-09-29). */
  > ol { opacity: ${(p) => (p.$absent ? 0.6 : 1)}; transition: opacity 0.45s ease; }
`;

const Kicker = styled.div`
  font-size: calc(12px * var(--k, 1));
  font-weight: 800;
  letter-spacing: 0.09em;
  color: #f08a5d;
`;

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: calc(16px * var(--k, 1));
  font-weight: 800;
  line-height: 1.3;
  > i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
`;

/** Which case the Task belongs to and whom it is about. */
const Subtitle = styled.div`
  margin: 2px 0 0 16px;
  font-size: calc(12px * var(--k, 1));
  color: #a9a59d;
`;

const Steps = styled.ol`
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
`;

const Step = styled.li<{ $on: boolean }>`
  border-left: 4px solid ${(p) => (p.$on ? night.accent : '#3b3c38')};
  padding: 2px 0 2px 12px;
  opacity: ${(p) => (p.$on ? 1 : 0.35)};
  transition: opacity 0.45s ease, border-color 0.45s ease;
  > h4 { margin: 0 0 4px; font-size: calc(12px * var(--k, 1)); font-weight: 800; letter-spacing: 0.05em; color: #a9a59d; }
  li { font-size: calc(12px * var(--k, 1)); line-height: 1.45; margin: 2px 0 2px 16px; }
  ul { margin: 0; padding: 0; }
`;

const None = styled.div`
  font-size: calc(12px * var(--k, 1));
  color: #8d8980;
`;

const Row = styled.div`
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: calc(12px * var(--k, 1));
  line-height: 1.4;
  margin: 4px 0;
  > b { flex: none; }
  > span { color: #bdb9b1; font-size: calc(12px * var(--k, 1)); }
`;

const VERDICT_BG: Record<string, string> = {
  accepted: '#1d4ed8', answered: '#1d4ed8', told: '#1d4ed8', declined: '#b91c1c', deferred: '#b45309',
  no_answer: '#b45309', asking: '#ffffff',
};

const Pill = styled.em<{ $v: string }>`
  ${pill('xs')}
  flex: none;
  font-style: normal;
  font-weight: 800;
  background: ${(p) => VERDICT_BG[p.$v] ?? '#3b3c38'};
  color: ${(p) => (p.$v === 'asking' ? colour.text : '#ffffff')};
`;

const Away = styled.div`
  margin-top: 12px;
  border: 1px dashed #6b675f;
  border-radius: ${radius.panel};
  padding: 12px 12px;
  font-size: ${font.small};
  line-height: 1.5;
  color: #cfcbc3;
  > strong { display: block; font-size: calc(16px * var(--k, 1)); color: #ffffff; margin-top: 4px; }
`;

/**
 * While a call is still being asked its answers are held back, so each of the
 * same person's calls reads "묻는 중" and two of them looked like one line
 * printed twice. Said once with how many times, the repeat is the fact it is.
 * Answered calls are kept as they are: each has its own words.
 */
export function foldAsking(asked: Judgment['asked']): (Judgment['asked'][number] & { times: number })[] {
  const out: (Judgment['asked'][number] & { times: number })[] = [];
  for (const a of asked) {
    const last = out[out.length - 1];
    if (last && a.verdict === 'asking' && last.verdict === 'asking' && last.actorId === a.actorId) {
      last.times += 1;
    } else {
      out.push({ ...a, times: 1 });
    }
  }
  return out;
}

export default function JudgmentPanel({ title, subtitle, tint, judgment, lit, absent, waiting }: {
  title: string;
  subtitle?: string | null;
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
      {subtitle && <Subtitle>{subtitle}</Subtitle>}
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
          {foldAsking(j.asked).map((a, i) => (
            <Row key={`${a.actorId}-${i}`}>
              <b>{nameOf(a.actorId)}</b>
              <Pill $v={a.verdict}>{VERDICT_WORD[a.verdict]}</Pill>
              {a.times > 1 && <span>{a.times}번 물었다</span>}
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
            {/* A record that says what was held back lists what is said and
                what is not, one line each; otherwise the one summary line. */}
            {j.withheld && j.told?.map((t) => <li key={t}>{t}</li>)}
            {j.withheld && j.withheld.length > 0 && (
              <li style={{ opacity: 0.5 }}>말하지 않는다 — {j.withheld.join(' · ')}</li>
            )}
            {!j.withheld && j.told && <li>{j.told.length ? `전한 것: ${j.told.join(' · ')}` : '다른 사람에게 전한 정보 없음'}</li>}
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
