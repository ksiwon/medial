import { useEffect, useMemo, useRef } from 'react';
import styled from 'styled-components';
import ChoiceScreen from './screens/ChoiceScreen';
import EvaluationsScreen from './screens/EvaluationsScreen';
import IntroScreen from './screens/IntroScreen';
import ObserveScreen from './screens/ObserveScreen';
import { useIterationStore } from './iterationStore';
import { usePlayback } from './scene/playback';
import { dayFacts, dayLine, dayName, openingOf } from './selectors/tree';
import { useSimStore } from './store';
import HomeButton from './ui/HomeButton';
import { preloadPortraits } from './ui/Portrait';
import { Callout, Mono } from './ui/primitives';
import { font, night } from './ui/theme';
import { useUiScale } from './ui/uiScale';

// The walk, and the shell that holds it:
//
//   소개 영상          - why this exists, and who the visitor is; it ends by
//                        opening day one;
//   관찰               - the day, as a scene, a map and a timeline;
//   주민 평가          - the residents who went through the day, in their words;
//   수정안 고르기      - the revision that becomes the next day's rule.
//
// Every day shown was run when the record was made (selectors/tree): choosing a
// revision opens that day, it starts nothing. The old second flow - preparing a
// run, comparing versions, the field sheet - was removed on 2026-10-10 with the
// rest of the interface that created runs; one path is left to read.

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
  gap: 16px;
  padding: 0 16px 8px;
  font-size: ${font.small};
  > span { grid-column: 2; opacity: 0.6; text-align: center; }
  > button { grid-column: 3; justify-self: end; }
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

  // The faces the evaluation cards will show, fetched while the day plays.
  useEffect(() => {
    if (s.village && s.art.size > 0) preloadPortraits(s.village.residents.map((r) => r.id), s.art);
  }, [s.art, s.village]);

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
                전시 기록을 가져오려면 <Mono>python scripts/import_exhibition.py --replace</Mono> 를 실행한 뒤
                다시 여세요.
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

      {!current && (
        <IntroScreen
          onFinish={() => { const first = openingOf(detail); if (first) void it.choose(first.id); }} />
      )}

      {current && screen === 'case' && loaded && (
        <ObserveScreen
          village={s.village}
          detail={loaded.detail}
          events={loaded.events}
          art={s.art}
          dayEnd={{ text: `${dayName(current)}가 끝났습니다`, action: '주민 평가를 보시겠습니까',
                    note: dayFacts(current) ? dayLine(dayFacts(current)!) : null }}
          onReadEvaluations={() => it.setScreen('evaluations')}
          strip={{ day: dayName(current) }}
        />
      )}

      {current && screen === 'evaluations' && (
        <EvaluationsScreen
          detail={detail}
          generation={current}
          residents={s.village.residents.map((r) => r.id)}
          eyebrow={`${dayName(current)}가 끝났습니다`}
          onOpenScene={(attemptId, eventId) => void it.openScene(attemptId, eventId)}
          onGoToImprove={() => it.setScreen('improve')}
          events={loaded ? { attemptId: loaded.detail.attempt.id, list: loaded.events } : null}
          art={s.art}
        />
      )}

      {current && screen === 'improve' && (
        <ChoiceScreen detail={detail} current={current} art={s.art} onChoose={(id) => void it.choose(id)}
          onRestart={it.restartPath} />
      )}
      {current && (
        <Foot>
          <span>화면 속 사람과 대화는 전부 시뮬레이션입니다 · 이름은 가명, 모습은 지어낸 그림입니다</span>
          {/* The ending has its own way back (and goes by itself); every other screen of the walk has this one. */}
          {!(screen === 'improve' && current.changeSets.length === 0) && <HomeButton onHome={it.restartPath} />}
        </Foot>
      )}
    </Root>
  );
}
