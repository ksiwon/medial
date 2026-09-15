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
import { taskColours } from '../selectors/taskColour';
import { dayChangeLines, dayLabel } from '../selectors/words';
import { DAY_END_MS, DAY_START_MS } from '../store';
import { IconButton, Panel, Select, Sub } from '../ui/primitives';
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
  /* The board and the person panel are plain Panels; without this they took
     their content width and the third column read narrower than the other two
     (378px against 540px at 1440, seen in a capture). */
  > * {
    flex: 1;
    min-width: 0;
  }

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
  padding: 8px 16px 6px;
  min-height: 46px;
`;

/** The clock's track, 05:00 to 22:00, with the day's marks under it as in the
 *  source diorama. The slider is time, not event number: the day runs through
 *  whether or not anything happened, and ends where the residents review it. */
const Track = styled.div`
  flex: 1;
  min-width: 80px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Ticks = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: ${font.micro};
  color: ${colour.unknown};
  font-variant-numeric: tabular-nums;
  padding: 0 2px;
  > span:last-child {
    color: ${colour.primary};
  }
`;

const DayEnd = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 16px;
  border-top: 1px solid ${colour.border};
  background: ${colour.selected};
  font-size: ${font.small};
  color: ${colour.primary};
`;

const Clock = styled.span`
  font-variant-numeric: tabular-nums;
  font-size: ${font.body};
  font-weight: 600;
  min-width: 48px;
  color: ${colour.text};
`;

const Range = styled.input`
  width: 100%;
  margin: 0;
  accent-color: ${colour.primary};
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 2px;
  }
`;

/** Everything secondary to watching the day - speed, stepping one event, the
 *  MEDial-only view, a new case - behind one gear. */
const Settings = styled.details`
  position: relative;
  flex: none;
  > summary {
    cursor: pointer;
    list-style: none;
    color: ${colour.secondary};
    font-size: 16px;
    line-height: 1;
    padding: 6px;
    border-radius: ${radius.control};
    border: 1px solid transparent;
  }
  > summary:hover,
  &[open] > summary {
    color: ${colour.primary};
    border-color: ${colour.border};
    background: ${colour.surface};
  }
  > summary::-webkit-details-marker {
    display: none;
  }
  > summary:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 1px;
  }
  > div {
    position: absolute;
    right: 0;
    bottom: 36px;
    width: 232px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: ${colour.surface};
    border: 1px solid ${colour.border};
    border-radius: ${radius.control};
    padding: 12px;
    box-shadow: 0 4px 14px rgba(29, 41, 53, 0.14);
    z-index: 4;
    font-size: ${font.small};
  }
`;

const SettingRow = styled.label`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: ${colour.secondary};
  > select {
    min-height: 28px;
    font-size: ${font.small};
    padding: 2px 6px;
  }
`;

const SPEEDS = [60, 180, 300, 600] as const;

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
  /** Simulated milliseconds per real millisecond. */
  speed: number;
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
  /** Drag the clock. Local until onScrubEnd persists the cursor. */
  onScrub: (atMs: number) => void;
  onScrubEnd: () => void;
  onSetSpeed: (speed: number) => void;
  onStep: () => void;
  onStepBack: () => void;
  onRestart: () => void;
  onOpenScene: (attemptId: string, eventId: string) => void;
  /** Leave this run and set a new case up. The run stays stored. */
  onNewCase: () => void;
  /** The day is over: the evaluations are the next thing to read. */
  onReadEvaluations: () => void;
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
  speed,
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
  onScrub,
  onScrubEnd,
  onSetSpeed,
  onStep,
  onStepBack,
  onRestart,
  onOpenScene,
  onNewCase,
  onReadEvaluations,
}: Props) {
  const flows = useMemo(() => requestFlows(visibleEvents), [visibleEvents]);
  // A request the researcher clicked stays put; otherwise the panel follows the
  // clock. It used to hold whatever it had shown first, so at 20:42 - with an
  // emergency running - it was still explaining a ride that ended at 13:26.
  const [picked, setPicked] = useState<string | null>(null);
  const [followed, setFollowed] = useState<string | null>(null);

  const newest = visibleEvents[visibleEvents.length - 1];
  useEffect(() => {
    if (!newest || newest.correlationId === 'world' || newest.correlationId === 'report') return;
    setFollowed(newest.correlationId);
  }, [newest]);

  const setRequestId = (id: string) => setPicked(id);
  const activeFlow =
    flows.find((f) => f.id === picked) ??
    flows.find((f) => f.id === followed) ??
    flows[flows.length - 1] ??
    null;

  // One colour per running request, shared by the map, the event log and the
  // orchestrator panel, so the three can be read as one thing.
  const colours = useMemo(() => taskColours(flows), [flows]);

  // Only the people of the request being read are drawn brightly. Routes are
  // not drawn any more (see VillageMap); the list stays empty.
  const highlight: MapHighlight | null = useMemo(
    () => (activeFlow ? { actorIds: new Set(activeFlow.participants), routes: [] } : null),
    [activeFlow],
  );

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

  const dayEnd = detail.timeline?.horizonMs ?? DAY_END_MS;
  const dayOver = cursorSeq >= eventCount && eventCount > 0;
  const persona = shownActor
    ? (personas?.profiles.find((p) => p.subjectId === shownActor) ?? null)
    : null;

  return (
    <Layout>
      <Village>
        <MapPanel>
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
            taskColours={colours}
            selectedCluster={selectedCluster}
            selectedActor={selectedActor}
            title={village.isSynthetic ? '합성 마을' : '은점마을'}
            onSelectCluster={onSelectCluster}
            onOpenDetail={onOpenDetail}
          />

          {/* 실행이 끝나면 다음에 읽을 것은 주민 평가다 (doc 19 9장). 재생
              커서와는 다른 컨트롤이며, 재생을 멈추지 않는다. Its own row: put
              on the playback row it squeezed the clock's marks into each other. */}
          {dayOver && (
            <DayEnd>
              <span>{formatClock(dayEnd)} · 하루가 끝났습니다</span>
              <IconButton onClick={onReadEvaluations}>주민 평가 읽기 →</IconButton>
            </DayEnd>
          )}

          <Transport>
            {/* "기록 재생" and "연구 실행" are different things. This control
                plays back a stored log; stopping it stops nothing on the
                server, whose own controls live in the progress strip. */}
            <IconButton onClick={() => (playing ? onPause() : onPlay())}>
              {playing ? '⏸ 정지' : '▶ 재생'}
            </IconButton>
            <Clock>{formatClock(atMs)}</Clock>
            <Track>
              <Range
                type="range"
                min={DAY_START_MS}
                max={dayEnd}
                step={60_000}
                value={Math.min(Math.max(atMs, DAY_START_MS), dayEnd)}
                onChange={(e) => onScrub(Number(e.target.value))}
                onPointerUp={onScrubEnd}
                onKeyUp={onScrubEnd}
                aria-label="시각"
              />
              <Ticks aria-hidden>
                <span>05:00</span>
                <span>12:00</span>
                <span>17:00</span>
                <span>{formatClock(dayEnd)} 주민 평가</span>
              </Ticks>
            </Track>
            <Settings>
              <summary aria-label="재생 설정" title="재생 설정">⚙</summary>
              <div>
                <SettingRow>
                  배속
                  <Select value={speed} onChange={(e) => onSetSpeed(Number(e.target.value))}>
                    {SPEEDS.map((v) => (
                      <option key={v} value={v}>
                        {v}×
                      </option>
                    ))}
                  </Select>
                </SettingRow>
                <SettingRow>
                  보기
                  <Select
                    aria-label="관찰 시점"
                    value={viewMode}
                    onChange={(e) => onSetViewMode(e.target.value as ViewMode)}
                  >
                    <option value="researcher">연구자 전체</option>
                    <option value="medial">MEDial이 아는 것</option>
                  </Select>
                </SettingRow>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <IconButton onClick={onStepBack} disabled={cursorSeq === 0}>
                    ← 한 사건
                  </IconButton>
                  <IconButton onClick={onStep} disabled={cursorSeq >= eventCount}>
                    한 사건 →
                  </IconButton>
                  <IconButton onClick={onRestart}>처음으로</IconButton>
                </div>
                <Sub as="span">
                  사건 {cursorSeq}/{eventCount}
                  {' · '}
                  {village.isSynthetic ? '합성 지도' : '원자료 지형'}
                </Sub>
                {/* Which day this run happened on: as recorded, or nudged. The
                    edits themselves are in the tooltip, one per person. */}
                {detail.metrics.dayRealization && (
                  <Sub
                    as="span"
                    title={
                      dayChangeLines(detail.metrics.dayRealization).join('\n') ||
                      '기록된 일과를 그대로 썼습니다.'
                    }
                  >
                    {dayLabel(detail.metrics.dayRealization)}
                  </Sub>
                )}
                <IconButton onClick={onNewCase}>새 사례 준비</IconButton>
              </div>
            </Settings>
          </Transport>
        </MapPanel>
      </Village>

      <Middle>
        <HappeningPanel
          events={visibleEvents}
          cursorSeq={cursorSeq}
          atMs={atMs}
          eventCount={eventCount}
          generation={generation}
          taskColours={colours}
          onSeek={onSeek}
          onOpenScene={onOpenScene}
        />
        <OrchestratorPanel
          flows={flows}
          decisions={detail.decisions.filter((row) => row.simTimeMs <= atMs)}
          selectedId={activeFlow?.id ?? null}
          taskColours={colours}
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
