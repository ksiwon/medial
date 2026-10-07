import styled from 'styled-components';
import { formatClock } from '../positions';
import type { Ledger, Routine } from '../selectors/dayLedger';
import { personName } from '../selectors/story';
import { font, night } from '../ui/theme';
import { FaceChip } from './Marks';

// The stage between scenes (2026-10-07 redesign for the exhibition wall).
//
// What a visitor needs while no scene plays is not three large tallies of one or
// two requests: it is what MEDial is doing in one sentence, and the village it is
// doing it in. So the stage says, from the top: the state as a headline, the
// day's tally and the next scheduled call as one line, and then the village now
// - every place someone is, with their faces - beside what MEDial holds about any
// open request and who has been asked for help today. The clock is the
// timeline's; it is not repeated here.
//
// Every number is read off the day so far (selectors/dayLedger) and says nothing
// about the hours to come; "next" is only ever a scheduled call. "Asked" counts
// requests a person was asked to help with, which is where the day's burden
// falls; it is not a score of anyone. What happened and MEDial never saw (two
// brothers on a pier) is not here.
//
// Where everyone is belongs to the researcher's view. In MEDial's view the
// village section says what MEDial actually has instead: home or away, nothing more.

const Box = styled.div`
  position: absolute;
  inset: 0;
  border-radius: 14px;
  background: ${night.panel};
  color: ${night.ink};
  padding: 28px 32px 26px;
  display: flex;
  flex-direction: column;
  gap: 26px;
  overflow: hidden;
`;

const Top = styled.header`
  flex: none;
  > small { display: block; font-size: 12px; font-weight: 800; letter-spacing: 0.14em; color: ${night.accent}; }
  > h2 { margin: 10px 0 0; font-size: clamp(22px, 2.1vw, 32px); line-height: 1.3; font-weight: 800;
         letter-spacing: -0.03em; word-break: keep-all; }
  > p { margin: 10px 0 0; font-size: 15px; color: ${night.mute}; font-variant-numeric: tabular-nums; }
  > p > b { color: ${night.ink}; font-weight: 800; }
  > p > i { font-style: normal; margin: 0 10px; color: ${night.faint}; }
`;

const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 32px;
`;

const Col = styled.section`
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  > h3 { margin: 0; display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
         font-size: 12px; font-weight: 800; letter-spacing: 0.1em; color: ${night.faint}; }
  /* Same size as the heading it sits in: a larger figure here pushed this heading
     2px below the one beside it in the next column. */
  > h3 > span { font-size: 12px; font-weight: 600; letter-spacing: 0; color: ${night.mute}; }
`;

const Places = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 10px;
  overflow-y: auto;
  align-content: start;
`;

const Place = styled.div`
  padding: 12px 14px 14px;
  border-radius: 12px;
  background: ${night.raised};
  > header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  > header > b { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; }
  > header > em { font-style: normal; font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
  > ul { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
`;

/** A face and its P-number. Off their ordinary day: an accent ring. */
const Person = styled.li<{ $off: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 700;
  color: ${night.mute};
  > span { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%;
           box-shadow: 0 0 0 2px ${(p) => (p.$off ? night.accent : 'transparent')}; }
`;

const Legend = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${night.faint};
  > i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px;
        box-shadow: inset 0 0 0 2px ${night.accent}; vertical-align: -1px; }
`;

const Card = styled.div`
  padding: 14px 16px;
  border-radius: 12px;
  background: ${night.accentSoft};
  box-shadow: inset 0 0 0 1px rgba(226, 84, 44, 0.45);
  > b { display: block; font-size: 17px; font-weight: 800; letter-spacing: -0.01em; }
  > em { display: block; margin-top: 10px; font-style: normal; font-size: 11px; font-weight: 800;
         letter-spacing: 0.08em; color: ${night.accent}; }
  > em[data-unknown='true'] { color: ${night.faint}; }
  > ul { margin: 4px 0 0; padding-left: 16px; font-size: ${font.small}; line-height: 1.6; color: ${night.mute}; }
`;

const Bars = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  > li { display: grid; grid-template-columns: 92px 1fr 22px; align-items: center; gap: 10px; font-size: 13px; }
  > li > i { display: block; height: 8px; border-radius: 999px; background: ${night.accent}; min-width: 6px; }
  > li > em { font-style: normal; font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; }
`;

const Quiet = styled.p`
  margin: 0;
  font-size: 15px;
  line-height: 1.6;
  color: ${night.mute};
  word-break: keep-all;
`;

interface Props {
  ledger: Ledger;
  /** The next scheduled call, so a quiet stretch says what it is waiting for. */
  next: { startMs: number; title: string } | null;
  /** What MEDial held about a request at the playhead: its panel's "아는 것"
   *  and what it could not know. */
  holdsOf: (requestId: string) => { knows: string[]; unknown: string[] } | null;
  /** The village's ordinary day at the playhead, or null in MEDial's view. */
  routine: Routine | null;
}

/** The stage's headline: what MEDial is doing, in one sentence. */
function headline(ledger: Ledger): string {
  const open = ledger.rows.filter((row) => row.state === 'open');
  if (open.length > 0) {
    const row = open[open.length - 1];
    return `${row.need}${row.subjectId ? ` · ${personName(row.subjectId)}` : ''} — 진행 중입니다.`;
  }
  if (ledger.taken === 0) return '아직 MEDial에 들어온 요청이 없습니다.';
  const last = ledger.rows[ledger.rows.length - 1];
  const step = last.steps[last.steps.length - 1];
  return `열린 요청이 없습니다. 마지막 일은 ${formatClock(step.atMs)} ${step.title}.`;
}

export default function MedialDashboard({ ledger, next, holdsOf, routine }: Props) {
  const open = ledger.rows.filter((row) => row.state === 'open');
  const peak = Math.max(1, ...ledger.load.map((l) => l.count));
  return (
    <Box aria-label="MEDial 현황">
      <Top>
        <small>MEDIAL · 장면 사이</small>
        <h2>{headline(ledger)}</h2>
        <p>
          오늘 접수 <b>{ledger.taken}</b><i>·</i>진행 <b>{ledger.open}</b><i>·</i>마무리 <b>{ledger.done}</b>
          {next && <><i>|</i>다음 예정 <b>{formatClock(next.startMs)}</b> {next.title}</>}
        </p>
      </Top>

      <Body>
        <Col>
          <h3>
            마을은 지금
            {routine && <span>{routine.onRoutine}명 평소대로{routine.departed > 0 ? ` · ${routine.departed}명 평소와 다름` : ''}</span>}
          </h3>
          {routine ? (
            <>
              <Places>
                {routine.where.map((place) => (
                  <Place key={place.label}>
                    <header><b>{place.label}</b><em>{place.count}</em></header>
                    <ul>
                      {place.ids.map((id) => (
                        <Person key={id} $off={place.departed.includes(id)} title={personName(id)}>
                          <span><FaceChip id={id} size={32} /></span>
                          {id}
                        </Person>
                      ))}
                    </ul>
                  </Place>
                ))}
              </Places>
              {routine.departed > 0 && <Legend><i />평소 일과와 다르게 움직이는 사람</Legend>}
            </>
          ) : (
            <Quiet>MEDial은 주민이 어디에 있는지 모릅니다. 집에 있는지 없는지만 압니다.</Quiet>
          )}
        </Col>

        <Col>
          <h3>지금 하고 있는 일</h3>
          {open.length === 0 ? (
            <Quiet>열려 있는 요청이 없습니다.</Quiet>
          ) : (
            open.slice(-2).map((row) => {
              const step = [...row.steps].reverse().find((s) => s.started) ?? row.steps[0];
              const held = holdsOf(step.requestId);
              return (
                <Card key={row.key}>
                  <b>{row.need}{row.subjectId ? ` · ${personName(row.subjectId)}` : ''}</b>
                  {held && held.knows.length > 0 && (
                    <>
                      <em>MEDial이 아는 것</em>
                      <ul>{held.knows.map((k) => <li key={k}>{k}</li>)}</ul>
                    </>
                  )}
                  {held && held.unknown.length > 0 && (
                    <>
                      <em data-unknown="true">모르는 것</em>
                      <ul>{held.unknown.map((k) => <li key={k}>{k}</li>)}</ul>
                    </>
                  )}
                </Card>
              );
            })
          )}

          <h3 style={{ marginTop: 14 }}>오늘 부탁을 받은 사람</h3>
          {ledger.load.length === 0 ? (
            <Quiet>아직 누구에게도 부탁하지 않았습니다.</Quiet>
          ) : (
            <Bars>
              {ledger.load.slice(0, 6).map((l) => (
                <li key={l.actorId}>
                  <span>{personName(l.actorId)}</span>
                  <i style={{ width: `${(l.count / peak) * 100}%` }} />
                  <em>{l.count}</em>
                </li>
              ))}
            </Bars>
          )}
        </Col>
      </Body>
    </Box>
  );
}
