import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { formatClock } from '../positions';
import { accentA, font, inkA, night, radius } from '../ui/theme';
import { IDLE_STATE, STAGE_API, sendCommand, type Command, type StageState } from './protocol';

// The tablet: the one thing a visitor touches. iPad Air (4th generation), held
// landscape: 1180 x 820 CSS px. It shows where the walk is, in a line, and the few
// things to press on this screen; everything else - the village, the scene, the
// evaluations - is on the wall, and looking up is the point.
//
// It holds no copy of the walk: it draws what the wall last said (stage/wall.ts) and
// sends presses. A press is never assumed to have worked; the wall's next report is
// what changes the screen.
//
// Fixed size of everything pressable: at least 56 px a side, 12 px between, no hover,
// no gesture but a tap and the one slider. The page does not scroll or zoom.

const TOUCH = 56;

const Root = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: max(20px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
  background: ${night.ground};
  color: ${night.ink};
  font-family: ${font.family};
  font-size: 20px;
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
`;

const Top = styled.header`
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: ${TOUCH}px;
  > b { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
  > em { font-style: normal; font-size: 20px; font-weight: 800; color: ${night.accent}; }
  > span { flex: 1; min-width: 0; font-size: 20px; color: ${night.mute}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  > i { font-style: normal; font-size: 16px; color: ${night.faint}; }
`;

const Body = styled.main`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Row = styled.div`
  display: flex;
  gap: 12px;
  align-items: stretch;
  flex-wrap: wrap;
`;

const Btn = styled.button<{ $primary?: boolean; $quiet?: boolean }>`
  appearance: none;
  min-height: ${TOUCH}px;
  min-width: ${TOUCH}px;
  padding: 0 28px;
  border-radius: ${radius.pill};
  border: 1px solid ${(p) => (p.$primary ? night.accent : inkA(0.3))};
  background: ${(p) => (p.$primary ? night.accent : p.$quiet ? 'transparent' : inkA(0.1))};
  color: ${(p) => (p.$primary ? '#fff' : night.ink)};
  font: inherit;
  font-size: 20px;
  font-weight: 800;
  &:active:not(:disabled) { transform: scale(0.97); filter: brightness(1.15); }
  &:disabled { opacity: 0.35; }
`;

const Big = styled(Btn)`
  min-height: 120px;
  padding: 0 56px;
  font-size: 36px;
`;

const Hero = styled.div`
  flex: 1;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 28px;
  text-align: center;
  > strong { font-size: 44px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.2; }
  > p { margin: 0; max-width: 760px; font-size: 24px; line-height: 1.6; color: ${night.mute}; word-break: keep-all; }
`;

const Card = styled.button<{ $on?: boolean }>`
  appearance: none;
  text-align: left;
  font: inherit;
  color: ${night.ink};
  min-height: ${TOUCH}px;
  padding: 16px 20px;
  border-radius: ${radius.card};
  border: 1px solid ${(p) => (p.$on ? night.accent : night.line)};
  background: ${(p) => (p.$on ? night.accentSoft : night.panel)};
  display: flex;
  flex-direction: column;
  gap: 8px;
  &:active:not(:disabled) { transform: scale(0.985); }
  &:disabled { opacity: 0.4; }
  > b { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
  > span { font-size: 16px; line-height: 1.45; color: ${night.mute}; word-break: keep-all;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
`;

const Grid = styled.div<{ $cols: number }>`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(${(p) => p.$cols}, minmax(0, 1fr));
  gap: 12px;
  align-content: start;
`;

const Choice = styled(Card)`
  min-height: 0;
  padding: 24px;
  gap: 12px;
  > small { font-size: 16px; font-weight: 800; letter-spacing: 0.06em; color: ${night.accent}; }
  > b { font-size: 28px; line-height: 1.3; }
  > span { -webkit-line-clamp: 4; }
  > div { margin-top: auto; padding-top: 12px; border-top: 1px solid ${night.line}; font-size: 16px; line-height: 1.5; color: ${night.mute}; word-break: keep-all; }
  > div > s { color: ${night.faint}; display: block; }
  > div > strong { color: ${night.ink}; display: block; }
`;

const Slider = styled.input`
  flex: 1;
  min-width: 0;
  height: ${TOUCH}px;
  accent-color: ${night.accent};
  touch-action: pan-y;
`;

const Clock = styled.time`
  flex: none;
  min-width: 112px;
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

const Bar = styled.div<{ $p: number }>`
  flex: none;
  height: 4px;
  border-radius: ${radius.xs};
  background: ${inkA(0.12)};
  > i { display: block; height: 100%; width: ${(p) => p.$p * 100}%; border-radius: ${radius.xs}; background: ${night.accent}; transition: width 0.4s linear; }
`;

const Lost = styled.div`
  flex: none;
  padding: 12px 20px;
  border-radius: ${radius.card};
  background: ${accentA(0.2)};
  border: 1px solid ${night.accent};
  font-size: 20px;
  font-weight: 700;
`;

const Note = styled.p`
  margin: 0;
  font-size: 16px;
  line-height: 1.5;
  color: ${night.faint};
`;

type Link = 'connecting' | 'live' | 'lost';

/** What the wall says it shows, over the stream; a dropped stream is said on screen and retried by the browser. */
function useWallState(): { state: StageState; link: Link; wall: boolean } {
  const [state, setState] = useState<StageState>(IDLE_STATE);
  const [link, setLink] = useState<Link>('connecting');
  const [wall, setWall] = useState(false);
  useEffect(() => {
    const source = new EventSource(`${STAGE_API}/events?role=pad`);
    source.onopen = () => setLink('live');
    source.onerror = () => setLink('lost');
    source.addEventListener('state', (m) => setState(JSON.parse((m as MessageEvent<string>).data) as StageState));
    source.addEventListener('presence', (m) => setWall(((JSON.parse((m as MessageEvent<string>).data) as { wall: number }).wall ?? 0) > 0));
    return () => source.close();
  }, []);
  return { state, link, wall };
}

const HOME_ASK_MS = 3000;

export default function PadApp() {
  const { state, link, wall } = useWallState();
  const [failed, setFailed] = useState(false);
  const press = useCallback((command: Command) => {
    sendCommand(command).then(() => setFailed(false), () => setFailed(true));
  }, []);

  // A phone-sized page that scrolls under a finger would move the controls; the page is one screen.
  useEffect(() => {
    const stop = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, []);

  // 처음으로 asks twice: one stray touch must not throw away someone's path.
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return undefined;
    const timer = window.setTimeout(() => setAsking(false), HOME_ASK_MS);
    return () => window.clearTimeout(timer);
  }, [asking]);
  const home = state.phase === 'idle' ? null : (
    <Btn $quiet onClick={() => { if (asking) { setAsking(false); press({ name: 'home' }); } else setAsking(true); }}>
      {asking ? '한 번 더 누르면 처음으로' : '↺ 처음으로'}
    </Btn>
  );

  return (
    <Root>
      <Top>
        <b>MEDial</b>
        {state.day && <em>{state.day}</em>}
        <span>{headline(state)}</span>
        {home}
      </Top>
      {link !== 'live' && <Lost>태블릿이 서버와 끊겼습니다. 다시 연결하는 중입니다…</Lost>}
      {link === 'live' && !wall && <Lost>큰 화면이 아직 연결되지 않았습니다. 큰 화면의 주소를 확인해 주세요.</Lost>}
      {failed && <Lost>방금 누른 것이 큰 화면에 전달되지 않았습니다. 다시 눌러 주세요.</Lost>}
      <Body>
        <Pad state={state} press={press} />
      </Body>
    </Root>
  );
}

function headline(s: StageState): string {
  switch (s.phase) {
    case 'idle': return '대기 중';
    case 'intro': return '소개 영상을 보는 중';
    case 'day': return s.scene ? `지금 · ${s.scene}` : s.dayOver ? '하루가 끝났습니다' : '마을의 하루';
    case 'evaluations': return s.openActor ? '주민의 인터뷰를 읽는 중' : '주민 에이전트 평가';
    case 'choose': return '무엇을 고칠 것인가';
    case 'ending': return s.closing ? '마무리' : '사흘이 끝났습니다';
  }
}

function Pad({ state: s, press }: { state: StageState; press: (c: Command) => void }) {
  switch (s.phase) {
    case 'idle':
      return (
        <Hero>
          <strong>서비스 디자이너가 되어 보세요</strong>
          <p>마을의 하루를 보고, 주민 에이전트의 평가를 읽고, 고칠 것을 하나 골라 다음 날을 다시 봅니다.</p>
          <Big $primary onClick={() => press({ name: 'start' })}>시작하기</Big>
        </Hero>
      );
    case 'intro':
      return (
        <Hero>
          <strong>큰 화면을 봐 주세요</strong>
          <p>소개 영상이 끝나면 첫날이 열립니다.</p>
          <Btn $quiet onClick={() => press({ name: 'skipIntro' })}>건너뛰기 →</Btn>
        </Hero>
      );
    case 'day':
      return <Day s={s} press={press} />;
    case 'evaluations':
      return <Evaluations s={s} press={press} />;
    case 'choose':
      return <Choose s={s} press={press} />;
    case 'ending':
      return (
        <Hero>
          <strong>{s.closing ? '체험이 끝났습니다' : '사흘이 끝났습니다'}</strong>
          <p>{s.closing ? '다음 분을 위해 처음 화면으로 돌아갑니다.' : '고른 것과 마을이 어떻게 됐는지를 큰 화면에서 봐 주세요.'}</p>
          {s.closing
            ? <Big $primary onClick={() => press({ name: 'home' })}>처음으로</Big>
            : <Big $primary onClick={() => press({ name: 'closing' })}>마무리 보기 →</Big>}
        </Hero>
      );
  }
}

function Day({ s, press }: { s: StageState; press: (c: Command) => void }) {
  // The slider follows the wall while it plays and the finger while it is held; a release settles it.
  const [held, setHeld] = useState<number | null>(null);
  const shown = held ?? s.atMs;
  const sent = useRef(0);
  const move = (ms: number) => {
    setHeld(ms);
    const now = performance.now();
    if (now - sent.current > 90) { sent.current = now; press({ name: 'seek', value: ms }); }
  };
  const release = (ms: number) => { press({ name: 'seek', value: ms }); press({ name: 'commit' }); setHeld(null); };
  return (
    <>
      <Bar $p={s.progress}><i /></Bar>
      <Row style={{ alignItems: 'center' }}>
        <Btn $primary onClick={() => press({ name: 'togglePlay' })} disabled={s.dayOver} style={{ minWidth: 168 }}>
          {s.playing ? '⏸ 정지' : '▶ 재생'}
        </Btn>
        <Btn onClick={() => press({ name: 'skipScene' })} disabled={s.dayOver}>다음 장면으로 →</Btn>
        <Clock>{formatClock(shown)}</Clock>
        <Slider type="range" aria-label="시각" min={s.dayStartMs} max={s.dayEndMs || s.dayStartMs + 1} step={60_000}
          value={Math.min(Math.max(shown, s.dayStartMs), s.dayEndMs || s.dayStartMs + 1)}
          onChange={(e) => move(Number(e.target.value))}
          onPointerUp={(e) => release(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => release(Number((e.target as HTMLInputElement).value))} />
      </Row>
      <Grid $cols={2}>
        {s.tasks.map((t) => (
          <Card key={`${t.startMs}${t.title}`} $on={s.atMs >= t.startMs} onClick={() => { press({ name: 'seek', value: t.startMs }); press({ name: 'commit' }); }}>
            <b>{t.title}</b>
            <span>{formatClock(t.startMs)}</span>
          </Card>
        ))}
      </Grid>
      {s.dayOver && (
        <Row><Btn $primary onClick={() => press({ name: 'readEvaluations' })}>주민 에이전트 평가 보기 →</Btn></Row>
      )}
      {!s.dayOver && (
        <Row><Btn $quiet onClick={() => press({ name: 'readEvaluations' })}>하루를 건너뛰고 평가 보기 →</Btn></Row>
      )}
    </>
  );
}

function Evaluations({ s, press }: { s: StageState; press: (c: Command) => void }) {
  const open = s.openActor ? s.residents.find((r) => r.id === s.openActor) ?? null : null;
  if (open || s.issues) {
    return (
      <>
        <Row style={{ alignItems: 'center' }}>
          <Btn $primary onClick={() => press({ name: 'evalClose' })}>← 목록으로 돌아가기</Btn>
          <strong style={{ fontSize: 28 }}>{open ? `${open.name}의 인터뷰` : '쟁점 묶음'}</strong>
        </Row>
        {open && s.went.length > 0 && (
          <>
            <Note>겪은 일을 누르면 큰 화면이 그 장면으로 갑니다.</Note>
            <Grid $cols={2}>
              {s.went.map((w) => (
                <Card key={w.id} onClick={() => press({ name: 'openScene', id: w.id })}>
                  <b>{w.title}</b><span>{w.time} · 장면 보기</span>
                </Card>
              ))}
            </Grid>
          </>
        )}
        <Note>큰 화면에서 인터뷰를 읽어 주세요. 한동안 누르지 않으면 목록으로 돌아갑니다.</Note>
      </>
    );
  }
  const first = s.page * 5;
  const shown = s.residents.slice(first, first + 5);
  return (
    <>
      <Note>누르면 큰 화면에 그 주민의 인터뷰가 펼쳐집니다. 평가를 남긴 주민 {s.residents.length}명</Note>
      <Grid $cols={1}>
        {shown.map((r) => (
          <Card key={r.id} onClick={() => press({ name: 'evalOpen', id: r.id })}>
            <b>{r.name}</b>
            <span>{r.said}</span>
          </Card>
        ))}
      </Grid>
      <Row style={{ alignItems: 'center' }}>
        <Btn onClick={() => press({ name: 'evalPage', value: -1 })} disabled={s.page <= 0}>← 앞 주민</Btn>
        <Btn onClick={() => press({ name: 'evalPage', value: 1 })} disabled={s.page >= s.pages - 1}>다음 주민 →</Btn>
        <span style={{ color: night.mute, fontSize: 20 }}>{s.page + 1} / {Math.max(s.pages, 1)}</span>
        {s.hasIssues && <Btn onClick={() => press({ name: 'evalIssues' })}>쟁점 묶음 보기</Btn>}
        <Btn $primary style={{ marginLeft: 'auto' }} onClick={() => press({ name: 'goImprove' })}>
          {s.hasChoice ? '무엇을 고칠지 고른다 →' : '결과 보러 가기 →'}
        </Btn>
      </Row>
    </>
  );
}

function Choose({ s, press }: { s: StageState; press: (c: Command) => void }) {
  // One touch chooses: the pick is the next day's rule. A moment of the same touch cannot undo it,
  // so the card is the button and nothing else on this page is.
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => { setSent(null); }, [s.day]);
  return (
    <>
      <Note>하나를 고르면 그것이 내일의 규칙이 되어 큰 화면에서 다음 날이 시작됩니다. 나머지 조건은 그대로입니다.</Note>
      <Grid $cols={Math.max(1, Math.min(3, s.choices.length))}>
        {s.choices.map((c, i) => (
          <Choice key={c.id ?? c.label} $on={sent === c.id} disabled={c.id === null || sent !== null}
            onClick={() => { if (c.id) { setSent(c.id); press({ name: 'choose', id: c.id }); } }}>
            <small>{i + 1} · {c.kind}</small>
            <b>{c.label}</b>
            {c.goal && <span>{c.goal}</span>}
            {c.rule && <div><s>{c.rule.before}</s><strong>→ {c.rule.after}</strong></div>}
            {c.id === null && <span>이 기록에서는 돌리지 않은 안</span>}
          </Choice>
        ))}
      </Grid>
    </>
  );
}
