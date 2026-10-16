import { useEffect, useMemo, useRef } from 'react';
import styled from 'styled-components';
import ChoiceScreen from './screens/ChoiceScreen';
import EvaluationsScreen from './screens/EvaluationsScreen';
import IdleScreen from './screens/IdleScreen';
import PairScreen from './screens/PairScreen';
import IntroScreen from './screens/IntroScreen';
import ObserveScreen from './screens/ObserveScreen';
import { useIterationStore } from './iterationStore';
import { usePlayback } from './scene/playback';
import { changedRuleNames, chosenRequests, dayFacts, dayLine, dayName, openingOf } from './selectors/tree';
import { useWall } from './stage/wall';
import { useSimStore } from './store';
import { useAmbient } from './ui/ambient';
import { preloadArt } from './ui/Portrait';
import { Callout, Mono } from './ui/primitives';
import { font, night } from './ui/theme';
import { useUiScale } from './ui/uiScale';

// The wall: the big screen of the exhibition's two screens. It shows the walk and
// nothing on it can be touched; the tablet (stage/PadApp) presses, and stage/wall.ts
// does what was pressed and says what is on screen. The walk is:
//
//   소개 영상          - why this exists, and who the visitor is; it starts when the
//                        tablet says start and ends by opening day one;
//   관찰               - the day, as a scene, a map and a timeline;
//   주민 에이전트 평가 - the residents who went through the day, in their words;
//   수정 요청 고르기      - the revision that becomes the next day's rule.
//
// Every day shown was run when the record was made (selectors/tree): choosing a
// revision opens that day, it starts nothing. The old second flow - preparing a
// run, comparing versions, the field sheet - was removed on 2026-10-10 with the
// rest of the interface that created runs; one path is left to read. The one-screen
// version of this exhibition is on the `single-screen` branch.

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

export default function SimulationApp() {
  useUiScale();
  useAmbient();
  const { paired } = useWall();
  const s = useSimStore();
  const it = useIterationStore();
  const playing = usePlayback((state) => state.playing);
  const playbackError = usePlayback((state) => state.error);
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);

  useEffect(() => {
    void s.bootstrap();
    void it.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // requestAnimationFrame moves the playhead of a stored recording; it never
  // advances the simulation itself.
  useEffect(() => {
    if (!playing) {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      return;
    }
    last.current = performance.now();
    const loop = (now: number) => {
      const delta = now - last.current;
      last.current = now;
      usePlayback.getState().tick(delta);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing]);

  const loaded = s.activeId ? s.attempts[s.activeId] : null;

  // The opening film is waiting time: day one's record is read during it.
  const prefetch = s.prefetch;
  useEffect(() => {
    if (!it.detail || it.pathStarted) return;
    const first = openingOf(it.detail)?.attemptIds[0];
    if (first) void prefetch(first);
  }, [it.detail, it.pathStarted, prefetch]);

  // The version being read is the version of the day that is loaded: a scene
  // opened from an evaluation loads another day, and the screens follow it.
  const setViewGeneration = it.setViewGeneration;
  useEffect(() => {
    const owner = it.detail?.generations.find((g) => s.activeId && g.attemptIds.includes(s.activeId));
    if (owner && owner.id !== it.viewGenerationId) setViewGeneration(owner.id);
  }, [s.activeId, it.detail, it.viewGenerationId, setViewGeneration]);

  // Every drawing, fetched while the film plays: the first scene of a day and the
  // evaluation faces are then already here.
  useEffect(() => { preloadArt(s.art); }, [s.art]);

  const viewGeneration = useMemo(
    () => it.detail?.generations.find((g) => g.id === it.viewGenerationId) ?? null,
    [it.detail, it.viewGenerationId],
  );

  if (s.status === 'error') {
    return (
      <Root>
        <Notices>
          <Callout $tone="error">
            <div>
              <strong>시뮬레이션 서버에 연결하지 못했습니다.</strong>
              <div style={{ marginTop: 8 }}>{s.error}</div>
              <div style={{ marginTop: 8 }}>
                <Mono>python server/sim_main.py --mode sim</Mono> 를 실행한 뒤 새로고침하세요. API 키는 필요
                없습니다.
              </div>
            </div>
          </Callout>
        </Notices>
      </Root>
    );
  }

  if (!s.village || !it.loaded) {
    return (
      <Root>
        <Notices>
          <Callout>불러오는 중…</Callout>
        </Notices>
      </Root>
    );
  }

  if (!it.detail) {
    return (
      <Root>
        <Notices>
          <Callout>
            <div>
              <strong>읽을 기록이 없습니다.</strong>
              <div style={{ marginTop: 8 }}>
                서버가 읽는 기록(<Mono>local-data/runs/sim.sqlite3</Mono>)이 비어 있습니다. 기록을 채운 뒤 다시 여세요.
              </div>
            </div>
          </Callout>
        </Notices>
      </Root>
    );
  }

  const detail = it.detail;
  const current = it.pathStarted ? viewGeneration : null;
  const screen = it.screen;
  return (
    <Root>
      {(playbackError || s.error || it.error) && (
        <Notices>
          <Callout $tone="error">
            <div style={{ flex: 1 }}>{playbackError ?? s.error ?? it.error}</div>
          </Callout>
        </Notices>
      )}

      {/* No tablet yet: the code to scan. Once one is paired the walk is whatever it was (a tablet that
          drops out in the middle of a visit does not throw the visitor back; it comes back by itself). */}
      {!paired && !current && !it.introStarted && <PairScreen />}
      {(paired || current || it.introStarted) && !current && !it.introStarted && <IdleScreen art={s.art} />}

      {!current && it.introStarted && (
        <IntroScreen voices={s.voices}
          onFinish={() => { const first = openingOf(detail); if (first) void it.choose(first.id); }} />
      )}

      {current && screen === 'case' && loaded && (
        <ObserveScreen
          village={s.village}
          detail={loaded.detail}
          events={loaded.events}
          art={s.art}
          dayEnd={{ text: `${dayName(current)}가 끝났습니다`, action: '주민 에이전트 평가를 보시겠습니까',
                    note: dayFacts(current) ? dayLine(dayFacts(current)!) : null }}
          onReadEvaluations={() => it.setScreen('evaluations')}
          strip={{ day: dayName(current), chosen: chosenRequests(detail, current.id) }}
          changedRules={changedRuleNames(detail, current.id)}
        />
      )}

      {current && screen === 'evaluations' && (
        <EvaluationsScreen
          detail={detail}
          generation={current}
          residents={s.village.residents.map((r) => r.id)}
          eyebrow={`${dayName(current)}가 끝났습니다`}
          page={it.page}
          openActor={it.openActor}
          issues={it.issues}
          onPage={it.setPage}
          onGoToImprove={() => it.setScreen('improve')}
          onCloseOpen={() => { it.setOpenActor(null); it.setIssues(false); }}
          events={loaded ? { attemptId: loaded.detail.attempt.id, list: loaded.events } : null}
          art={s.art}
        />
      )}

      {current && screen === 'improve' && (
        <ChoiceScreen detail={detail} current={current} art={s.art} voices={s.voices}
          closing={it.closing} onClosing={() => it.setClosing(true)} onRestart={it.restartPath} />
      )}
      {current && (
        <Foot>
          <span>화면 속 사람과 대화는 전부 시뮬레이션입니다 · 이름은 가명, 모습은 지어낸 그림입니다</span>
        </Foot>
      )}
    </Root>
  );
}
