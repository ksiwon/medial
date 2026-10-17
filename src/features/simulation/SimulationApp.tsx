import { useEffect } from 'react';
import styled from 'styled-components';
import IdleScreen from './screens/IdleScreen';
import IntroScreen from './screens/IntroScreen';
import PairScreen from './screens/PairScreen';
import { evaluationsOf, scenesOf, useWall } from './stage/wall';
import { useAssets } from './assets';
import { useAmbient } from './ui/ambient';
import { preloadArt } from './ui/Portrait';
import { Callout, Mono } from './ui/primitives';
import { font, night } from './ui/theme';
import { useUiScale } from './ui/uiScale';
import { ChooseScreen, EvaluationsScreen, ResultScreen } from './week/ReviewScreens';
import SceneView from './week/SceneView';
import { eventOf, positionIn, requestOf } from './week/selectors';
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
//   반영된 결과  - the same event with the request in force, and what the residents made of it.
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
  display: flex;
  justify-content: center;
  padding: 0 16px 8px;
  font-size: ${font.small};
  > span { opacity: 0.6; text-align: center; }
`;

const Notices = styled.div`
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 20px 0;
`;

/** How long a line of a telling stays before the next one (the exhibition's pace). */
const LINE_MS = 4500;

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
  const telling = w.step === 'before' || w.step === 'after';
  const scenes = scenesOf(event, w.step, w.requestId);
  const at = positionIn(scenes, w.lineIndex);

  // The wall has no pointer, so a telling goes on by itself: a line for a few seconds, then the next. The
  // tablet's presses move the same line, and they restart this clock.
  useEffect(() => {
    if (!w.pathStarted || !telling || at.done) return undefined;
    const timer = window.setTimeout(() => w.setLine(w.lineIndex + 1), LINE_MS);
    return () => window.clearTimeout(timer);
  }, [w.pathStarted, telling, at.done, w.lineIndex, w.eventId, w.step]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const request = event ? requestOf(event, w.requestId) : null;
  const showWeek = w.pathStarted && w.step === 'week';
  return (
    <Root>
      {(s.error || w.error) && <Notices><Callout $tone="error"><div style={{ flex: 1 }}>{s.error ?? w.error}</div></Callout></Notices>}

      {!paired && !w.pathStarted && !w.introStarted && <PairScreen />}
      {(paired || w.pathStarted || w.introStarted) && !w.pathStarted && !w.introStarted && <IdleScreen art={s.art} />}
      {!w.pathStarted && w.introStarted && <IntroScreen voices={s.voices} onFinish={w.enterWeek} />}

      {showWeek && <WeekScreen week={week} art={s.art} now={null} seen={w.seen} />}
      {w.pathStarted && telling && scene && (
        <SceneView week={week} scene={scene} line={w.lineIndex - before} art={s.art}
          seconds={(LINE_MS / 1000) * scene.lines.length} position={{ at: at.scene + 1, of: scenes.length }} />
      )}
      {w.pathStarted && event && w.step === 'evaluations' && (
        <EvaluationsScreen week={week} event={event} evaluations={evaluationsOf(event, w.step, w.requestId)}
          scenes={event.before.scenes} art={s.art} openActor={w.openActor}
          eyebrow={`${event.title} · 주민 평가`} title="서비스를 겪은 주민의 말"
          lead="이 일에 있었던 주민이 자기가 겪은 것을 어떻게 읽었는지, 그리고 어느 대사를 근거로 삼았는지 보입니다." />
      )}
      {w.pathStarted && event && w.step === 'choose' && <ChooseScreen week={week} event={event} art={s.art} />}
      {w.pathStarted && event && w.step === 'result' && (
        <ResultScreen week={week} event={event} request={request} art={s.art} openActor={w.openActor} />
      )}

      {w.pathStarted && (
        <Foot>
          <span>화면 속 사람과 대화는 전부 시뮬레이션입니다 · 이름은 가명, 모습은 지어낸 그림입니다</span>
        </Foot>
      )}
    </Root>
  );
}
