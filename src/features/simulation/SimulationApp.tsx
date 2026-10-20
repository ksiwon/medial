import { useEffect } from 'react';
import styled from 'styled-components';
import IdleScreen from './screens/IdleScreen';
import IntroScreen from './screens/IntroScreen';
import PairScreen from './screens/PairScreen';
import { runAuto, useWall } from './stage/wall';
import { useAssets } from './assets';
import { useAmbient } from './ui/ambient';
import { preloadArt } from './ui/Portrait';
import { Callout, Mono } from './ui/primitives';
import { font, night, px, radius, space, type } from './ui/theme';
import { useUiScale } from './ui/uiScale';
import { lineMs } from './scene/voice';
import { autoOf, useCountdown } from './week/auto';
import ClosingScreen from './week/ClosingScreen';
import { judgmentAt } from './week/judgment';
import JudgmentPanel from './week/JudgmentPanel';
import Logo from './ui/Logo';
import { ChooseScreen, EvaluationsScreen, GeneratingScreen } from './week/ReviewScreens';
import SceneView from './week/SceneView';
import { eventOf, positionIn, versionOf } from './week/selectors';
import VillageMap from './week/VillageMap';
import { useWeekStore } from './week/store';
import WeekScreen from './week/WeekScreen';

// The wall: the big screen of the exhibition's two screens. It shows the walk and nothing on it can be
// touched; the tablet (stage/PadApp) presses, and stage/wall.ts does what was pressed and says what is on
// screen. The walk is one path through a week (week/):
//
//   소개 영상    - what Dially is and who the visitor is;
//   이번 주      - seven days, an event on some of them; the visitor picks one;
//   사건 장면    - the event as it ran, a line at a time;
//   주민 평가    - the residents in it, in their words, with the lines each rests on;
//   수정 요청    - what the designer may change, with the resident words behind each (none for an emergency);
//   반영된 결과  - the same event with the request in force, and what the residents made of it, beside what they
//                 said before;
//   마무리       - what was changed this visit, the closing words, and the start again.
//
// A scene is three columns: the village map (where it happens), the scene, and the AI's judgment panel (what the AI
// knows and the rules it runs under). Every page that waits has a clock (week/auto.ts) shown in its corner, so the
// wall goes on - and comes back to the start - when nobody is at the tablet.
//
// Every scene and evaluation was written and checked before the exhibition (server/app/simulation/week.py):
// choosing a request opens what it already says, it starts nothing. The earlier three-day walk (a tree of
// versions run day after day) lives on the `audience-tablet-split` branch.

const Root = styled.div`
  position: relative;
  /* 100% rather than 100vw: with a scrollbar present 100vw is wider than the
     content box, which is its own horizontal overflow. */
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: ${night.ground};
  color: ${night.ink};
  font-family: ${font.family};
  font-size: ${font.body};
  overflow: hidden;
  /* Nothing here is pressed: the wall has no pointer, and a stray touch or click on it does nothing. */
  cursor: none;
  user-select: none;
`;

/** Every screen of the walk says what its people are. A simulated resident's
 *  words are not a real resident's opinion, and this boundary must not leave
 *  with a header: one line at the foot of every screen but the opening film,
 *  which says the same in its own corner. */
const Foot = styled.footer`
  flex: none;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: ${space.lg};
  padding: ${space.md} ${space.xl};
  font-size: ${font.small};
  > span { opacity: 0.6; text-align: center; }
  > :first-child { justify-self: start; }
  > :last-child { justify-self: end; }
`;

/** A telling: the map, the scene and the AI's panel side by side. */
const Telling = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
`;

/** The page's clock, at the right of the foot line: "조작이 없으면 N초 뒤 …". Said so a visitor knows the wall will go on
 *  without them; in the foot it never lies over what the page says. */
const Clock = styled.span`
  font-size: ${type.body};
  font-weight: 700;
  color: ${night.accent};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const Notices = styled.div`
  flex: none;
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  padding: ${space.md} ${space.lg} 0;
`;

/** How long a line of a telling stays before the next one (the exhibition's pace). */
const LINE_MS = 4500;
/** How long the wall says a new simulation is being made. */
const GENERATING_MS = 4000;

export default function SimulationApp() {
  useUiScale();
  useAmbient();
  const { paired } = useWall();
  const s = useAssets();
  const w = useWeekStore();

  useEffect(() => {
    void s.load();
    void w.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every drawing, fetched while the film plays: the first scene and the evaluation faces are already here.
  useEffect(() => { preloadArt(s.art); }, [s.art]);

  const week = w.week;
  const event = week ? eventOf(week, w.eventId) : null;
  const generating = w.generating;
  const telling = w.step === 'telling' && !generating;
  // The version of the event being read: how it first ran, or the one a chosen request made.
  const version = versionOf(event, w.paths[w.eventId ?? ''] ?? []);
  const scenes = version?.scenes ?? [];
  const at = positionIn(scenes, w.lineIndex);

  // The wall has no pointer, so a telling goes on by itself: a line for a few seconds - or as long as its
  // recording, when that is longer - then the next. The tablet's presses move the same line, and restart this clock.
  const flat = scenes.flatMap((sc) => sc.lines);
  const onLine = flat[Math.min(w.lineIndex, Math.max(flat.length - 1, 0))];
  const lineFor = onLine ? lineMs(s.voices, onLine.speaker, onLine.text, LINE_MS) : LINE_MS;
  useEffect(() => {
    if (!w.pathStarted || !telling || at.done) return undefined;
    const timer = window.setTimeout(() => w.setLine(w.lineIndex + 1), lineFor);
    return () => window.clearTimeout(timer);
  }, [w.pathStarted, telling, at.done, w.lineIndex, w.eventId, w.step, lineFor]); // eslint-disable-line react-hooks/exhaustive-deps

  // A confirmed request is "made" for a few seconds before it is told: the record was written ahead, this is only the wait.
  useEffect(() => {
    if (!generating) return undefined;
    const timer = window.setTimeout(w.endGenerating, GENERATING_MS);
    return () => window.clearTimeout(timer);
  }, [generating, w.endGenerating]);

  // Every page that waits counts down (week/auto.ts); a press on the tablet starts it over.
  const auto = autoOf({
    pathStarted: w.pathStarted, step: w.step, eventId: w.eventId, toldAll: telling && at.done,
    leaf: version ? version.requests.length === 0 : false, seen: w.read.length, closingWords: w.closingWords, lastPress: w.lastPress,
  });
  const left = useCountdown(auto, runAuto);

  if (s.status === 'error') {
    return (
      <Root>
        <Notices>
          <Callout $tone="error">
            <div>
              <strong>시뮬레이션 서버에 연결하지 못했습니다.</strong>
              <div style={{ marginTop: 8 }}>{s.error}</div>
              <div style={{ marginTop: 8 }}>
                <Mono>python server/sim_main.py --mode sim</Mono> 를 실행한 뒤 새로고침하세요. API 키는 필요 없습니다.
              </div>
            </div>
          </Callout>
        </Notices>
      </Root>
    );
  }

  if (!w.loaded || s.status === 'idle' || s.status === 'loading') {
    return <Root><Notices><Callout>불러오는 중…</Callout></Notices></Root>;
  }

  if (!week) {
    return (
      <Root>
        <Notices>
          <Callout $tone="error">
            <div>
              <strong>읽을 한 주의 기록이 없습니다.</strong>
              <div style={{ marginTop: 8 }}>{w.error ?? '서버가 fixtures/week 를 읽지 못했습니다.'}</div>
            </div>
          </Callout>
        </Notices>
      </Root>
    );
  }

  const scene = scenes[at.scene];
  const before = scenes.slice(0, at.scene).reduce((n, sc) => n + sc.lines.length, 0);
  const made = version?.chain[version.chain.length - 1] ?? null;
  const showWeek = w.pathStarted && w.step === 'week';
  return (
    <Root>
      {(s.error || w.error) && <Notices><Callout $tone="error"><div style={{ flex: 1 }}>{s.error ?? w.error}</div></Callout></Notices>}

      {!paired && !w.pathStarted && !w.introStarted && <PairScreen />}
      {(paired || w.pathStarted || w.introStarted) && !w.pathStarted && !w.introStarted && <IdleScreen art={s.art} />}
      {!w.pathStarted && w.introStarted && <IntroScreen voices={s.voices} onFinish={w.enterWeek} />}

      {showWeek && <WeekScreen week={week} art={s.art} now={null} paths={w.paths} read={w.read} />}
      {w.pathStarted && telling && scene && event && version && (
        <Telling>
          <VillageMap village={s.village} frames={scene.frames} people={week.people} art={s.art} />
          <SceneView week={week} scene={scene} line={w.lineIndex - before} art={s.art}
            seconds={(LINE_MS / 1000) * scene.lines.length} position={{ at: at.scene + 1, of: scenes.length }} voices={s.voices} />
          <JudgmentPanel week={week} version={version.number}
            judgment={judgmentAt(event, version.chain, scenes, at.scene, w.lineIndex - before)} />
        </Telling>
      )}
      {w.pathStarted && event && generating && <GeneratingScreen event={event} request={made} version={version?.number ?? 2} />}
      {w.pathStarted && event && version && !generating && w.step === 'evaluations' && (
        <EvaluationsScreen week={week} event={event} version={version} art={s.art} />
      )}
      {w.pathStarted && event && version && !generating && w.step === 'choose' && (
        <ChooseScreen week={week} event={event} version={version} art={s.art} considering={w.considering} />
      )}
      {w.pathStarted && w.step === 'closing' && (
        <ClosingScreen week={week} paths={w.paths} read={w.read} words={w.closingWords} art={s.art} voices={s.voices} />
      )}

      {w.pathStarted && (
        <Foot>
          <Logo height="clamp(16px, 1.2vw, 44px)" />
          <span>화면 속 사람과 대화는 전부 시뮬레이션입니다 · 이름은 가명, 모습은 지어낸 그림입니다</span>
          {auto && left !== null && left > 0 ? <Clock aria-live="off">조작이 없으면 {left}초 뒤 {auto.say}</Clock> : <i />}
        </Foot>
      )}
    </Root>
  );
}
