import styled, { css } from 'styled-components';
import { pill } from '../ui/primitives';
import { inkA, night, px, radius, space, type } from '../ui/theme';
import type { ContactWay, Judgment } from './judgment';
import { nameOf } from './selectors';
import type { Week } from './types';

// The AI has no body on screen. This panel is where it is: what it knows, the rules it runs under, and who it spoke
// to - beside the scene (what it says is the bubble; the panel used to repeat it word for word and was dropped
// 2026-10-18, so the rules - after a request, the changed one - are the panel's largest words), for the whole telling (week/judgment.ts says where each comes from).
// Only the rules this version is about are read out (2026-10-23); the event's others are named in one line. When the
// scene happens where the AI is not, the panel dims and says it cannot see it: the world and what the AI observed
// are never one thing.

const Box = styled.aside<{ $absent: boolean }>`
  flex: none;
  width: ${px(520)};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${space.md};
  padding: ${space.xl};
  background: ${night.panel};
  border-left: 1px solid ${night.line};
  overflow: hidden;
  > ol { opacity: ${(p) => (p.$absent ? 0.45 : 1)}; transition: opacity 0.45s ease; }
`;

const Kicker = styled.div`
  font-size: ${type.caption};
  font-weight: 800;
  letter-spacing: 0.09em;
  color: ${night.accent};
`;

const Title = styled.div`
  font-size: ${type.lead};
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.3;
  word-break: keep-all;
  > small { display: block; margin-top: ${space.xs}; font-size: ${type.caption}; font-weight: 600; color: ${night.mute}; }
`;

const Steps = styled.ol`
  list-style: none;
  margin: ${space.sm} 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
`;

const Step = styled.li<{ $on: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space.md};
  min-height: 0;
  border-left: ${px(4)} solid ${(p) => (p.$on ? night.accent : inkA(0.14))};
  padding: ${space.xs} 0 ${space.xs} ${space.lg};
  transition: border-color 0.45s ease;
  > h4 { margin: 0; font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.06em; color: ${night.mute}; }
`;

const None = styled.div`
  font-size: ${type.body};
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
  gap: ${space.md};
`;

const Said = styled.div<{ $heard: boolean; $new: boolean }>`
  font-size: ${type.body};
  line-height: 1.5;
  word-break: keep-all;
  color: ${(p) => (p.$new ? night.ink : night.mute)};
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  > b { ${pill('xs')} margin-right: ${space.sm}; font-weight: 800; color: ${(p) => (p.$heard ? night.ink : night.white)}; background: ${(p) => (p.$heard ? inkA(0.14) : night.accent)}; }
`;

const RuleRow = styled.div<{ $changed: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  font-size: ${type.body};
  line-height: 1.5;
  word-break: keep-all;
  > b { font-weight: 800; display: flex; align-items: center; gap: ${space.sm}; flex-wrap: wrap; }
  > b > em { ${pill('xs')} font-style: normal; font-weight: 800; color: ${night.white}; background: ${night.accent}; }
  > s { color: ${night.faint}; text-decoration-color: ${inkA(0.35)}; }
  > i { font-style: normal; font-weight: 800; line-height: 1; color: ${night.accent}; font-size: ${type.lead}; padding-left: ${space.sm}; }
  > span { ${(p) => p.$changed && css`font-size: ${type.lead}; line-height: 1.4; padding: ${space.sm} ${space.md}; border-radius: ${radius.control}; background: ${night.accentSoft}; font-weight: 700;`} }
`;

/** The event's other rules: in force, but not what this version is about - named, not read out. */
const Rest = styled.div`
  font-size: ${type.caption};
  line-height: 1.6;
  color: ${night.faint};
  word-break: keep-all;
  > b { font-weight: 800; margin-right: ${space.sm}; }
`;

const ContactRow = styled.div<{ $answered: boolean }>`
  display: flex;
  align-items: center;
  gap: ${space.sm};
  font-size: ${type.body};
  > b { font-weight: 800; }
  > span { color: ${night.mute}; }
  > em { ${pill('xs')} margin-left: auto; font-style: normal; font-weight: 800;
    color: ${(p) => (p.$answered ? night.white : night.deep)}; background: ${(p) => (p.$answered ? night.info : night.ink)}; }
`;

const WAY: Record<ContactWay, string> = { phone: '전화', speaker: '안부 스피커', here: '곁에서' };

/** How many of the newest lines the log keeps on screen. */
const LOG = 2;

export default function JudgmentPanel({ week, judgment, version }: {
  week: Week; judgment: Judgment;
  /** Which version of the event is being told (1 = as it first ran). */
  version: number;
}) {
  const j = judgment;
  const who = (id: string) => (id === 'AI' ? 'AI' : nameOf(week, id));
  const shown = j.knows.slice(-LOG);
  const focus = j.rules.filter((r) => r.focus);
  const rest = j.rules.filter((r) => !r.focus);
  return (
    <Box $absent={!j.present} aria-label="AI의 판단">
      <Kicker>AI의 판단</Kicker>
      <Title>
        {version > 1 ? `ver${version} · 고른 요청이 반영된 규칙` : 'ver1 · 처음 규칙'}
        {!j.present && <small>AI는 이 장면을 보지 못합니다 · 여기서 오간 말은 AI의 기록에 남지 않습니다</small>}
      </Title>
      <Steps>
        <Step $on={j.knows.length > 0}>
          <h4>지금 아는 것 · AI가 직접 듣고 말한 것만</h4>
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
          {!j.emergency && focus.map((r) => (
            <RuleRow key={r.label} $changed={r.was !== null}>
              <b>{r.label}{r.was !== null && <em>고른 요청으로 바뀜</em>}</b>
              {r.was !== null && <><s>{r.was}</s><i aria-hidden>↓</i></>}
              <span>{r.sentence}</span>
            </RuleRow>
          ))}
          {!j.emergency && rest.length > 0 && <Rest><b>그 밖의 규칙</b>{rest.map((r) => r.label).join(' · ')}</Rest>}
        </Step>
        <Step $on={j.contacts.length > 0}>
          <h4>연락한 사람</h4>
          {j.contacts.length ? j.contacts.map((c) => (
            <ContactRow key={c.actor} $answered={c.answered}>
              <b>{who(c.actor)}</b><span>{WAY[c.way]}</span><em>{c.answered ? '답함' : '묻는 중'}</em>
            </ContactRow>
          )) : <None>아직 연락한 사람이 없습니다</None>}
        </Step>
      </Steps>
    </Box>
  );
}
