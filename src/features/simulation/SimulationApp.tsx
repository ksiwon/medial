import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import ComparePanel from './components/ComparePanel';
import FieldSheet from './components/FieldSheet';
import FindingPanel from './components/FindingPanel';
import GenerationPanel from './components/GenerationPanel';
import PolicyEditor from './components/PolicyEditor';
import ProgressBar from './components/ProgressBar';
import CompareScreen from './screens/CompareScreen';
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
// The six research steps of doc 12 have not gone anywhere - the loop still runs
// cycle, review, synthesis, proposal, evaluation, selection in that order on the
// server, and ProgressBar shows where it is. What changed is that they are no
// longer six things to click. Reviews live at the bottom of the observe screen
// when the day ends; improvement, generations and the field decision live in the
// comparison; the manual A/B method and design findings stay available as a
// secondary flow, because doc 12 wants the two methods comparable.

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
  height: 56px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  border-bottom: 1px solid ${colour.border};
  background: ${colour.surface};
`;

const Brand = styled.div`
  font-size: ${font.brand};
  font-weight: 700;
  letter-spacing: -0.3px;
`;

const Nav = styled.nav`
  display: flex;
  gap: 4px;
`;

const NavItem = styled.button<{ $active: boolean }>`
  font-family: inherit;
  font-size: ${font.body};
  border: none;
  background: ${(p) => (p.$active ? colour.selected : 'transparent')};
  color: ${(p) => (p.$active ? colour.primary : colour.secondary)};
  font-weight: ${(p) => (p.$active ? 600 : 400)};
  border-radius: ${radius.control};
  padding: 7px 14px;
  cursor: pointer;
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
  { key: 'prepare', label: '실험 준비' },
  { key: 'observe', label: '마을 관찰' },
  { key: 'compare', label: '결과 비교' },
];

/** The transport deck's policies are the ``policy-T-*`` family; everything else
 *  belongs to the check-in deck. Revisions inherit their parent's prefix. */
function policyFitsDeck(policyId: string, deckId: string): boolean {
  const transport = policyId.startsWith('policy-T-');
  return deckId.includes('transport') ? transport : !transport;
}

function resourceFor(deckId: string, sets: { id: string }[]): string {
  const match = sets.find((r) =>
    deckId.includes('transport') ? r.id.includes('transport') : !r.id.includes('transport'),
  );
  return match ? match.id : (sets[0]?.id ?? '');
}

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

  useEffect(() => {
    if (it.compareView === 'manual') void s.refreshComparison();
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
  const canObserve = loaded != null;
  const canCompare = (it.detail?.generations.length ?? 0) > 0;

  return (
    <Root>
      <Header>
        <Brand>MEDial</Brand>
        <Nav>
          {NAV.map((item) => (
            <NavItem
              key={item.key}
              $active={screen === item.key}
              aria-current={screen === item.key ? 'page' : undefined}
              disabled={
                (item.key === 'observe' && !canObserve) || (item.key === 'compare' && !canCompare)
              }
              title={
                item.key === 'observe' && !canObserve
                  ? '먼저 실험을 시작하세요'
                  : item.key === 'compare' && !canCompare
                    ? '비교할 버전이 아직 없습니다'
                    : undefined
              }
              onClick={() => it.setScreen(item.key)}
            >
              {item.label}
            </NavItem>
          ))}
        </Nav>
        <span style={{ flex: 1 }} />
        {it.detail && (
          <Sub as="span" style={{ whiteSpace: 'nowrap' }}>
            {it.detail.session.label}
          </Sub>
        )}
        <Tag $kind={s.catalog.personas.dataSource === 'synthetic' ? 'warn' : 'unknown'}>
          페르소나 {s.catalog.personas.dataSource === 'synthetic' ? '합성' : '원자료'} ·{' '}
          {s.catalog.personas.personaCount}명
        </Tag>
      </Header>

      {/* The loop's own progress, on every screen where a loop exists. Its
          controls are the run's; the map's playback bar is the recording's. */}
      {it.detail && screen !== 'prepare' && (
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

      {screen === 'prepare' &&
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
            />
          </Secondary>
        ) : (
          <Notices>
            <Callout>반복 기능 정보를 불러오는 중입니다.</Callout>
          </Notices>
        ))}

      {screen === 'observe' &&
        (loaded ? (
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
            onStep={() => void s.step()}
            onStepBack={() => void s.stepBack()}
            onRestart={() => void s.restart()}
            onOpenScene={(attemptId, eventId) => void it.openScene(attemptId, eventId)}
          />
        ) : (
          <Notices>
            <Callout>
              <div>
                아직 관찰할 하루가 없습니다.{' '}
                <TextLink onClick={() => it.setScreen('prepare')}>실험 준비</TextLink>에서 실험을
                시작하세요.
              </div>
            </Callout>
          </Notices>
        ))}

      {screen === 'compare' && it.detail && (
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
              onSelectProposal={(id, reason) => void it.selectProposal(id, reason)}
              onOpenFieldSheet={() => it.setFieldSheet(true)}
              onOpenAllAttempts={() => it.setCompareView('all_generations')}
              decisionReason={decisionReason}
              onDecisionReason={setDecisionReason}
            />
          )}

          {/* Every version's table, and the manual A/B method, as the secondary
              flow they are. Both are still fully runnable research methods; they
              are simply not the default screen. */}
          {it.compareView !== 'summary' && (
            <Secondary>
              <SecondaryInner>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <TextLink onClick={() => it.setCompareView('summary')}>← 결과 비교로</TextLink>
                  <span style={{ flex: 1 }} />
                  <Select
                    aria-label="추가 도구"
                    style={{ maxWidth: 260 }}
                    value={it.compareView}
                    onChange={(e) => it.setCompareView(e.target.value as 'all_generations' | 'manual')}
                  >
                    <option value="all_generations">전체 시도 보기 (모든 버전 표)</option>
                    <option value="manual">직접 비교 방식 (수동 A/B · 발견 기록)</option>
                  </Select>
                </div>

                {it.compareView === 'all_generations' &&
                  (it.comparison ? (
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
                  ))}

                {it.compareView === 'manual' && (
                  <>
                    <Callout>
                      <div>
                        <strong>직접 비교 방식</strong>
                        <div style={{ marginTop: 4 }}>
                          반복 루프와는 다른 연구 방법입니다. 시도를 손으로 골라 비교하고 발견을
                          기록합니다. 두 방법을 방법론으로서 비교할 수 있도록 그대로 남겨 두었습니다.
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
                      <Select
                        aria-label="다른 시나리오·정책 실행"
                        style={{ minHeight: 32, fontSize: font.small, maxWidth: 260 }}
                        value=""
                        disabled={s.busy}
                        onChange={(e) => {
                          const choice = e.target.value;
                          if (!choice) return;
                          const [policyId, deckId, resourceId] = choice.split('|');
                          void s.runPolicy(policyId, deckId, resourceId);
                          e.target.value = '';
                        }}
                      >
                        <option value="">+ 다른 시나리오·정책 실행…</option>
                        {s.catalog.decks.map((deck) => (
                          <optgroup key={deck.id} label={deck.label}>
                            {s.catalog!.policies
                              .filter((p) => policyFitsDeck(p.id, deck.id))
                              .map((p) => (
                                <option
                                  key={p.id}
                                  value={`${p.id}|${deck.id}|${resourceFor(deck.id, s.catalog!.resourceSets)}`}
                                >
                                  {p.label}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </Select>
                    </div>

                    {s.comparison ? (
                      <ComparePanel comparison={s.comparison} />
                    ) : (
                      <Callout>비교하려면 위에서 시도를 두 개 이상 고르세요.</Callout>
                    )}

                    {loaded && (
                      <FindingPanel
                        findings={s.findings}
                        compareIds={s.compareIds}
                        coreItem={loaded.detail.policy.coreItem}
                        busy={s.busy}
                        onCreate={(body) => void s.createFinding(body)}
                        onApply={s.beginApplyFinding}
                      />
                    )}
                  </>
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
          onOpenScene={(attemptId, eventId) => void it.openScene(attemptId, eventId)}
        />
      )}

      {s.editorOpen && loaded && (
        <PolicyEditor
          detail={loaded.detail}
          catalog={s.catalog}
          cursorSeq={s.cursorSeq}
          cursorClockMs={s.atMs}
          busy={s.busy}
          onRerun={(edit) =>
            s.pendingFinding
              ? void s.applyFinding('rerun', undefined, edit)
              : void s.rerun(loaded.detail.attempt.id, edit)
          }
          onFork={(atSeq, edit) =>
            s.pendingFinding
              ? void s.applyFinding('fork', atSeq, edit)
              : void s.forkAt(loaded.detail.attempt.id, atSeq, edit)
          }
          onClose={() => s.setEditorOpen(false)}
        />
      )}
    </Root>
  );
}
