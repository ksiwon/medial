import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { inkA, night, radius } from '../../ui/theme';
import { READS_TO_CLOSE } from '../../week/selectors';
import type { Command, StageState } from '../protocol';
import { Ask, Button, Card, Grid, Hint, Next, Page, Row, Spacer, Stage } from './kit';

// What the tablet shows at each stage of the walk. The tablet is touched and the wall is read: a paragraph here pulls
// the visitor's eyes away from the wall (researcher, 2026-10-18). So a screen has its buttons and just enough to know
// what a press does - an event's title, a resident's name and the kinds of what they said, a request's number and its
// sentence, where in the telling the wall is - and no explanation. (Buttons alone, tried the same day, said too little.) Every screen takes the wall's state and a `press`, and nothing else: it keeps no copy of the walk.

export type Press = (command: Command) => void;

// ---- before the walk ---------------------------------------------------------

/** Until the wall holds every picture and voice, the start is not offered: the button says it is still loading. */
export function Waiting({ s, press }: { s: StageState; press: Press }) {
  return (
    <Stage>
      <h1>서비스 디자이너가 되어 보세요</h1>
      <Button $tone="primary" $big disabled={!s.ready} onClick={() => press({ name: 'start' })}>{s.ready ? '시작하기' : '로딩 중...'}</Button>
    </Stage>
  );
}

/** The film's own controls, small and in the middle: a sentence back, hold or go on, a sentence on. The way out of the
 *  film (skipping it) is the large press below them. */
const Transport = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

export function Watching({ s, press }: { s: StageState; press: Press }) {
  return (
    <Stage>
      <h1>큰 화면을 봐 주세요</h1>
      <Transport role="group" aria-label="소개 영상 조작">
        <Button onClick={() => press({ name: 'introPrev' })}>← 이전</Button>
        <Button $tone={s.introPaused ? 'primary' : 'plain'} onClick={() => press({ name: 'introToggle' })}>{s.introPaused ? '▶ 재생' : '❚❚ 일시정지'}</Button>
        <Button onClick={() => press({ name: 'introNext' })}>다음 →</Button>
      </Transport>
      <Button $tone="quiet" $big onClick={() => press({ name: 'skipIntro' })}>건너뛰기 →</Button>
    </Stage>
  );
}

/** The draft the designer brought is read on the wall; the tablet only goes on. */
export function Draft({ press }: { press: Press }) {
  return (
    <Stage>
      <h1>들고 온 초안을 큰 화면에서 읽어 보세요</h1>
      <Button $tone="primary" $big onClick={() => press({ name: 'week' })}>이번 주로 →</Button>
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

const EventButton = styled(Card)`
  min-height: 0;
  height: 100%;
  padding: 8px 16px;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  > b { flex: 1; font-size: 24px; }
  > small { flex: none; padding: 4px 12px; border-radius: ${radius.pill}; font-size: 16px; font-weight: 800; color: ${night.deep}; background: ${night.ink}; }
`;

export function Week({ s, press }: { s: StageState; press: Press }) {
  // Not "n of 5": the visitor may read as many versions as they like; five is only where the closing opens, and the
  // page says so in those words ("5번 이상") for as long as it is on.
  const opens = s.reads >= READS_TO_CLOSE;
  return (
    <Page>
      <Hint>보고 싶은 사건을 누르세요</Hint>
      <WeekList>
        {s.week.map((d) => (
          <DayRow key={d.day} $empty={d.events.length === 0}>
            <b>{d.day}</b>
            <div>
              {d.events.length === 0 && <i aria-label="조용한 날" />}
              {d.events.map((e) => (
                <EventButton key={e.id} onClick={() => press({ name: 'openEvent', id: e.id })}>
                  <b>{e.title}</b>
                  {e.noChoice ? <small>응급</small> : e.version > 1 ? <small>v{e.version}</small> : null}
                </EventButton>
              ))}
            </div>
          </DayRow>
        ))}
      </WeekList>
      {/* The closing is always on the page, so the way out is known; until the fifth version it is an outline that does not answer. */}
      <Row>
        <Spacer />
        <Hint>본 버전 {s.reads} · 고친 횟수 {s.runs} · {READS_TO_CLOSE}번 이상 보면 마무리 장면으로 넘어갈 수 있어요</Hint>
        <Next disabled={!opens} onClick={() => press({ name: 'finish' })}>마무리 장면 보기 →</Next>
      </Row>
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

/** The buttons sit at the foot, a thumb's height: a press is found without looking down for long, and the page is not one big button. */
const Pads = styled.div`
  flex: none;
  margin-top: auto;
  height: 144px;
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  gap: 16px;
  > button { height: 100%; font-size: 28px; border-radius: ${radius.card}; }
`;

/** The event plays by itself, a line at a time. The only things a visitor does in it are to go back or on by a
 *  line, to skip the scene, or - once it has been told - to go on to what the residents made of it. The large button
 *  is the next line: skipping a whole scene is the small one, so the obvious press never throws the scene away. */
export function Telling({ s, press }: { s: StageState; press: Press }) {
  return (
    <Page>
      <Track $p={s.lines > 0 ? (s.line + 1) / s.lines : 0} aria-hidden><i /></Track>
      <Where>ver{s.version}{s.scene ? ` · ${s.scene.time} · 장면 ${s.scene.index + 1} / ${s.scene.of}` : ''}</Where>
      {s.toldAll ? (
        <Pads style={{ gridTemplateColumns: '1fr' }}>
          <Next $big onClick={() => press({ name: 'toEvaluations' })}>주민의 피드백 →</Next>
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
// What the residents said is on the wall; the tablet only decides where to go next.

export function Evaluations({ s, press }: { s: StageState; press: Press }) {
  return (
    <Page>
      <Pads style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Button $tone="quiet" onClick={() => press({ name: 'toTelling' })}>← 대화로 돌아가기</Button>
        {/* A version with nothing to choose ends the event: the way on is back to the week. */}
        {s.leaf
          ? <Button $tone="primary" onClick={() => press({ name: 'week' })}>이번 주로 →</Button>
          : <Button $tone="primary" onClick={() => press({ name: 'toChoose' })}>수정 요청 고르기 →</Button>}
      </Pads>
    </Page>
  );
}

// ---- choosing what to change -------------------------------------------------

/** A request is its number and its sentence: the card with that number is on the wall, and lights when touched. */
const RequestNumber = styled(Card)`
  min-height: 0;
  height: 100%;
  align-items: center;
  /* The number is on one line in every card; the sentence hangs under it, however many lines it takes. */
  justify-content: flex-start;
  padding-top: 140px;
  gap: 24px;
  text-align: center;
  > b { font-size: 96px; line-height: 1; }
  > span { font-size: 24px; font-weight: 700; line-height: 1.4; color: ${night.ink}; word-break: keep-all; -webkit-line-clamp: 4; }
`;

export function Choose({ s, press }: { s: StageState; press: Press }) {
  // A choice cannot be taken back, so it takes two touches: a number (lit here and on the wall), then "돌리기" in the
  // question that comes up. From that on, nothing else on this page answers.
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => { setSent(null); }, [s.event?.id]);
  const picked = s.considering;
  const number = picked ? s.requests.findIndex((r) => r.id === picked) + 1 : null;
  if (s.generating) return <Stage><h1>새로운 시뮬레이션을 만들고 있어요</h1></Stage>;
  return (
    <Page>
      <Grid $cols={Math.max(1, Math.min(3, s.requests.length))} style={{ gridAutoRows: '1fr' }}>
        {s.requests.map((r, i) => (
          <RequestNumber key={r.id} $on={picked === r.id} disabled={sent !== null}
            onClick={() => press({ name: 'consider', id: r.id })}>
            <b>{i + 1}</b>
            <span>{r.label}</span>
          </RequestNumber>
        ))}
      </Grid>
      <Row>
        <Button $tone="quiet" onClick={() => press({ name: 'toEvaluations' })} disabled={sent !== null}>← 주민의 피드백</Button>
        <Spacer />
      </Row>
      {picked && sent === null && (
        <Ask role="dialog" aria-label="고른 요청을 반영할까요">
          <section>
            <h2>{number}번 수정 요청을 AI에 반영하시겠습니까?</h2>
            <p>반영된 규칙대로 이 사건을 새로 시뮬레이션합니다.</p>
            <div>
              <Button $tone="quiet" onClick={() => press({ name: 'consider', id: null })}>다시 고르기</Button>
              <Button $tone="primary" onClick={() => { setSent(picked); press({ name: 'choose', id: picked }); }}>돌리기</Button>
            </div>
          </section>
        </Ask>
      )}
    </Page>
  );
}

// ---- the closing ---------------------------------------------------------------

export function Closing({ s, press }: { s: StageState; press: Press }) {
  return (
    <Stage>
      <h1>{s.events}개의 사건, {s.reads}개의 버전을 보고 {s.runs}번 고쳤습니다</h1>
      {/* The closing words are always heard before the way back: the start button only comes up once they are on the wall. */}
      {s.closingWords
        ? <Button $tone="primary" $big onClick={() => press({ name: 'home' })}>처음으로</Button>
        : <Button $tone="primary" $big onClick={() => press({ name: 'closingWords' })}>마무리 말 →</Button>}
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
