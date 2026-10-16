import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import styled from 'styled-components';
import { formatClock } from '../../positions';
import { inkA, night, radius } from '../../ui/theme';
import { PER_PAGE, type Command, type StageState } from '../protocol';
import { Button, Card, Grid, Hint, Next, Page, Row, Spacer, Stage, TOUCH } from './kit';

// What the tablet shows at each stage of the walk. Every screen takes the wall's state and a `press`,
// and nothing else: it keeps no copy of the walk. What a screen remembers by itself is only what a
// finger is doing right now (a held slider, the choice that was just touched).

export type Press = (command: Command) => void;

// ---- before the walk ---------------------------------------------------------

export function Waiting({ press }: { press: Press }) {
  return (
    <Stage>
      <h1>서비스 디자이너가 되어 보세요</h1>
      <p>마을의 하루를 보고, 주민 에이전트의 평가를 읽고, 고칠 것을 하나 골라 다음 날을 다시 봅니다.</p>
      <Button $tone="primary" $big onClick={() => press({ name: 'start' })}>시작하기</Button>
    </Stage>
  );
}

export function Watching({ press }: { press: Press }) {
  return (
    <Stage>
      <h1>큰 화면을 봐 주세요</h1>
      <p>소개 영상이 끝나면 첫날이 열립니다.</p>
      <Button $tone="quiet" onClick={() => press({ name: 'skipIntro' })}>건너뛰기 →</Button>
    </Stage>
  );
}

// ---- the day -----------------------------------------------------------------

const Track = styled.div<{ $p: number }>`
  flex: none;
  height: 8px;
  border-radius: ${radius.pill};
  background: ${inkA(0.12)};
  overflow: hidden;
  > i { display: block; height: 100%; width: ${(p) => p.$p * 100}%; border-radius: ${radius.pill}; background: ${night.accent}; transition: width 0.4s linear; }
`;

const Clock = styled.time`
  flex: none;
  min-width: 128px;
  font-size: 44px;
  font-weight: 800;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
`;

/** The day's slider, drawn rather than left to the browser: a thick track that fills as the day goes, and a
 *  handle big enough for a finger. (The native one is a white hairline with a dot on a dark page.) */
const Slider = styled.input`
  --fill: 0%;
  flex: 1;
  min-width: 0;
  height: ${TOUCH}px;
  margin: 0;
  background: transparent;
  appearance: none;
  -webkit-appearance: none;
  touch-action: pan-y;
  &:focus-visible { outline: 2px solid ${night.ink}; outline-offset: 4px; }
  &::-webkit-slider-runnable-track {
    height: 12px;
    border-radius: ${radius.pill};
    background: linear-gradient(to right, ${night.accent} var(--fill), ${inkA(0.16)} var(--fill));
  }
  &::-moz-range-track { height: 12px; border-radius: ${radius.pill}; background: ${inkA(0.16)}; }
  &::-moz-range-progress { height: 12px; border-radius: ${radius.pill}; background: ${night.accent}; }
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 44px;
    height: 44px;
    margin-top: -16px;
    border-radius: ${radius.round};
    background: ${night.ink};
    border: 4px solid ${night.accent};
    box-sizing: border-box;
  }
  &::-moz-range-thumb { width: 44px; height: 44px; border-radius: ${radius.round}; background: ${night.ink}; border: 4px solid ${night.accent}; box-sizing: border-box; }
`;

/** While a finger is on the slider the clock follows the finger; once it lets go, the wall's clock again. */
function useHeld(): [number | null, (ms: number | null) => void] {
  const [held, setHeld] = useState<number | null>(null);
  return [held, setHeld];
}

export function Day({ s, press }: { s: StageState; press: Press }) {
  const [held, setHeld] = useHeld();
  const sentAt = useRef(0);
  const top = s.dayEndMs || s.dayStartMs + 1;
  const shown = Math.min(Math.max(held ?? s.atMs, s.dayStartMs), top);
  const move = (ms: number) => {
    setHeld(ms);
    // The wall follows the finger, but not every pixel of it: the bus keeps only the newest.
    const now = performance.now();
    if (now - sentAt.current > 120) { sentAt.current = now; press({ name: 'seek', value: ms }); }
  };
  const release = (ms: number) => {
    press({ name: 'seek', value: ms });
    press({ name: 'commit' });
    setHeld(null);
  };
  return (
    <Page>
      <Track $p={s.progress} aria-hidden><i /></Track>
      <Row>
        <Button $tone="primary" onClick={() => press({ name: 'togglePlay' })} disabled={s.dayOver} style={{ minWidth: 176 }}>
          {s.playing ? '⏸ 정지' : '▶ 재생'}
        </Button>
        <Button onClick={() => press({ name: 'skipScene' })} disabled={s.dayOver}>다음 장면으로 →</Button>
        <Spacer />
        <Clock aria-live="off">{formatClock(shown)}</Clock>
      </Row>
      <Row>
        <Slider type="range" aria-label="시각" min={s.dayStartMs} max={top} step={60_000} value={shown}
          style={{ '--fill': `${((shown - s.dayStartMs) / Math.max(top - s.dayStartMs, 1)) * 100}%` } as React.CSSProperties}
          onChange={(e) => move(Number(e.target.value))}
          onPointerUp={(e) => release(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => release(Number((e.target as HTMLInputElement).value))} />
      </Row>
      <Hint>{s.scene ? `지금 · ${s.scene}` : '아래 일을 누르면 큰 화면이 그 시각으로 갑니다.'}</Hint>
      <Grid $cols={s.tasks.length > 4 ? 3 : 2}>
        {s.tasks.map((t) => (
          <Card key={`${t.startMs}:${t.title}`} $on={s.atMs >= t.startMs}
            onClick={() => { press({ name: 'seek', value: t.startMs }); press({ name: 'commit' }); }}>
            <b>{t.title}</b>
            <span>{formatClock(t.startMs)}</span>
          </Card>
        ))}
      </Grid>
      <Row>
        <Spacer />
        {s.dayOver
          ? <Next $big onClick={() => press({ name: 'readEvaluations' })}>주민 에이전트 평가 보기 →</Next>
          : <Button $tone="quiet" onClick={() => press({ name: 'readEvaluations' })}>하루를 건너뛰고 평가 보기 →</Button>}
      </Row>
    </Page>
  );
}

// ---- the residents' evaluations ----------------------------------------------

export function Evaluations({ s, press }: { s: StageState; press: Press }) {
  const open = s.openActor ? s.residents.find((r) => r.id === s.openActor) ?? null : null;
  if (open || s.issues) {
    return (
      <Page>
        <Row>
          <Button $tone="primary" onClick={() => press({ name: 'evalClose' })}>← 목록으로</Button>
          <Hint style={{ fontSize: 28, fontWeight: 800, color: night.ink }}>{open ? `${open.name}의 인터뷰` : '쟁점 묶음'}</Hint>
        </Row>
        <Hint>큰 화면에서 읽어 주세요. 한동안 누르지 않으면 목록으로 돌아갑니다.</Hint>
        {open && s.went.length > 0 && (
          <>
            <Hint>이분이 겪은 일을 누르면 큰 화면이 그 장면으로 갑니다.</Hint>
            <Grid $cols={2}>
              {s.went.map((w) => (
                <Card key={w.id} onClick={() => press({ name: 'openScene', id: w.id })}>
                  <small>{w.time}</small>
                  <b>{w.title}</b>
                  <span>장면 보기</span>
                </Card>
              ))}
            </Grid>
          </>
        )}
      </Page>
    );
  }
  const first = s.page * PER_PAGE;
  return (
    <Page>
      <Hint>평가를 남긴 주민 {s.residents.length}명. 한 분을 누르면 큰 화면에 인터뷰 전체가 펼쳐집니다.</Hint>
      <Grid $cols={1}>
        {s.residents.slice(first, first + PER_PAGE).map((r) => (
          <Card key={r.id} onClick={() => press({ name: 'evalOpen', id: r.id })}>
            <b>{r.name}</b>
            <span>{r.said}</span>
          </Card>
        ))}
      </Grid>
      <Row>
        <Button onClick={() => press({ name: 'evalPage', value: -1 })} disabled={s.page <= 0}>← 앞</Button>
        <Button onClick={() => press({ name: 'evalPage', value: 1 })} disabled={s.page >= s.pages - 1}>다음 →</Button>
        <Hint>{s.page + 1} / {Math.max(s.pages, 1)}</Hint>
        {s.hasIssues && <Button $tone="quiet" onClick={() => press({ name: 'evalIssues' })}>쟁점 묶음</Button>}
        <Spacer />
        <Next onClick={() => press({ name: 'goImprove' })}>{s.hasChoice ? '무엇을 고칠지 고르기 →' : '결과 보러 가기 →'}</Next>
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
  > div > s { color: ${night.faint}; display: block; }
  > div > strong { color: ${night.ink}; display: block; margin-top: 4px; }
  > em { font-style: normal; font-size: 16px; color: ${night.faint}; }
`;

export function Choose({ s, press }: { s: StageState; press: Press }) {
  // One touch chooses, and a choice cannot be taken back: from the touch on, nothing else on this page answers.
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => { setSent(null); }, [s.day]);
  return (
    <Page>
      <Hint>하나를 고르면 그것이 내일의 규칙이 되어 큰 화면에서 다음 날이 시작됩니다. 나머지 조건은 그대로입니다.</Hint>
      <Grid $cols={Math.max(1, Math.min(3, s.choices.length))}>
        {s.choices.map((c, i) => (
          <Pick key={c.id ?? c.label} $on={sent === c.id} disabled={c.id === null || sent !== null}
            onClick={() => { if (c.id) { setSent(c.id); press({ name: 'choose', id: c.id }); } }}>
            <small>{i + 1} · {c.kind}</small>
            <b>{c.label}</b>
            {c.goal && <span>{c.goal}</span>}
            {c.from.length > 0 && <em>{c.from.slice(0, 3).join(' · ')}의 경험에서</em>}
            {c.rule && <div><s>{c.rule.before}</s><strong>→ {c.rule.after}</strong></div>}
            {c.id === null && <span>이 기록에서는 돌리지 않은 안</span>}
          </Pick>
        ))}
      </Grid>
    </Page>
  );
}

// ---- the end ------------------------------------------------------------------

export function Ending({ s, press }: { s: StageState; press: Press }) {
  return (
    <Stage>
      <h1>{s.closing ? '체험이 끝났습니다' : '사흘이 끝났습니다'}</h1>
      <p>{s.closing ? '다음 분을 위해 처음 화면으로 돌아갑니다.' : '고른 것과 마을이 어떻게 됐는지를 큰 화면에서 봐 주세요.'}</p>
      {s.closing
        ? <Button $tone="primary" $big onClick={() => press({ name: 'home' })}>처음으로</Button>
        : <Next $big onClick={() => press({ name: 'closing' })}>마무리 보기 →</Next>}
    </Stage>
  );
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
