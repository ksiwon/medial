import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import type { GenerationDetail } from '../api/iteration';
import type {
  AttemptDetail,
  DomainEvent,
  PersonasPayload,
  Reservation,
  VillagePayload,
  ViewMode,
} from '../api/types';
import HappeningPanel from '../components/HappeningPanel';
import OrchestratorPanel from '../components/OrchestratorPanel';
import PeopleBoard from '../components/PeopleBoard';
import PersonPanel from '../components/PersonPanel';
import VillageMap, { type MapHighlight } from '../components/VillageMap';
import { formatClock, type ActorPose, type MedialKnown } from '../positions';
import { requestFlows } from '../selectors/requests';
import { dayChangeLines, dayLabel } from '../selectors/words';
import { IconButton, Panel, PanelHead, PanelTitle, Select, Sub, Tag } from '../ui/primitives';
import { colour, font, radius } from '../ui/theme';

// Screen B, in three equal columns: the village, the orchestrator, the person.
//
// This departs from doc 15 section 5, which put the map on the left and split a
// fixed 400 px right-hand column between the request flow and the day's events.
// The user asked for 1 : 1 : 1 instead, so that "what is happening in the
// village", "what MEDial is doing about it" and "what it means for this person"
// each get a full column. Everything section 5 asked those panels to *contain*
// is unchanged; only the proportions moved.
//
// The columns, after seeing the first arrangement in a browser:
//
//   1  the map alone, filling its column top to bottom. Sharing the column with
//      the event log left a 456x300 map of a 1.15 km valley;
//   2  what happened and what MEDial did about it, stacked - they are the same
//      question read at two levels, and the orchestrator panel on its own left
//      most of a column empty whenever no request was in flight;
//   3  everyone, until a person is chosen; then that person.

const Layout = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  /* The areas must be named here too, not only in the media queries below. The
     children place themselves by name (grid-area: village), and with no areas
     declared at this width the name is read as a *line* name instead: three
     implicit tracks appear and all three panels land in the same cell, stacked
     on top of each other. That is what >=1280px did. */
  grid-template-areas: 'village orchestrator person';
  gap: 16px;
  padding: 16px 20px 20px;

  /* Two columns: village + orchestrator, with the person panel under the
     orchestrator rather than squeezed to nothing. */
  @media (max-width: 1279px) {
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    grid-template-areas:
      'village orchestrator'
      'village person';
  }
  /* One column, scrolling. Never a sideways scrollbar hiding half the screen. */
  @media (max-width: 899px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'village'
      'orchestrator'
      'person';
    overflow-y: auto;
  }
`;

const Village = styled.div`
  grid-area: village;
  display: flex;
  min-height: 0;
  min-width: 0;

  @media (max-width: 899px) {
    /* Stacked, the other two columns ask for a height that already exceeds the
       viewport. With min-height: 0 in force this row was handed 0px while the
       map kept drawing at full size, straight over the panel below it. */
    min-height: 420px;
  }
`;

/** What happened, and what MEDial did about it - one above the other. */
const Middle = styled.div`
  grid-area: orchestrator;
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1.45fr);
  gap: 16px;
  min-height: 0;
  min-width: 0;

  @media (max-width: 899px) {
    grid-template-rows: minmax(220px, auto) minmax(320px, auto);
    min-height: auto;
  }
`;

const MapPanel = styled(Panel)`
  flex: 1;
  min-width: 0;
  overflow: hidden;
`;

const RightCol = styled.div`
  grid-area: person;
  min-height: 0;
  min-width: 0;
  display: flex;

  @media (max-width: 899px) {
    min-height: 480px;
  }
`;

/** The playback row: a row of the map panel's layout, not an overlay on it. */
const Transport = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  min-height: 46px;
`;

const Clock = styled.span`
  font-variant-numeric: tabular-nums;
  font-size: ${font.body};
  font-weight: 600;
  min-width: 48px;
  color: ${colour.text};
`;

const Range = styled.input`
  flex: 1;
  min-width: 80px;
  accent-color: ${colour.primary};
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 2px;
  }
`;

const Extra = styled.details`
  position: relative;
  font-size: ${font.small};
  > summary {
    cursor: pointer;
    list-style: none;
    color: ${colour.primary};
    padding: 4px 2px;
  }
  > summary::-webkit-details-marker {
    display: none;
  }
  > div {
    position: absolute;
    right: 0;
    bottom: 28px;
    display: flex;
    gap: 4px;
    background: ${colour.surface};
    border: 1px solid ${colour.border};
    border-radius: ${radius.control};
    padding: 4px;
    box-shadow: 0 4px 14px rgba(29, 41, 53, 0.14);
    z-index: 4;
  }
`;

interface Props {
  village: VillagePayload;
  detail: AttemptDetail;
  poses: ActorPose[];
  visibleEvents: DomainEvent[];
  allEvents: DomainEvent[];
  medialKnown: Map<string, MedialKnown>;
  reservations: Reservation[];
  viewMode: ViewMode;
  cursorSeq: number;
  eventCount: number;
  atMs: number;
  playing: boolean;
  selectedCluster: string | null;
  selectedActor: string | null;
  detailActor: string | null;
  /** The whole compiled set: which person the third column shows is decided
   *  here, so the persona has to be resolved here too. */
  personas: PersonasPayload | null;
  generation: GenerationDetail | null;
  onSetViewMode: (mode: ViewMode) => void;
  onSelectCluster: (key: string | null, actorId?: string | null) => void;
  /** null closes the person and returns the third column to the board. */
  onOpenDetail: (actorId: string | null) => void;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seq: number) => void;
  onStep: () => void;
  onStepBack: () => void;
  onRestart: () => void;
  onOpenScene: (attemptId: string, eventId: string) => void;
}

export default function ObserveScreen({
  village,
  detail,
  poses,
  visibleEvents,
  allEvents,
  medialKnown,
  reservations,
  viewMode,
  cursorSeq,
  eventCount,
  atMs,
  playing,
  selectedCluster,
  selectedActor,
  detailActor,
  personas,
  generation,
  onSetViewMode,
  onSelectCluster,
  onOpenDetail,
  onPlay,
  onPause,
  onSeek,
  onStep,
  onStepBack,
  onRestart,
  onOpenScene,
}: Props) {
  const flows = useMemo(() => requestFlows(visibleEvents), [visibleEvents]);
  const [requestId, setRequestId] = useState<string | null>(null);

  // Follow the cursor: the request the newest visible event belongs to is the
  // one being read, unless the researcher picked another.
  const newest = visibleEvents[visibleEvents.length - 1];
  useEffect(() => {
    if (!newest || newest.correlationId === 'world') return;
    setRequestId((current) =>
      current && flows.some((f) => f.id === current) ? current : newest.correlationId,
    );
  }, [newest, flows]);

  const activeFlow = flows.find((f) => f.id === requestId) ?? flows[flows.length - 1] ?? null;

  // Only the people and the route of the request being read are drawn brightly.
  const highlight: MapHighlight | null = useMemo(() => {
    if (!activeFlow) return null;
    const actorIds = new Set(activeFlow.participants);
    const routes: [number, number][][] = [];
    const timeline = detail.timeline;
    if (timeline) {
      for (const actor of Object.values(timeline.actors)) {
        if (!actorIds.has(actor.id)) continue;
        for (const segment of actor.realized) {
          if (segment.requestId && segment.polyline?.length) routes.push(segment.polyline);
        }
      }
    }
    return { actorIds, routes };
  }, [activeFlow, detail.timeline]);

  // A quote is only ever an utterance the log already holds for that person at
  // or before the cursor. Nothing is written for the popover.
  const quoteFor = useMemo(() => {
    const byActor = new Map<string, string>();
    for (const event of visibleEvents) {
      const utterance = (event.payload as Record<string, unknown>).utterance;
      if (typeof utterance === 'string') byActor.set(event.actorId, utterance);
    }
    return (actorId: string) => byActor.get(actorId) ?? null;
  }, [visibleEvents]);

  const actorIds = useMemo(
    () =>
      Object.keys(detail.timeline?.actors ?? {}).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    [detail.timeline],
  );

  // The third column shows a person only when one was actually chosen. It used
  // to fall back to the request's subject and then to whoever sorted first,
  // which meant the column always claimed to be about someone - usually P1,
  // whom nobody had asked about.
  const shownActor = detailActor;
  const persona = shownActor
    ? (personas?.profiles.find((p) => p.subjectId === shownActor) ?? null)
    : null;

  return (
    <Layout>
      <Village>
        <MapPanel>
          <PanelHead style={{ justifyContent: 'space-between' }}>
            <PanelTitle>은점마을</PanelTitle>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Tag $kind={village.isSynthetic ? 'warn' : 'unknown'}>
                {village.isSynthetic ? '합성 지도' : '원자료 지형'}
              </Tag>
              {/* Which day this run happened on. The one line says whether the
                  routine was taken as recorded or nudged; the edits themselves
                  are in the tooltip, one per person, checkable against the
                  source. A run stored before days were drawn has no tag. */}
              {detail.metrics.dayRealization && (
                <Tag
                  $kind={
                    detail.metrics.dayRealization.classification === 'source_baseline'
                      ? 'unknown'
                      : 'warn'
                  }
                  title={
                    dayChangeLines(detail.metrics.dayRealization).join('\n') ||
                    '기록된 일과를 그대로 썼습니다.'
                  }
                >
                  {dayLabel(detail.metrics.dayRealization)}
                </Tag>
              )}
              <Select
                aria-label="관찰 시점"
                style={{ minHeight: 30, fontSize: font.small, padding: '3px 8px' }}
                value={viewMode}
                onChange={(e) => onSetViewMode(e.target.value as ViewMode)}
              >
                <option value="researcher">연구자 전체보기</option>
                <option value="medial">MEDial이 아는 것</option>
              </Select>
            </div>
          </PanelHead>

          <VillageMap
            village={village}
            poses={poses}
            viewMode={viewMode}
            medialKnown={medialKnown}
            reservations={reservations}
            seatsPerVehicle={
              detail.timeline?.reservations?.seatsPerVehicle ??
              detail.resources.assumedVehicleSeats ??
              0
            }
            highlight={highlight}
            selectedCluster={selectedCluster}
            selectedActor={selectedActor}
            quoteFor={quoteFor}
            onSelectCluster={onSelectCluster}
            onOpenDetail={onOpenDetail}
          />

          <Transport>
            {/* "기록 재생" and "연구 실행" are different things. This control
                plays back a stored log; stopping it stops nothing on the
                server, whose own controls live in the progress strip. */}
            <IconButton onClick={() => (playing ? onPause() : onPlay())}>
              {playing ? '⏸ 정지' : '▶ 재생'}
            </IconButton>
            <Clock>{formatClock(atMs)}</Clock>
            <Range
              type="range"
              min={0}
              max={eventCount}
              step={1}
              value={Math.min(cursorSeq, eventCount)}
              onChange={(e) => onSeek(Number(e.target.value))}
              aria-label="관찰 시점 (사건 번호)"
            />
            <Sub as="span" style={{ whiteSpace: 'nowrap' }}>
              기록 재생 {cursorSeq}/{eventCount}
            </Sub>
            <Extra>
              <summary>더</summary>
              <div>
                <IconButton onClick={onStepBack} disabled={cursorSeq === 0}>
                  ← 한 사건
                </IconButton>
                <IconButton onClick={onStep} disabled={cursorSeq >= eventCount}>
                  한 사건 →
                </IconButton>
                <IconButton onClick={onRestart}>처음으로</IconButton>
              </div>
            </Extra>
          </Transport>
        </MapPanel>
      </Village>

      <Middle>
        <HappeningPanel
          events={visibleEvents}
          cursorSeq={cursorSeq}
          eventCount={eventCount}
          generation={generation}
          onSeek={onSeek}
          onOpenScene={onOpenScene}
        />
        <OrchestratorPanel
          flows={flows}
          decisions={detail.decisions.filter((row) => row.simTimeMs <= atMs)}
          selectedId={activeFlow?.id ?? null}
          onSelect={setRequestId}
          onSeek={onSeek}
        />
      </Middle>

      <RightCol>
        {/* The board is the resting state; a person opens over it and can be
            closed again. Which person is open is the caller's state, so the
            map's 더 알아보기 and this column cannot disagree. */}
        {shownActor ? (
          <PersonPanel
            actorId={shownActor}
            actorIds={actorIds}
            detail={detail}
            events={allEvents}
            cursorSeq={cursorSeq}
            atMs={atMs}
            viewMode={viewMode}
            persona={persona}
            medialKnown={medialKnown.get(shownActor) ?? null}
            generation={generation}
            onSelectActor={onOpenDetail}
            onBack={() => onOpenDetail(null)}
            onSeek={onSeek}
            onOpenScene={onOpenScene}
          />
        ) : (
          <PeopleBoard
            actorIds={actorIds}
            village={village}
            poses={poses}
            events={visibleEvents}
            cursorSeq={cursorSeq}
            viewMode={viewMode}
            medialKnown={medialKnown}
            involved={new Set(activeFlow?.participants ?? [])}
            isVillageHead={(id) => Boolean(detail.timeline?.actors[id]?.isVillageHead)}
            selected={null}
            onOpen={onOpenDetail}
          />
        )}
      </RightCol>
    </Layout>
  );
}
