import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBus, postTo, type PressResult } from './bus';
import { Ask, Button, Notice, Screen, TopBar } from './pad/kit';
import { Choose, Closing, Draft, Evaluations, Join, Scan, Telling, Waiting, Watching, Week, type Press } from './pad/screens';
import {
  IDLE_STATE, STAGE_API, forgetPadToken, hasJoined, padToken, rememberJoined, type Command, type Link, type Phase, type StageState,
} from './protocol';
import { useStream } from './stream';

// The tablet: the one thing a visitor touches. It holds no copy of the walk: it draws what the wall last
// said (stage/wall.ts) and sends presses (stage/bus.ts), and a press is never assumed to have worked -
// the wall's next report is what changes the screen. Everything it can say about its own connection it says.

const HOME_ASK_MS = 20000; // the window closes by itself if nobody answers
/** How long a "the wall did not hear that" stays on screen. */
const NOTICE_MS = 4000;

export default function PadApp() {
  const [token] = useState(() => padToken());
  // The first thing a scan shows is one button: pressing it is the tablet saying it is here, and only then
  // does the wall leave its code. A tablet that already said so for this code goes straight in.
  const [joined, setJoined] = useState(() => hasJoined(token));
  const [state, setState] = useState<StageState>(IDLE_STATE);
  const [wall, setWall] = useState(false);
  const [released, setReleased] = useState(false);
  const [notice, setNotice] = useState<'no-wall' | 'failed' | null>(null);
  const [refused, setRefused] = useState(token === null);

  const link: Link = useStream({
    query: `role=pad&token=${encodeURIComponent(token ?? '')}`,
    enabled: joined && token !== null && !refused && !released,
    on: {
      state: (data) => setState(data as StageState),
      presence: (data) => setWall(((data as { wall?: number } | null)?.wall ?? 0) > 0),
      released: () => setReleased(true),
      ping: () => {},
    },
    // A stream that fails is either a bad connection or a refused code; this says which.
    refusal: async () => (await fetch(`${STAGE_API}/check?token=${encodeURIComponent(token ?? '')}`)).status === 403,
  });

  useEffect(() => { if (link === 'refused') { forgetPadToken(); setRefused(true); } }, [link]);

  // Presses go through one bus: in order, a seek replaced by a newer one, and the answer to each is read.
  const noticeTimer = useRef<number | undefined>(undefined);
  const onResult = useCallback((_c: Command, result: PressResult) => {
    if (result.kind === 'refused') { forgetPadToken(); setRefused(true); return; }
    if (result.kind === 'ok') { setNotice(null); return; }
    setNotice(result.kind === 'no-wall' ? 'no-wall' : 'failed');
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  const bus = useMemo(() => createBus(postTo(token), onResult), [token, onResult]);
  const press: Press = useCallback((command) => bus.send(command), [bus]);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // The page itself must not move under a finger: no pinch, no double-tap zoom.
  useEffect(() => {
    const stop = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, []);

  // 처음으로 asks first, in a window over the page: one stray touch must not throw away someone's path.
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return undefined;
    const timer = window.setTimeout(() => setAsking(false), HOME_ASK_MS);
    return () => window.clearTimeout(timer);
  }, [asking]);

  if (refused) return <Screen><Scan why="no-code" /></Screen>;
  if (released) return <Screen><Scan why="released" /></Screen>;
  if (!joined) {
    return <Screen><Join onJoin={() => { if (token) rememberJoined(token); setJoined(true); }} /></Screen>;
  }

  // The closing has its own way back in the middle of the page: the corner one would be the same press twice.
  const home = state.phase === 'idle' || state.phase === 'closing' ? null : (
    <Button $tone="quiet" onClick={() => setAsking(true)}>↺ 처음으로</Button>
  );

  // The rules as they stand open on the wall, from any page of the walk but the draft (which is the rules) and the closing.
  const withRules: Phase[] = ['week', 'telling', 'evaluations', 'choose'];
  const rules = withRules.includes(state.phase) && !state.generating ? (
    <Button $tone={state.rulesOpen ? 'primary' : 'quiet'} onClick={() => press({ name: 'rules' })}>{state.rulesOpen ? '규칙 닫기' : '현재 규칙'}</Button>
  ) : null;

  return (
    <Screen>
      <TopBar place={state.event ? `${state.event.day ?? ''} · ${state.event.title}` : null} home={home} rules={rules} />
      {link === 'lost' && <Notice>큰 화면과의 연결이 끊겼습니다. 다시 연결하는 중입니다…</Notice>}
      {link === 'live' && !wall && <Notice>큰 화면이 아직 연결되지 않았습니다.</Notice>}
      {notice === 'no-wall' && <Notice>큰 화면이 그것을 받지 못했습니다. 잠시 뒤 다시 눌러 주세요.</Notice>}
      {notice === 'failed' && <Notice>방금 누른 것이 전달되지 않았습니다. 다시 눌러 주세요.</Notice>}
      <PadStage s={state} press={press} />
      {asking && home && (
        <Ask role="dialog" aria-label="처음으로 돌아갈까요">
          <section>
            <h2>처음으로 돌아갈까요?</h2>
            <p>지금까지 고친 내용이 사라지고, 소개 화면부터 다시 시작합니다.</p>
            <div>
              <Button $tone="quiet" onClick={() => setAsking(false)}>계속 보기</Button>
              <Button $tone="primary" onClick={() => { setAsking(false); press({ name: 'home' }); }}>처음으로</Button>
            </div>
          </section>
        </Ask>
      )}
    </Screen>
  );
}

function PadStage({ s, press }: { s: StageState; press: Press }) {
  switch (s.phase) {
    case 'idle': return <Waiting s={s} press={press} />;
    case 'intro': return <Watching s={s} press={press} />;
    case 'draft': return <Draft press={press} />;
    case 'week': return <Week s={s} press={press} />;
    case 'telling': return <Telling s={s} press={press} />;
    case 'evaluations': return <Evaluations s={s} press={press} />;
    case 'choose': return <Choose s={s} press={press} />;
    case 'closing': return <Closing s={s} press={press} />;
  }
}
