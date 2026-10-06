import styled from 'styled-components';
import { formatClock } from '../positions';
import type { Ledger, Routine } from '../selectors/dayLedger';
import { personName } from '../selectors/story';
import { font } from '../ui/theme';

// MEDial's dashboard: what the service has done by now, shown while no scene is
// on. It takes the stage that a request's scene takes when there is one, so the
// stage is never empty and the reader is never left asking what the day is doing.
//
// Every number is read off the day so far (selectors/dayLedger) - it moves with
// the playhead and says nothing about the hours to come. "Asked" counts requests
// a person was asked to help with, which is where the day's burden falls; it is
// not a score of anyone.
//
// It holds only what MEDial holds. What happened and MEDial never saw (two brothers
// on a pier) is not here - not even as a line saying so, which would hand MEDial
// the place and the person. The researcher reads that on the map and in the ledger.

const Box = styled.div`
  position: absolute;
  inset: 0;
  border-radius: 12px;
  background: #1b1c1a;
  color: #f6f1e8;
  padding: 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow: hidden;
`;

const Top = styled.header`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  > h2 { margin: 0; font-size: 13px; font-weight: 800; letter-spacing: 0.1em; color: #e2542c; }
  > time { font-size: 38px; font-weight: 800; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
`;

const Tally = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
`;

const Stat = styled.div<{ $on?: boolean }>`
  padding: 14px 16px;
  border-radius: 10px;
  background: ${(p) => (p.$on ? 'rgba(226, 84, 44, 0.16)' : 'rgba(246, 241, 232, 0.06)')};
  border: 1px solid ${(p) => (p.$on ? 'rgba(226, 84, 44, 0.5)' : 'rgba(246, 241, 232, 0.1)')};
  > b { display: block; font-size: 40px; line-height: 1; font-weight: 800; font-variant-numeric: tabular-nums; }
  > span { display: block; margin-top: 8px; font-size: ${font.small}; color: rgba(246, 241, 232, 0.7); }
`;

const Cols = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 22px;
`;

const Col = styled.section`
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  > h3 { margin: 0; font-size: ${font.small}; font-weight: 800; letter-spacing: 0.08em; color: rgba(246, 241, 232, 0.6); }
`;

const Card = styled.div`
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(246, 241, 232, 0.14);
  > b { display: block; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
  > em { display: block; margin-top: 10px; font-style: normal; font-size: 11px; font-weight: 800;
         letter-spacing: 0.08em; color: #e2542c; }
  > em[data-unknown='true'] { color: rgba(246, 241, 232, 0.55); }
  > ul { margin: 4px 0 0; padding-left: 16px; font-size: ${font.small}; line-height: 1.6;
         color: rgba(246, 241, 232, 0.86); }
`;

const Bars = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  > li { display: grid; grid-template-columns: 74px 1fr 22px; align-items: center; gap: 10px; font-size: ${font.small}; }
  > li > i { display: block; height: 8px; border-radius: 999px; background: #e2542c; min-width: 6px; }
  > li > em { font-style: normal; font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; }
`;

const Routine = styled.section`
  flex: none;
  padding-top: 14px;
  border-top: 1px solid rgba(246, 241, 232, 0.12);
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  > h3 { margin: 0; font-size: ${font.small}; font-weight: 800; letter-spacing: 0.08em; color: rgba(246, 241, 232, 0.6); }
  > p { margin: 0; font-size: ${font.body}; color: rgba(246, 241, 232, 0.86); }
  > p > b { color: #f6f1e8; }
  > ul { list-style: none; margin: 0 0 0 auto; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  > ul > li { font-size: ${font.small}; padding: 4px 10px; border-radius: 999px;
              border: 1px solid rgba(246, 241, 232, 0.18); color: rgba(246, 241, 232, 0.8); }
  > ul > li > b { margin-left: 6px; color: #f6f1e8; }
`;

const Quiet = styled.p`
  margin: 0;
  font-size: ${font.body};
  line-height: 1.6;
  color: rgba(246, 241, 232, 0.66);
`;

interface Props {
  ledger: Ledger;
  atMs: number;
  /** The next scene, so a quiet stretch says what it is waiting for. */
  next: { startMs: number; title: string } | null;
  /** What MEDial held about a request at the playhead: its panel's "아는 것"
   *  and what it was told to keep back. The ledger already says what was done;
   *  this says what MEDial could and could not see while it did it. */
  holdsOf: (requestId: string) => { knows: string[]; unknown: string[] } | null;
  /** The village's ordinary day at the playhead: the ground the requests stand on. */
  routine: Routine;
}

export default function MedialDashboard({ ledger, atMs, next, holdsOf, routine }: Props) {
  const open = ledger.rows.filter((row) => row.state === 'open');
  const peak = Math.max(1, ...ledger.load.map((l) => l.count));
  return (
    <Box aria-label="MEDial 현황">
      <Top>
        <h2>MEDIAL · 지금까지</h2>
        <time>{formatClock(atMs)}</time>
      </Top>

      <Tally>
        <Stat><b>{ledger.taken}</b><span>접수한 요청</span></Stat>
        <Stat $on={ledger.open > 0}><b>{ledger.open}</b><span>진행 중</span></Stat>
        <Stat><b>{ledger.done}</b><span>마무리</span></Stat>
      </Tally>

      <Cols>
        <Col>
          <h3>지금 하고 있는 일</h3>
          {open.length === 0 ? (
            <Quiet>
              {ledger.taken === 0
                ? '아직 들어온 요청이 없습니다.'
                : '열려 있는 요청이 없습니다.'}
              {next && ` 다음은 ${formatClock(next.startMs)} · ${next.title}.`}
            </Quiet>
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
        </Col>

        <Col>
          <h3>오늘 부탁을 받은 사람</h3>
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
      </Cols>

      <Routine>
        <h3>마을은 지금</h3>
        <p>
          <b>{routine.onRoutine}명</b>이 평소 일과대로 있고
          {routine.departed > 0 ? <>, <b>{routine.departed}명</b>이 평소와 다르게 움직입니다.</> : '.'}
        </p>
        <ul>
          {routine.where.map((w) => <li key={w.label}>{w.label}<b>{w.count}</b></li>)}
        </ul>
      </Routine>
    </Box>
  );
}
