import styled, { css } from 'styled-components';
import { pill } from '../ui/primitives';
import { inkA, night, px, radius, space } from '../ui/theme';
import type { ContactWay, Judgment } from './judgment';
import { nameOf } from './selectors';
import type { Week } from './types';

// The AI has no body on screen. This panel is where it is: what it knows, the rules it runs under, who it spoke to,
// and what it said - beside the scene, for the whole telling (week/judgment.ts says where each comes from). When the
// scene happens where the AI is not, the panel dims and says it cannot see it: the world and what the AI observed
// are never one thing.

const Box = styled.aside<{ $absent: boolean }>`
  flex: none;
  width: ${px(360)};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  padding: ${space.lg} ${space.lg} ${space.lg} ${space.md};
  background: ${night.panel};
  border-left: 1px solid ${night.line};
  overflow: hidden;
  > ol { opacity: ${(p) => (p.$absent ? 0.45 : 1)}; transition: opacity 0.45s ease; }
`;

const Kicker = styled.div`
  font-size: ${px(12)};
  font-weight: 800;
  letter-spacing: 0.09em;
  color: ${night.accent};
`;

const Title = styled.div`
  font-size: ${px(20)};
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.3;
  word-break: keep-all;
  > small { display: block; margin-top: ${space.xs}; font-size: ${px(12)}; font-weight: 600; color: ${night.mute}; }
`;

const Steps = styled.ol`
  list-style: none;
  margin: ${space.sm} 0 0;
  padding: 0;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  overflow: hidden;
`;

const Step = styled.li<{ $on: boolean; $grow?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  min-height: 0;
  /* Only what it knows gives way when the panel is full (its oldest lines fall off); the rules never do. */
  ${(p) => (p.$grow ? css`flex: 1 1 auto; overflow: hidden;` : css`flex: none;`)}
  border-left: ${px(4)} solid ${(p) => (p.$on ? night.accent : inkA(0.14))};
  padding: ${px(2)} 0 ${px(2)} ${space.md};
  transition: border-color 0.45s ease;
  > h4 { margin: 0; font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.06em; color: ${night.mute}; }
`;

const None = styled.div`
  font-size: ${px(16)};
  line-height: 1.5;
  color: ${night.faint};
  word-break: keep-all;
`;

/** What it said and heard, from the top, newest last; past LOG lines the oldest give way so the newest stays in view.
 *  (It used to sit at the bottom, and a telling began with an empty box above one line.) */
const Log = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: ${space.sm};
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
`;

const Said = styled.div<{ $heard: boolean; $new: boolean }>`
  font-size: ${px(16)};
  line-height: 1.5;
  word-break: keep-all;
  color: ${(p) => (p.$new ? night.ink : night.mute)};
  > b { ${pill('xs')} margin-right: ${space.sm}; font-weight: 800; color: ${(p) => (p.$heard ? night.ink : '#fff')}; background: ${(p) => (p.$heard ? inkA(0.14) : night.accent)}; }
`;

const RuleRow = styled.div<{ $changed: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space.xs};
  font-size: ${px(16)};
  line-height: 1.5;
  word-break: keep-all;
  > b { font-weight: 800; display: flex; align-items: center; gap: ${space.sm}; flex-wrap: wrap; }
  > b > em { ${pill('xs')} font-style: normal; font-weight: 800; color: #fff; background: ${night.accent}; }
  > s { color: ${night.faint}; text-decoration-color: ${inkA(0.35)}; }
  > span { ${(p) => p.$changed && css`padding: ${space.xs} ${space.sm}; border-radius: ${radius.control}; background: ${night.accentSoft}; box-shadow: inset ${px(4)} 0 0 ${night.accent}; font-weight: 700;`} }
`;

const ContactRow = styled.div<{ $answered: boolean }>`
  display: flex;
  align-items: center;
  gap: ${space.sm};
  font-size: ${px(16)};
  > b { font-weight: 800; }
  > span { color: ${night.mute}; }
  > em { ${pill('xs')} margin-left: auto; font-style: normal; font-weight: 800;
    color: ${(p) => (p.$answered ? '#fff' : night.deep)}; background: ${(p) => (p.$answered ? '#3d6ea8' : night.ink)}; }
`;

const Speech = styled.div`
  padding: ${space.sm} ${space.md};
  border-radius: ${radius.card};
  background: ${night.accentSoft};
  font-size: ${px(16)};
  line-height: 1.5;
  font-weight: 700;
  word-break: keep-all;
`;

const Away = styled.div`
  flex: none;
  border: 1px dashed ${inkA(0.4)};
  border-radius: ${radius.panel};
  padding: ${space.md};
  font-size: ${px(16)};
  line-height: 1.5;
  color: ${night.mute};
  word-break: keep-all;
  > strong { display: block; font-size: ${px(16)}; color: ${night.ink}; margin-bottom: ${space.xs}; }
`;

const WAY: Record<ContactWay, string> = { phone: '전화', speaker: '안부 스피커', here: '곁에서' };

/** How many of the newest lines the log keeps on screen. */
const LOG = 5;

export default function JudgmentPanel({ week, judgment, after }: { week: Week; judgment: Judgment; after: boolean }) {
  const j = judgment;
  const who = (id: string) => (id === 'AI' ? 'AI' : nameOf(week, id));
  const shown = j.knows.slice(-LOG);
  return (
    <Box $absent={!j.present} aria-label="AI의 판단">
      <Kicker>AI의 판단</Kicker>
      <Title>
        {after ? '고른 요청이 반영된 규칙으로' : '수정 전 규칙으로'}
        <small>AI가 이 사건에서 직접 듣고 말한 것만 보입니다</small>
      </Title>
      <Steps>
        <Step $on={j.knows.length > 0} $grow>
          <h4>지금 아는 것</h4>
          {shown.length ? (
            <Log>
              {j.knows.length > LOG && <None>… 앞의 {j.knows.length - LOG}줄</None>}
              {shown.map((k, i) => (
                <Said key={`${j.knows.length - shown.length + i}`} $heard={k.heard} $new={i === shown.length - 1}>
                  <b>{k.heard ? `들음 · ${who(k.speaker)}` : '말함'}</b>{k.text}
                </Said>
              ))}
            </Log>
          ) : <None>아직 이 사건에 대해 들은 것이 없습니다</None>}
        </Step>
        <Step $on={j.rules.length > 0}>
          <h4>걸린 규칙</h4>
          {j.emergency && <None>응급 상황입니다. 고를 수 있는 규칙을 두지 않았습니다.</None>}
          {!j.emergency && j.rules.map((r) => (
            <RuleRow key={r.label} $changed={r.was !== null}>
              <b>{r.label}{r.was !== null && <em>고른 요청으로 바뀜</em>}</b>
              {r.was !== null && <s>{r.was}</s>}
              <span>{r.sentence}</span>
            </RuleRow>
          ))}
        </Step>
        <Step $on={j.contacts.length > 0}>
          <h4>연락한 사람</h4>
          {j.contacts.length ? j.contacts.map((c) => (
            <ContactRow key={c.actor} $answered={c.answered}>
              <b>{who(c.actor)}</b><span>{WAY[c.way]}</span><em>{c.answered ? '답함' : '묻는 중'}</em>
            </ContactRow>
          )) : <None>아직 연락한 사람이 없습니다</None>}
        </Step>
        <Step $on={j.said !== null}>
          <h4>그래서 이렇게 말한다</h4>
          {j.said ? <Speech>{j.said}</Speech> : <None>—</None>}
        </Step>
      </Steps>
      {!j.present && (
        <Away>
          <strong>AI는 이 장면을 보지 못합니다</strong>
          여기서 오간 말은 AI의 기록에 남지 않습니다. 패널은 AI가 마지막으로 알던 그대로입니다.
        </Away>
      )}
    </Box>
  );
}
