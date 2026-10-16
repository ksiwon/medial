import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { formatClock } from '../../positions';
import { inkA, night, radius } from '../../ui/theme';
import { PER_PAGE, type Command, type StageState } from '../protocol';
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
  grid-template-columns: 1fr 2fr;
  gap: 16px;
  > button { min-height: 120px; font-size: 32px; }
`;

/** The day plays by itself. The only things a visitor does in it are to go on to the next scene, or to
 *  get past the line being said; everything else (play, pause, the clock, a list of the day) was taken
 *  away because a visitor who is watching the wall does not need to steer it. */
export function Day({ s, press }: { s: StageState; press: Press }) {
  return (
    <Page>
      <Track $p={s.progress} aria-hidden><i /></Track>
      <Now aria-live="off">
        <small>{s.dayOver ? '하루가 끝났습니다' : s.scene ? '지금 이 장면' : '마을의 하루'}</small>
        <strong>{s.dayOver ? `${s.day ?? ''}가 지나갔어요` : s.scene ?? '마을 지도를 보고 있어요'}</strong>
        <time>{formatClock(s.atMs)}</time>
      </Now>
      {s.dayOver ? (
        <Row><Spacer /><Next $big onClick={() => press({ name: 'readEvaluations' })}>주민 에이전트 평가 보기 →</Next><Spacer /></Row>
      ) : (
        <Pair>
          <Button $tone="quiet" onClick={() => press({ name: 'skipLine' })} disabled={!s.scene}>이 대화 건너뛰기</Button>
          <Button $tone="primary" onClick={() => press({ name: 'skipScene' })}>다음 장면으로 →</Button>
        </Pair>
      )}
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
  // Nothing to press until the end: the three days stay up for a while and the closing words follow by
  // themselves (ChoiceScreen RESULT_S); a visitor reads, and does not have to ask for the next page.
  return (
    <Stage>
      <h1>{s.closing ? '체험이 끝났습니다' : '사흘이 끝났습니다'}</h1>
      <p>{s.closing ? '다음 분을 위해 처음 화면으로 돌아갑니다.' : '고른 것과 마을이 어떻게 됐는지를 큰 화면에서 봐 주세요. 곧 마무리가 이어집니다.'}</p>
      {s.closing && <Button $tone="primary" $big onClick={() => press({ name: 'home' })}>처음으로</Button>}
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
