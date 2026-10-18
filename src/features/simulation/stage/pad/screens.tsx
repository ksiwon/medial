import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { inkA, night, radius } from '../../ui/theme';
import type { Command, StageState } from '../protocol';
import { Button, Card, Grid, Hint, Next, Page, Row, Spacer, Stage } from './kit';

// What the tablet shows at each stage of the walk. Every screen takes the wall's state and a `press`,
// and nothing else: it keeps no copy of the walk. What a screen remembers by itself is only what a
// finger is doing right now (a held slider, the choice that was just touched).

export type Press = (command: Command) => void;

// ---- before the walk ---------------------------------------------------------

export function Waiting({ press }: { press: Press }) {
  return (
    <Stage>
      <h1>서비스 디자이너가 되어 보세요</h1>
      <p>한 주 동안 마을에 있었던 일 가운데 보고 싶은 것을 골라 보고, 주민의 평가를 읽고, 고칠 것을 하나 골라 그 일이 어떻게 달라지는지 봅니다.</p>
      <Button $tone="primary" $big onClick={() => press({ name: 'start' })}>시작하기</Button>
    </Stage>
  );
}

export function Watching({ press }: { press: Press }) {
  return (
    <Stage>
      <h1>큰 화면을 봐 주세요</h1>
      <p>소개 영상이 끝나면 이번 주가 열립니다.</p>
      <Button $tone="quiet" onClick={() => press({ name: 'skipIntro' })}>건너뛰기 →</Button>
    </Stage>
  );
}

// ---- the week ----------------------------------------------------------------

/** The week, down the page: a day, and the events on it. The whole row of an event is the target. A day with
 *  nothing is left empty on purpose: the week is not one event a day. */
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
  > div > em { display: flex; align-items: center; padding: 0 16px; font-style: normal; font-size: 16px; color: ${night.faint}; border: 1px dashed ${night.line}; border-radius: ${radius.card}; }
`;

const EventButton = styled(Card)<{ $seen: boolean }>`
  min-height: 0;
  height: 100%;
  padding: 8px 16px;
  justify-content: center;
  gap: 2px;
  ${(p) => p.$seen && 'opacity: 0.6;'}
  > b { font-size: 20px; }
  > small { font-size: 12px; color: ${night.mute}; }
`;

export function Week({ s, press }: { s: StageState; press: Press }) {
  return (
    <Page>
      <Hint>보고 싶은 사건을 하나 누르세요. 큰 화면에서 그 일이 펼쳐집니다. ({s.seen} / {s.total}개 봤어요)</Hint>
      <WeekList>
        {s.week.map((d) => (
          <DayRow key={d.day} $empty={d.events.length === 0}>
            <b>{d.day}</b>
            <div>
              {d.events.length === 0 && <em>이날은 조용했습니다</em>}
              {d.events.map((e) => (
                <EventButton key={e.id} $seen={e.seen} onClick={() => press({ name: 'openEvent', id: e.id })}>
                  <b>{e.title}</b>
                  {(e.noChoice || e.seen) && (
                    <small>{e.noChoice ? (e.seen ? '응급 · 읽음' : '응급 · 읽기만') : e.chosen ? `읽음 · 고른 요청 ${e.chosen}번` : '읽음'}</small>
                  )}
                </EventButton>
              ))}
            </div>
          </DayRow>
        ))}
      </WeekList>
      {/* Finishing is this page's own action, at its foot like every other page's - not a second button beside
          처음으로 at the top, which looked the same and threw the visit away. */}
      {s.seen > 0 && (
        <Row><Spacer /><Button onClick={() => press({ name: 'finish' })}>다 봤어요 · 마치기 →</Button></Row>
      )}
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

/** What the wall is on right now, said big: the visitor looks up at the wall, and glances down to this. */
const Now = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
  text-align: center;
  > small { font-size: 20px; font-weight: 800; letter-spacing: 0.08em; color: ${night.accent}; }
  > strong { font-size: 56px; font-weight: 800; letter-spacing: -0.04em; line-height: 1.2; word-break: keep-all; }
  > time { font-size: 28px; font-weight: 700; color: ${night.mute}; font-variant-numeric: tabular-nums; }
`;

const Pair = styled.div`
  flex: none;
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  gap: 16px;
  > button { min-height: 120px; font-size: 32px; }
`;

/** The event plays by itself, a line at a time. The only things a visitor does in it are to go back or on by a
 *  line, to skip the scene, or - once it has been told - to read what the residents made of it. The large button
 *  is the next line: skipping a whole scene is the small one, so the obvious press never throws the scene away. */
export function Telling({ s, press, after }: { s: StageState; press: Press; after: boolean }) {
  return (
    <Page>
      <Track $p={s.lines > 0 ? (s.line + 1) / s.lines : 0} aria-hidden><i /></Track>
      <Now aria-live="off">
        <small>{after ? '고른 요청대로 다시 펼쳐지는 일' : s.toldAll ? '이야기가 끝났어요' : '지금 이 장면'}</small>
        <strong>{s.event?.title ?? ''}</strong>
        <time>{s.scene ? `${s.scene.time} · ${s.scene.index + 1} / ${s.scene.of}` : ''}</time>
      </Now>
      {s.toldAll ? (
        <Row><Spacer /><Next $big onClick={() => press({ name: after ? 'toResult' : 'toEvaluations' })}>
          {after ? '반영된 평가 보기 →' : '주민 평가 보기 →'}
        </Next><Spacer /></Row>
      ) : (
        <Pair>
          <Button $tone="quiet" onClick={() => press({ name: 'line', value: -1 })} disabled={s.line <= 0}>← 이전 줄</Button>
          <Button $tone="primary" onClick={() => press({ name: 'line', value: 1 })}>다음 줄 →</Button>
          <Button $tone="quiet" onClick={() => press({ name: 'skipScene' })}>장면 넘기기 ⇥</Button>
        </Pair>
      )}
    </Page>
  );
}

// ---- the residents' evaluations ----------------------------------------------

export function Evaluations({ s, press, result = false }: { s: StageState; press: Press; result?: boolean }) {
  const open = s.openActor ? s.residents.find((r) => r.id === s.openActor) ?? null : null;
  const emergency = s.event?.noChoice ?? false;
  if (open) {
    return (
      <Page>
        <Row>
          <Button $tone="primary" onClick={() => press({ name: 'closeResident' })}>← 목록으로</Button>
          <Hint style={{ fontSize: 28, fontWeight: 800, color: night.ink }}>{open.name}의 평가</Hint>
        </Row>
        <Hint>큰 화면에서 읽어 주세요. 평가가 어느 대사를 근거로 삼았는지도 함께 보입니다.</Hint>
      </Page>
    );
  }
  return (
    <Page>
      <Hint>
        {result ? '고른 요청이 반영된 일을 겪은 주민입니다.' : '이 일을 겪은 주민입니다.'} 한 분을 누르면 큰 화면에 그분의 평가가 펼쳐집니다.
      </Hint>
      <Grid $cols={1}>
        {s.residents.map((r) => (
          <Card key={r.id} onClick={() => press({ name: 'openResident', id: r.id })}>
            <b>{r.name}</b>
            <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' }}>{r.said}</span>
            <small>큰 화면에서 보기 →</small>
          </Card>
        ))}
      </Grid>
      <Row>
        <Button $tone="quiet" onClick={() => press({ name: 'week' })}>← 이번 주로</Button>
        <Spacer />
        {!result && !emergency && <Next onClick={() => press({ name: 'toChoose' })}>무엇을 고칠지 고르기 →</Next>}
        {!result && emergency && <Next onClick={() => press({ name: 'toChoose' })}>다 읽었어요 →</Next>}
        {result && <Button $tone="quiet" onClick={() => press({ name: 'finish' })}>마치기</Button>}
      </Row>
    </Page>
  );
}

// ---- choosing what to change -------------------------------------------------

const Pick = styled(Card)`
  min-height: 0;
  padding: 24px;
  gap: 12px;
  > b { font-size: 28px; }
  > span { -webkit-line-clamp: 4; }
  > div { margin-top: auto; width: 100%; padding-top: 16px; border-top: 1px solid ${night.line}; font-size: 20px; line-height: 1.5; color: ${night.mute}; word-break: keep-all; }
  > div > strong { color: ${night.ink}; display: block; }
  > em { font-style: normal; font-size: 16px; color: ${night.faint}; }
  > em.weak { color: #e8c46a; font-weight: 800; }
`;

export function Choose({ s, press }: { s: StageState; press: Press }) {
  // A choice cannot be taken back, so it takes two touches: a card (lit here and on the wall), then the button that
  // confirms it. From the confirm on, nothing else on this page answers.
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => { setSent(null); }, [s.event?.id]);
  const picked = s.considering;
  return (
    <Page>
      <Hint>
        {s.requests.length > 1 ? '요청을 하나 누르고, 아래 버튼으로 확정하세요.' : '이 사건의 요청은 하나예요. 눌러서 살펴본 뒤 아래 버튼으로 반영하세요.'}
        {' '}확정하면 같은 일이 그 요청대로 다시 펼쳐지고 되돌릴 수 없어요.
      </Hint>
      <Grid $cols={Math.max(1, Math.min(3, s.requests.length))}>
        {s.requests.map((r, i) => (
          <Pick key={r.id} $on={picked === r.id} disabled={sent !== null}
            onClick={() => press({ name: 'consider', id: picked === r.id ? null : r.id })}>
            <small>{i + 1}</small>
            <b>{r.label}</b>
            {r.from && <em className={r.basis === 'weak' ? 'weak' : undefined}>{r.basis === 'weak' ? '근거가 약한 요청' : `${r.from}의 평가에서`}</em>}
            <div><strong>바라는 것 · {r.expect}</strong>따를 부담 · {r.cost}</div>
          </Pick>
        ))}
      </Grid>
      <Row>
        <Button $tone="quiet" onClick={() => press({ name: 'week' })} disabled={sent !== null}>← 이번 주로</Button>
        <Spacer />
        <Next disabled={!picked || sent !== null} onClick={() => { if (picked) { setSent(picked); press({ name: 'choose', id: picked }); } }}>
          {picked ? `${s.requests.findIndex((r) => r.id === picked) + 1}번 요청으로 다시 보기 →` : '요청을 먼저 골라 주세요'}
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
      <h1>{s.closingWords ? '함께해 주셔서 고맙습니다' : `${s.seen}개의 사건을 고쳐 보았습니다`}</h1>
      <p>{s.closingWords ? '큰 화면의 마무리 말을 들어 주세요. 잠시 뒤 처음 화면으로 돌아갑니다.' : '큰 화면에 이번에 고친 것이 정리되어 있습니다.'}</p>
      {!s.closingWords && <Button $tone="quiet" onClick={() => press({ name: 'closingWords' })}>마무리 말 듣기 →</Button>}
      <Button $tone="primary" $big onClick={() => press({ name: 'home' })}>처음으로 돌아가기</Button>
    </Stage>
  );
}

/** The wall's clock, said here too: the visitor at the tablet sees the page will go on without them. */
const Countdown = styled.div`
  flex: none;
  align-self: flex-end;
  margin-top: -8px;
  font-size: 20px;
  font-weight: 700;
  color: ${night.mute};
  font-variant-numeric: tabular-nums;
`;

export function AutoNote({ auto }: { auto: { key: string; seconds: number; say: string } }) {
  const [left, setLeft] = useState(auto.seconds);
  useEffect(() => {
    setLeft(auto.seconds);
    const tick = window.setInterval(() => setLeft((n) => Math.max(n - 1, 0)), 1000);
    return () => window.clearInterval(tick);
  }, [auto.key, auto.seconds]);
  return left > 0 ? <Countdown aria-live="off">{left}초 뒤 {auto.say}</Countdown> : null;
}

// ---- not (or no longer) the tablet --------------------------------------------

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
