import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import ComparePanel from './components/ComparePanel';
import FieldSheet from './components/FieldSheet';
import GenerationPanel from './components/GenerationPanel';
import ProgressBar from './components/ProgressBar';
import CompareScreen from './screens/CompareScreen';
import EvaluationsScreen from './screens/EvaluationsScreen';
import ObserveScreen from './screens/ObserveScreen';
import PrepareScreen from './screens/PrepareScreen';
import { useIterationStore, type Screen } from './iterationStore';
import { medialKnowledge, posesAt } from './positions';
import { eventsUpTo, useSimStore } from './store';
import {
  Button,
  Callout,
  Disclosure,
  Mono,
  Select,
  Sub,
  Tag,
  TextLink,
} from './ui/primitives';
import { colour, font, radius } from './ui/theme';

// Three screens, and the shell that holds them.
//
//   사례와 서비스 경험 - the village, the conditions this comparison fixes, the
//                        run, and the scenes an evaluation cites;
//   주민 평가          - where the loop lands when a day ends (doc 19 section 9);
//   개선과 확인        - the change, its confirmation, the before/after, and the
//                        field record.
//
// The six research steps of doc 12 still run in that order on the server and
// ProgressBar says where the loop is; they are not six things to click.
//
// Removed on 2026-09-15 (26번 F10): the manual A/B flow, the standalone policy
// editor and "apply this finding", because each was a *second* way to create a
// revision and an attempt. One new-execution path now exists - confirm a Change
// Set - and the research condition RQ2 compares is a read-only difference in
// what the same run offers, not the presence of an old feature. Stored findings
// and every past attempt remain readable under 고급.

const Root = styled.div`
  position: relative;
  /* 100% rather than 100vw: with a scrollbar present 100vw is wider than the
     content box, which is its own horizontal overflow. */
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: ${colour.app};
  color: ${colour.text};
  font-family: ${font.family};
  font-size: ${font.body};
  overflow: hidden;
`;

const Header = styled.header`
  min-height: 56px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 20px;
  border-bottom: 1px solid ${colour.border};
  background: ${colour.surface};

  /* Narrow, the three screen names and the badges were competing for one row
     and the nav was clipped under the wordmark (seen at 800px in a browser).
     The header takes a second row instead, and the badges - which are context,
     not navigation - drop off first. */
  @media (max-width: 900px) {
    flex-wrap: wrap;
    row-gap: 8px;
  }
`;

const Brand = styled.div`
  font-size: ${font.brand};
  font-weight: 700;
  letter-spacing: -0.3px;
`;

/* The three screens are one cycle, and the nav says so: numbered, joined by
   arrows, and closed by a return arrow from the third back to the first. Three
   unmarked words in a row read as tabs, and a reader could not tell they were
   steps of a loop (the user, 2026-09-15). */
const Nav = styled.nav`
  display: flex;
  align-items: center;
  gap: 2px;

  @media (max-width: 900px) {
    order: 3;
    width: 100%;
  }
`;

const Arrow = styled.span`
  color: ${colour.unknown};
  font-size: ${font.small};
  padding: 0 4px;
  user-select: none;
`;

/** The loop closing: after 개선과 확인 the confirmed change becomes the next
 *  case. Drawn as the arrow going back, never as a fourth step. */
const Return = styled.span`
  color: ${colour.unknown};
  font-size: ${font.small};
  padding: 0 4px 0 2px;
  white-space: nowrap;
  user-select: none;
`;

const NavItem = styled.button<{ $active: boolean }>`
  font-family: inherit;
  white-space: nowrap;
  font-size: ${font.body};
  border: none;
  background: ${(p) => (p.$active ? colour.selected : 'transparent')};
  color: ${(p) => (p.$active ? colour.primary : colour.secondary)};
  font-weight: ${(p) => (p.$active ? 600 : 400)};
  border-radius: ${radius.control};
  padding: 6px 12px 6px 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  &:hover:not(:disabled) {
    color: ${colour.primary};
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 1px;
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const StepNo = styled.span<{ $active: boolean }>`
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: ${(p) => (p.$active ? colour.primary : 'transparent')};
  color: ${(p) => (p.$active ? colour.surface : colour.secondary)};
  border: 1px solid ${(p) => (p.$active ? colour.primary : colour.border)};
`;

const Notices = styled.div`
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 20px 0;
`;

const Secondary = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 20px 40px;
`;

const SecondaryInner = styled.div`
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const NAV: { key: Screen; label: string }[] = [
  { key: 'case', label: '사례와 서비스 경험' },
  { key: 'evaluations', label: '주민 평가' },
  { key: 'improve', label: '개선과 확인' },
];

export default function SimulationApp() {
  const s = useSimStore();
  const it = useIterationStore();
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);
  const [decisionReason, setDecisionReason] = useState('');

  useEffect(() => {
    void s.bootstrap();
    void it.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The audit comparison of two stored attempts is a read; it is refreshed only
  // while that advanced view is open.
  useEffect(() => {
    if (it.compareView === 'all_generations' && s.compareIds.length >= 2) {
      void s.refreshComparison();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.compareView, s.compareIds.join(',')]);

  // The poll is the loop's own; stop it when the screen goes away rather than
  // leaving a timer talking to a session nobody is watching.
  useEffect(() => () => useIterationStore.getState().stopPolling(), []);

  // requestAnimationFrame only interpolates position between events; it never
  // advances the simulation itself.
  useEffect(() => {
    if (!s.playing) {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      return;
    }
    last.current = performance.now();
    const loop = (now: number) => {
      const delta = now - last.current;
      last.current = now;
      useSimStore.getState().tick(delta);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [s.playing]);

  const loaded = s.activeId ? s.attempts[s.activeId] : null;
  const poses = useMemo(
    () => posesAt(loaded?.detail.timeline ?? null, s.atMs),
    [loaded?.detail.timeline, s.atMs],
  );
  const medialKnown = useMemo(
    () => (loaded ? medialKnowledge(loaded.events, s.cursorSeq) : new Map()),
    [loaded, s.cursorSeq],
  );
  const visible = useMemo(
    () => (loaded ? eventsUpTo(loaded.events, s.cursorSeq, s.viewMode) : []),
    [loaded, s.cursorSeq, s.viewMode],
  );
  const reservations = useMemo(() => {
    const rows = loaded?.detail.timeline?.reservations?.reservations ?? [];
    return rows.filter((r) => r.departMs <= s.atMs && r.status !== 'cancelled');
  }, [loaded, s.atMs]);

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
              <div style={{ marginTop: 6 }}>{s.error}</div>
              <div style={{ marginTop: 8 }}>
                <Mono>python server/sim_main.py</Mono> 를 실행한 뒤 새로고침하세요. API 키는 필요
                없습니다.
              </div>
            </div>
          </Callout>
        </Notices>
      </Root>
    );
  }

  // The empty state is the prepare screen, so the village registry and the
  // capabilities are all that has to be loaded before anything is usable.
  // Rendering no longer waits for an attempt to exist.
  if (!s.village || !s.catalog) {
    return (
      <Root>
        <Notices>
          <Callout>불러오는 중…</Callout>
        </Notices>
      </Root>
    );
  }

  const screen = it.screen;
  const hasRun = loaded != null;
  const hasEvaluations = (it.detail?.generations ?? []).some((g) => g.reviews.length > 0);
  // The case screen is either setting a run up or reading the one that ran.
  // Unpinned, it follows the workspace: a stored run opens as the run.
  const caseView =
    it.caseView === 'auto' ? (hasRun ? 'experience' : 'setup')
      : it.caseView === 'experience' && hasRun ? 'experience'
        : 'setup';

  return (
    <Root>
      <Header>
        <Brand>MEDial</Brand>
        <Nav aria-label="연구 순환">
          {NAV.map((item, index) => (
            <span key={item.key} style={{ display: 'contents' }}>
              {index > 0 && <Arrow aria-hidden>→</Arrow>}
              <NavItem
                $active={screen === item.key}
                aria-current={screen === item.key ? 'page' : undefined}
                disabled={
                  (item.key === 'evaluations' && !hasEvaluations) ||
                  (item.key === 'improve' && !it.detail)
                }
                title={
                  item.key === 'evaluations' && !hasEvaluations
                    ? '아직 이 사례의 주민 평가가 없습니다'
                    : item.key === 'improve' && !it.detail
                      ? '먼저 사례를 하나 실행하세요'
                      : undefined
                }
                onClick={() => it.setScreen(item.key)}
              >
                <StepNo $active={screen === item.key} aria-hidden>
                  {index + 1}
                </StepNo>
                {item.label}
              </NavItem>
            </span>
          ))}
          <Return title="확인된 개선안이 다음 사례가 됩니다. 3 → 1로 돌아가 다시 한 바퀴.">
            ↺ 다시 1로
          </Return>
        </Nav>
        <span style={{ flex: 1 }} />
        {it.detail && (
          <Sub as="span" style={{ whiteSpace: 'nowrap', overflow: 'hidden',
                                  textOverflow: 'ellipsis', maxWidth: 360 }}>
            {it.detail.session.label}
          </Sub>
        )}
        {/* Who the residents are. Source-derived personas are the real people of
            the village the study was done in; the synthetic fixture says so
            instead, and never borrows that name. */}
        <Tag $kind={s.catalog.personas.dataSource === 'synthetic' ? 'warn' : 'unknown'}>
          {s.catalog.personas.dataSource === 'synthetic'
            ? `합성 페르소나 · ${s.catalog.personas.personaCount}명`
            : `실제 남해군 은점마을 주민 ${s.catalog.personas.personaCount}명`}
        </Tag>
      </Header>

      {/* The loop's own progress, on every screen where a loop exists. Its
          controls are the run's; the map's playback bar is the recording's. */}
      {it.detail && !(screen === 'case' && caseView === 'setup') && (
        <ProgressBar
          detail={it.detail}
          viewGenerationId={it.viewGenerationId}
          busy={it.busy}
          onSelectGeneration={(id) => {
            it.setViewGeneration(id);
            const generation = it.detail?.generations.find((g) => g.id === id);
            // Reading an earlier version switches what the map shows and
            // nothing else: the loop keeps running where it was.
            if (generation?.attemptIds[0]) void s.setActive(generation.attemptIds[0]);
          }}
          onCommand={(name) => void it.send(name)}
        />
      )}

      {(s.error || s.notice || it.error || it.notice) && (
        <Notices>
          {s.error && (
            <Callout $tone="error">
              <div style={{ flex: 1 }}>{s.error}</div>
            </Callout>
          )}
          {s.notice && (
            <Callout>
              <div style={{ flex: 1 }}>{s.notice}</div>
              <Button onClick={s.dismissNotice}>닫기</Button>
            </Callout>
          )}
          {it.error && (
            <Callout $tone="error">
              <div style={{ flex: 1 }}>{it.error}</div>
              <Button onClick={it.dismiss}>닫기</Button>
            </Callout>
          )}
          {it.notice && (
            <Callout>
              <div style={{ flex: 1 }}>{it.notice}</div>
              <Button onClick={it.dismiss}>닫기</Button>
            </Callout>
          )}
        </Notices>
      )}

      {screen === 'case' && caseView === 'setup' &&
        (it.capabilities ? (
          <Secondary>
            <PrepareScreen
              catalog={s.catalog}
              capabilities={it.capabilities}
              startPolicyId="policy-IT-v0"
              phase={it.startPhase}
              busy={it.busy}
              onStart={(body) => void it.startExperiment(body)}
              onRetryStart={() => void it.retryStart()}
              canReturn={hasRun}
              onReturn={() => it.setCaseView('experience')}
            />
          </Secondary>
        ) : (
          <Notices>
            <Callout>사례 정보를 불러오는 중입니다.</Callout>
          </Notices>
        ))}

      {screen === 'case' && caseView === 'experience' && loaded && (
        <ObserveScreen
          village={s.village}
          detail={loaded.detail}
          poses={poses}
          visibleEvents={visible}
          allEvents={loaded.events}
          medialKnown={medialKnown}
          reservations={reservations}
          viewMode={s.viewMode}
          cursorSeq={s.cursorSeq}
          eventCount={loaded.detail.attempt.eventCount}
          atMs={s.atMs}
          playing={s.playing}
          speed={s.speed}
          selectedCluster={s.selectedCluster}
          selectedActor={s.selectedActor}
          detailActor={s.detailActor}
          personas={s.personas}
          generation={viewGeneration}
          onSetViewMode={s.setViewMode}
          onSelectCluster={s.selectCluster}
          onOpenDetail={s.setDetailActor}
          onPlay={() => void s.play()}
          onPause={() => void s.pause()}
          onSeek={(seq) => void s.seekToSeq(seq)}
          onScrub={s.scrubTo}
          onScrubEnd={() => void s.commitScrub()}
          onSetSpeed={s.setSpeed}
          onStep={() => void s.step()}
          onStepBack={() => void s.stepBack()}
          onRestart={() => void s.restart()}
          onOpenScene={(attemptId, eventId) => void it.openScene(attemptId, eventId)}
          onNewCase={() => it.setCaseView('setup')}
          onReadEvaluations={() => it.setScreen('evaluations')}
        />
      )}

      {screen === 'evaluations' && it.detail && (
        <EvaluationsScreen
          detail={it.detail}
          generation={viewGeneration ?? it.detail.generations[0] ?? null}
          personas={s.personas}
          onSelectGeneration={(id) => {
            it.setViewGeneration(id);
            const generation = it.detail?.generations.find((g) => g.id === id);
            if (generation?.attemptIds[0]) void s.setActive(generation.attemptIds[0]);
          }}
          onOpenScene={(attemptId, eventId) => void it.openScene(attemptId, eventId)}
          onGoToImprove={() => it.setScreen('improve')}
        />
      )}

      {screen === 'improve' && it.detail && (
        <>
          {it.compareView === 'summary' && (
            <CompareScreen
              detail={it.detail}
              comparison={it.comparison}
              leftId={it.compareLeftId}
              rightId={it.compareRightId}
              busy={it.busy}
              onSetSides={it.setCompareSides}
              onOpenScene={(attemptId, eventId) => void it.openScene(attemptId, eventId)}
              onConfirmChangeSet={(id, reason) => void it.confirmChangeSet(id, reason)}
              onSaveResearcherChangeSet={(body) => it.saveResearcherChangeSet(body)}
              onDeclineChanges={(reason) => void it.declineChanges(reason)}
              onOpenFieldSheet={() => it.setFieldSheet(true)}
              onOpenAllAttempts={() => it.setCompareView('all_generations')}
              onReadEvaluations={() => it.setScreen('evaluations')}
            />
          )}

          {/* Advanced, read-only: every version's row and the attempt-level
              audit comparison. Nothing here starts a run. */}
          {it.compareView !== 'summary' && (
            <Secondary>
              <SecondaryInner>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <TextLink onClick={() => it.setCompareView('summary')}>← 개선과 확인으로</TextLink>
                  <span style={{ flex: 1 }} />
                  <Sub as="span">고급 · 읽기 전용</Sub>
                </div>

                {it.comparison ? (
                  <GenerationPanel
                    comparison={it.comparison}
                    viewGenerationId={it.viewGenerationId}
                    onSelect={(id) => {
                      it.setViewGeneration(id);
                      const generation = it.detail?.generations.find((g) => g.id === id);
                      if (generation?.attemptIds[0]) void s.setActive(generation.attemptIds[0]);
                    }}
                  />
                ) : (
                  <Callout>아직 비교할 버전이 없습니다.</Callout>
                )}

                <Callout>
                  <div>
                    <strong>시도 단위 감사 조회</strong>
                    <div style={{ marginTop: 4 }}>
                      저장된 시도 두 개를 골라 입력·정책·결과 차이를 읽습니다. 여기서는 아무것도
                      실행되지 않습니다.
                    </div>
                  </div>
                </Callout>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {s.catalog.attempts.slice(-12).map((attempt) => (
                    <Button
                      key={attempt.id}
                      $pressed={s.compareIds.includes(attempt.id)}
                      style={{ minHeight: 32, fontSize: font.small }}
                      onClick={() => s.toggleCompare(attempt.id)}
                    >
                      {attempt.label || attempt.id}
                    </Button>
                  ))}
                </div>
                {s.comparison ? (
                  <ComparePanel comparison={s.comparison} />
                ) : (
                  <Callout>비교하려면 위에서 시도를 두 개 이상 고르세요.</Callout>
                )}

                {s.findings.length > 0 && (
                  <Disclosure>
                    <summary>기록된 발견 {s.findings.length}건 (읽기 전용 이력)</summary>
                    <div>
                      {s.findings.map((finding) => (
                        <Sub key={finding.id}>
                          <Mono>{finding.id}</Mono> — {finding.observation} → {finding.nextChange}
                        </Sub>
                      ))}
                    </div>
                  </Disclosure>
                )}

                {loaded && (
                  <Disclosure>
                    <summary>기술 정보 · 현재 열려 있는 시도</summary>
                    <div>
                      <Sub>
                        시도 <Mono>{loaded.detail.attempt.id}</Mono> · seed{' '}
                        {loaded.detail.attempt.seed} · 엔진{' '}
                        <Mono>{loaded.detail.attempt.engineVersion}</Mono>
                      </Sub>
                      {Object.entries(loaded.detail.attempt.inputHashes).map(([key, value]) => (
                        <Sub key={key}>
                          {key} <Mono>{value}</Mono>
                        </Sub>
                      ))}
                    </div>
                  </Disclosure>
                )}
              </SecondaryInner>
            </Secondary>
          )}
        </>
      )}

      {it.fieldSheetOpen && it.detail && (
        <FieldSheet
          detail={it.detail}
          suggestedGenerationId={it.compareRightId}
          busy={it.busy}
          onClose={() => it.setFieldSheet(false)}
          onDecide={(body) => void it.decide(body)}
          onSubmitHuman={(body) => void it.submitHumanReview(body)}
          onRecordDisclosure={(body) => void it.recordDisclosure(body)}
          onOpenScene={(attemptId, eventId) => void it.openScene(attemptId, eventId)}
        />
      )}

    </Root>
  );
}
