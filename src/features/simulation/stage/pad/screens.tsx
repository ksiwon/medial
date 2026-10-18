import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { claimTone, inkA, night, radius } from '../../ui/theme';
import type { Command, StageState } from '../protocol';
import { Button, Card, Grid, Hint, Next, Page, Row, Spacer, Stage } from './kit';

// What the tablet shows at each stage of the walk. The tablet is touched and the wall is read: a paragraph here pulls
// the visitor's eyes away from the wall (researcher, 2026-10-18). So a screen has its buttons and just enough to know
// what a press does - an event's title, a resident's name and the kinds of what they said, a request's number and its
// sentence, where in the telling the wall is - and no explanation. (Buttons alone, tried the same day, said too little.) Every screen takes the wall's state and a `press`, and nothing else: it keeps no copy of the walk.

export type Press = (command: Command) => void;

// ---- before the walk ---------------------------------------------------------

export function Waiting({ press }: { press: Press }) {
  return (
    <Stage>
      <h1>서비스 디자이너가 되어 보세요</h1>
      <Button $tone="primary" $big onClick={() => press({ name: 'start' })}>시작하기</Button>
    </Stage>
  );
}

export function Watching({ press }: { press: Press }) {
  return (
    <Stage>
      <h1>큰 화면을 봐 주세요</h1>
      <Button $tone="quiet" $big onClick={() => press({ name: 'skipIntro' })}>건너뛰기 →</Button>
    </Stage>
  );
}

// ---- the week ----------------------------------------------------------------

/** The week, down the page: a day, and the events on it. The whole row of an event is the target. A day with
 *  nothing is an empty row: the week is not one event a day. */
const WeekList = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: repeat(7, minmax(0, 1fr));
  gap: 8px;
`;

const DayRow = styled.div<{ $empty: boolean }>`
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
  min-height: 0;
  ${(p) => p.$empty && 'opacity: 0.5;'}
  > b { display: grid; place-items: center; font-size: 24px; font-weight: 800; border-radius: ${radius.card}; border: 1px solid ${night.line}; background: ${(p) => (p.$empty ? 'transparent' : night.panel)}; }
  > div { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 8px; min-height: 0; }
  > div > i { border: 1px dashed ${night.line}; border-radius: ${radius.card}; }
`;

const EventButton = styled(Card)<{ $seen: boolean }>`
  min-height: 0;
  height: 100%;
  padding: 8px 16px;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  ${(p) => p.$seen && 'opacity: 0.55;'}
  > b { flex: 1; font-size: 24px; }
  > small { flex: none; padding: 4px 12px; border-radius: ${radius.pill}; font-size: 16px; font-weight: 800; color: ${night.deep}; background: ${night.ink}; }
`;

export function Week({ s, press }: { s: StageState; press: Press }) {
  return (
    <Page>
      <Hint>보고 싶은 사건을 누르세요 · {s.seen} / {s.total}개 봤어요</Hint>
      <WeekList>
        {s.week.map((d) => (
          <DayRow key={d.day} $empty={d.events.length === 0}>
            <b>{d.day}</b>
            <div>
              {d.events.length === 0 && <i aria-label="조용한 날" />}
              {d.events.map((e) => (
                <EventButton key={e.id} $seen={e.seen} onClick={() => press({ name: 'openEvent', id: e.id })}>
                  <b>{e.title}</b>
                  {e.seen ? <small>{e.chosen ? `✓ ${e.chosen}번` : '✓'}</small> : e.noChoice ? <small>응급</small> : null}
                </EventButton>
              ))}
            </div>
          </DayRow>
        ))}
      </WeekList>
      {s.seen > 0 && <Row><Spacer /><Button onClick={() => press({ name: 'finish' })}>마치기 →</Button></Row>}
    </Page>
  );
}

// ---- a telling ---------------------------------------------------------------

const Track = styled.div<{ $p: number }>`
  flex: none;
  height: 8px;
  border-radius: ${radius.pill};
  background: ${inkA(0.12)};
  overflow: hidden;
  > i { display: block; height: 100%; width: ${(p) => p.$p * 100}%; border-radius: ${radius.pill}; background: ${night.accent}; transition: width 0.4s linear; }
`;

/** Where the wall is in the telling, small: a glance says the tablet and the wall agree. */
const Where = styled.div`
  flex: none;
  text-align: center;
  font-size: 24px;
  font-weight: 700;
  color: ${night.mute};
  font-variant-numeric: tabular-nums;
`;

/** The buttons fill the page: a press is found without looking down for long. */
const Pads = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  gap: 16px;
  /* Tall buttons are rounded rectangles: a pill this tall became a huge oval. */
  > button { height: 100%; font-size: 40px; border-radius: ${radius.card}; }
`;

/** The event plays by itself, a line at a time. The only things a visitor does in it are to go back or on by a
 *  line, to skip the scene, or - once it has been told - to go on to what the residents made of it. The large button
 *  is the next line: skipping a whole scene is the small one, so the obvious press never throws the scene away. */
export function Telling({ s, press, after }: { s: StageState; press: Press; after: boolean }) {
  return (
    <Page>
      <Track $p={s.lines > 0 ? (s.line + 1) / s.lines : 0} aria-hidden><i /></Track>
      <Where>{after ? '고른 요청대로 다시 · ' : ''}{s.scene ? `${s.scene.time} · 장면 ${s.scene.index + 1} / ${s.scene.of}` : ''}</Where>
      {s.toldAll ? (
        <Pads style={{ gridTemplateColumns: '1fr' }}>
          <Next $big onClick={() => press({ name: after ? 'toResult' : 'toEvaluations' })}>
            {after ? '반영된 평가 →' : '주민 평가 →'}
          </Next>
        </Pads>
      ) : (
        <Pads>
          <Button $tone="quiet" onClick={() => press({ name: 'line', value: -1 })} disabled={s.line <= 0}>← 이전</Button>
          <Button $tone="primary" onClick={() => press({ name: 'line', value: 1 })}>다음 →</Button>
          <Button $tone="quiet" onClick={() => press({ name: 'skipScene' })}>넘기기 ⇥</Button>
        </Pads>
      )}
    </Page>
  );
}

// ---- the residents' evaluations ----------------------------------------------

const Resident = styled(Card)`
  min-height: 0;
  height: 100%;
  justify-content: center;
  align-items: center;
  gap: 12px;
  > b { font-size: 32px; }
  > i { font-style: normal; font-size: 32px; font-weight: 800; letter-spacing: 0.08em; }
`;

export function Evaluations({ s, press, result = false }: { s: StageState; press: Press; result?: boolean }) {
  const emergency = s.event?.noChoice ?? false;
  if (s.openActor) {
    return (
      <Page>
        <Pads style={{ gridTemplateColumns: '1fr' }}>
          <Button $tone="primary" onClick={() => press({ name: 'closeResident' })}>← 목록</Button>
        </Pads>
      </Page>
    );
  }
  return (
    <Page>
      <Grid $cols={Math.max(1, Math.min(3, s.residents.length))} style={{ gridAutoRows: '1fr' }}>
        {s.residents.map((r) => (
          <Resident key={r.id} onClick={() => press({ name: 'openResident', id: r.id })}>
            <b>{r.name}</b>
            <i aria-label="주장의 종류">{r.marks.map((k, j) => <span key={j} style={{ color: claimTone[k].color }}>{claimTone[k].mark}</span>)}</i>
          </Resident>
        ))}
      </Grid>
      <Row>
        <Button $tone="quiet" onClick={() => press({ name: 'week' })}>← 이번 주</Button>
        <Spacer />
        {!result && !emergency && <Next onClick={() => press({ name: 'toChoose' })}>고르기 →</Next>}
        {!result && emergency && <Next onClick={() => press({ name: 'toChoose' })}>다 읽었어요 →</Next>}
        {result && <Button $tone="quiet" onClick={() => press({ name: 'finish' })}>마치기</Button>}
      </Row>
    </Page>
  );
}

// ---- choosing what to change -------------------------------------------------

/** A request is its number and its sentence: the card with that number is on the wall, and lights when touched. */
const RequestNumber = styled(Card)`
  min-height: 0;
  height: 100%;
  align-items: center;
  justify-content: center;
  gap: 24px;
  text-align: center;
  > b { font-size: 96px; line-height: 1; }
  > span { font-size: 24px; font-weight: 700; line-height: 1.4; color: ${night.ink}; word-break: keep-all; -webkit-line-clamp: 4; }
`;

export function Choose({ s, press }: { s: StageState; press: Press }) {
  // A choice cannot be taken back, so it takes two touches: a number (lit here and on the wall), then the button that
  // confirms it. From the confirm on, nothing else on this page answers.
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => { setSent(null); }, [s.event?.id]);
  const picked = s.considering;
  const number = picked ? s.requests.findIndex((r) => r.id === picked) + 1 : null;
  return (
    <Page>
      <Grid $cols={Math.max(1, Math.min(3, s.requests.length))} style={{ gridAutoRows: '1fr' }}>
        {s.requests.map((r, i) => (
          <RequestNumber key={r.id} $on={picked === r.id} disabled={sent !== null}
            onClick={() => press({ name: 'consider', id: picked === r.id ? null : r.id })}>
            <b>{i + 1}</b>
            <span>{r.label}</span>
          </RequestNumber>
        ))}
      </Grid>
      <Row>
        <Button $tone="quiet" onClick={() => press({ name: 'week' })} disabled={sent !== null}>← 이번 주</Button>
        <Spacer />
        <Next disabled={!picked || sent !== null} onClick={() => { if (picked) { setSent(picked); press({ name: 'choose', id: picked }); } }}>
          {number ? `${number}번으로 다시 보기 →` : '번호를 고르세요'}
        </Next>
      </Row>
    </Page>
  );
}

// ---- the end of an event -------------------------------------------------------

export function Result({ s, press }: { s: StageState; press: Press }) {
  return <Evaluations s={s} press={press} result />;
}

// ---- the closing ---------------------------------------------------------------

export function Closing({ s, press }: { s: StageState; press: Press }) {
  return (
    <Stage>
      <h1>{s.seen}개의 사건을 고쳐 보았습니다</h1>
      {!s.closingWords && <Button $tone="quiet" $big onClick={() => press({ name: 'closingWords' })}>마무리 말 →</Button>}
      <Button $tone="primary" $big onClick={() => press({ name: 'home' })}>처음으로</Button>
    </Stage>
  );
}

// ---- not (or no longer) the tablet --------------------------------------------
// These are for whoever sets the exhibition up, not for a visitor in the middle of a walk: they keep their words.

export function Scan({ why }: { why: 'no-code' | 'released' }) {
  return (
    <Stage>
      <h1>{why === 'released' ? '다른 태블릿이 연결되었습니다' : 'QR 코드를 스캔해 주세요'}</h1>
      <p>
        {why === 'released'
          ? '이 태블릿은 연결이 해제되었습니다. 다시 쓰려면 큰 화면의 QR 코드를 카메라로 비춰 주세요.'
          : '큰 화면에 나온 QR 코드를 iPad 카메라로 비추면 이 페이지가 열립니다. 주소를 직접 입력해서는 연결되지 않습니다.'}
      </p>
    </Stage>
  );
}

export function Join({ onJoin }: { onJoin: () => void }) {
  return (
    <Stage>
      <h1>큰 화면과 연결합니다</h1>
      <p>큰 화면의 QR 코드를 비춘 것이 맞다면 아래 버튼을 눌러 주세요.</p>
      <Button $tone="primary" $big onClick={onJoin}>연결하기</Button>
    </Stage>
  );
}
